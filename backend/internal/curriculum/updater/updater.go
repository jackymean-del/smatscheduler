// Package updater applies approved curriculum changes to curriculum_templates.
// It is ONLY invoked after a human admin has approved changes via the validator.
// It is NEVER called automatically.
package updater

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jackymean-del/smart-sched/internal/curriculum"
)

// Service applies approved changes to curriculum_templates.
type Service struct{ db *pgxpool.Pool }

// NewService creates an updater Service.
func NewService(db *pgxpool.Pool) *Service { return &Service{db: db} }

// ApplyApproved finds all approved (but not yet applied) curriculum_changes
// and applies each one to curriculum_templates. Each application is wrapped
// in a transaction; a failure rolls back only that change.
//
// Returns the IDs of successfully applied changes.
func (s *Service) ApplyApproved(ctx context.Context) ([]string, []error) {
	rows, err := s.db.Query(ctx, `
		SELECT id, source_id, version_id, change_type, subject_name,
		       field_changed, old_value, new_value
		FROM curriculum_changes
		WHERE status = 'approved'
		  AND applied_at IS NULL
		ORDER BY detected_at ASC`,
	)
	if err != nil {
		return nil, []error{fmt.Errorf("updater.ApplyApproved query: %w", err)}
	}
	defer rows.Close()

	type changeRow struct {
		ID, SourceID string
		VersionID    *string
		ChangeType   curriculum.ChangeType
		SubjectName  string
		FieldChanged *string
		OldValue     json.RawMessage
		NewValue     json.RawMessage
	}

	var changes []changeRow
	for rows.Next() {
		var c changeRow
		var ct string
		if err := rows.Scan(
			&c.ID, &c.SourceID, &c.VersionID, &ct, &c.SubjectName,
			&c.FieldChanged, &c.OldValue, &c.NewValue,
		); err != nil {
			return nil, []error{fmt.Errorf("updater.ApplyApproved scan: %w", err)}
		}
		c.ChangeType = curriculum.ChangeType(ct)
		changes = append(changes, c)
	}
	if err := rows.Err(); err != nil {
		return nil, []error{err}
	}

	var applied []string
	var errs []error
	now := time.Now().UTC()

	for _, ch := range changes {
		applyErr := s.applyOne(ctx, ch.ID, ch.ChangeType, ch.SubjectName,
			ch.FieldChanged, ch.OldValue, ch.NewValue, ch.VersionID, now)
		if applyErr != nil {
			slog.Error("updater: applyOne failed",
				"change_id", ch.ID, "type", ch.ChangeType,
				"subject", ch.SubjectName, "err", applyErr)
			errs = append(errs, applyErr)
			continue
		}
		applied = append(applied, ch.ID)
	}
	return applied, errs
}

// applyOne applies a single approved change inside a DB transaction.
func (s *Service) applyOne(
	ctx context.Context,
	changeID string,
	ct curriculum.ChangeType,
	subjectName string,
	fieldChanged *string,
	oldVal, newVal json.RawMessage,
	versionID *string,
	now time.Time,
) error {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx) // no-op if committed

	switch ct {
	case curriculum.ChangeSubjectAdded:
		var entry curriculum.ParsedSubjectEntry
		if err := json.Unmarshal(newVal, &entry); err != nil {
			return fmt.Errorf("applyOne subject_added unmarshal: %w", err)
		}
		_, err = tx.Exec(ctx, `
			INSERT INTO curriculum_templates
			    (board, grade_group, subject_name, short_name,
			     slots_per_week, requires_lab, is_language, is_activity,
			     streams, version_id, is_mandatory, hint)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
			ON CONFLICT (board, grade_group, subject_name) DO UPDATE
			    SET short_name    = EXCLUDED.short_name,
			        slots_per_week = EXCLUDED.slots_per_week,
			        requires_lab   = EXCLUDED.requires_lab,
			        version_id     = EXCLUDED.version_id,
			        updated_at     = NOW()`,
			string(entry.Board), string(entry.GradeGroup), entry.SubjectName,
			entry.ShortName, entry.SlotsPerWeek,
			entry.RequiresLab, entry.IsLanguage, entry.IsActivity,
			entry.Streams, versionID, entry.IsMandatory, entry.Hint,
		)

	case curriculum.ChangeSubjectRemoved:
		var old curriculum.Template
		if err := json.Unmarshal(oldVal, &old); err != nil {
			return fmt.Errorf("applyOne subject_removed unmarshal: %w", err)
		}
		_, err = tx.Exec(ctx, `
			DELETE FROM curriculum_templates
			WHERE board = $1 AND grade_group = $2 AND subject_name = $3`,
			string(old.Board), string(old.GradeGroup), old.SubjectName,
		)

	case curriculum.ChangeSlotsChanged:
		if fieldChanged == nil {
			return fmt.Errorf("applyOne slots_changed: field_changed is nil")
		}
		var newSlots int
		if err := json.Unmarshal(newVal, &newSlots); err != nil {
			return fmt.Errorf("applyOne slots_changed unmarshal newVal: %w", err)
		}
		// We need board+grade_group from the old value
		var oldTpl struct {
			Board      string `json:"board"`
			GradeGroup string `json:"grade_group"`
		}
		if err := json.Unmarshal(oldVal, &oldTpl); err != nil {
			// old_value might just be the integer — update by subject name across board
			_, err = tx.Exec(ctx, `
				UPDATE curriculum_templates
				SET slots_per_week = $2, updated_at = NOW()
				WHERE subject_name = $1`,
				subjectName, newSlots,
			)
		} else {
			_, err = tx.Exec(ctx, `
				UPDATE curriculum_templates
				SET slots_per_week = $3, updated_at = NOW()
				WHERE board = $1 AND grade_group = $2 AND subject_name = $4`,
				oldTpl.Board, oldTpl.GradeGroup, newSlots, subjectName,
			)
		}

	case curriculum.ChangeLabChanged:
		var newLab bool
		if err := json.Unmarshal(newVal, &newLab); err != nil {
			return fmt.Errorf("applyOne lab_changed unmarshal: %w", err)
		}
		_, err = tx.Exec(ctx, `
			UPDATE curriculum_templates
			SET requires_lab = $2, updated_at = NOW()
			WHERE subject_name = $1`,
			subjectName, newLab,
		)

	default:
		// For other change types, log and skip without error.
		slog.Warn("updater: unhandled change type — skipping", "type", ct)
		return tx.Commit(ctx)
	}

	if err != nil {
		return fmt.Errorf("applyOne %s exec: %w", ct, err)
	}

	// Mark the change as applied.
	_, err = tx.Exec(ctx, `
		UPDATE curriculum_changes
		SET applied_at = $2
		WHERE id = $1`,
		changeID, now,
	)
	if err != nil {
		return fmt.Errorf("applyOne mark applied: %w", err)
	}

	return tx.Commit(ctx)
}
