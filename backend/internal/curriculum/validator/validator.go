// Package validator implements the admin review workflow for pending curriculum
// changes. No change is ever applied automatically — a human must approve.
//
// Review lifecycle:
//   pending → reviewing → approved | rejected
//
// Only approved changes are handed to the updater for application to templates.
package validator

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jackymean-del/smart-sched/internal/curriculum"
)

// Service handles the review workflow for curriculum changes.
type Service struct{ db *pgxpool.Pool }

// NewService creates a validator Service.
func NewService(db *pgxpool.Pool) *Service { return &Service{db: db} }

// ListPending returns all changes in status='pending', ordered by detection time.
func (s *Service) ListPending(ctx context.Context) ([]curriculum.Change, error) {
	return s.listByStatus(ctx, curriculum.StatusPending)
}

// ListByStatus returns all changes with a given status.
func (s *Service) ListByStatus(ctx context.Context, status curriculum.ChangeStatus) ([]curriculum.Change, error) {
	return s.listByStatus(ctx, status)
}

// ListBySource returns all pending changes for a specific source.
func (s *Service) ListBySource(ctx context.Context, sourceID string) ([]curriculum.Change, error) {
	rows, err := s.db.Query(ctx, `
		SELECT id, source_id, version_id, change_type, subject_name,
		       field_changed, old_value, new_value,
		       status, detected_at, applied_at, applied_by
		FROM curriculum_changes
		WHERE source_id = $1
		ORDER BY detected_at DESC`,
		sourceID,
	)
	if err != nil {
		return nil, fmt.Errorf("validator.ListBySource: %w", err)
	}
	defer rows.Close()
	return scanChanges(rows)
}

// Approve marks the given change IDs as approved and sets reviewed metadata.
// Returns the list of successfully approved IDs.
//
// IMPORTANT: This does NOT apply the changes to templates. The caller must
// invoke updater.Service.ApplyApproved afterwards.
func (s *Service) Approve(
	ctx context.Context,
	changeIDs []string,
	reviewerID string,
	notes string,
) ([]string, error) {
	return s.setStatus(ctx, changeIDs, curriculum.StatusApproved, reviewerID, notes)
}

// Reject marks the given change IDs as rejected.
func (s *Service) Reject(
	ctx context.Context,
	changeIDs []string,
	reviewerID string,
	notes string,
) ([]string, error) {
	return s.setStatus(ctx, changeIDs, curriculum.StatusRejected, reviewerID, notes)
}

// MarkReviewing transitions change IDs to status='reviewing' (in-progress review).
func (s *Service) MarkReviewing(ctx context.Context, changeIDs []string) error {
	if len(changeIDs) == 0 {
		return nil
	}
	args := make([]any, len(changeIDs))
	placeholders := make([]string, len(changeIDs))
	for i, id := range changeIDs {
		args[i] = id
		placeholders[i] = fmt.Sprintf("$%d", i+1)
	}
	_, err := s.db.Exec(ctx,
		fmt.Sprintf(`UPDATE curriculum_changes SET status = 'reviewing'
		WHERE id = ANY(ARRAY[%s]::uuid[]) AND status = 'pending'`,
			joinStrings(placeholders)),
		args...,
	)
	return err
}

// GetChange returns a single change by ID.
func (s *Service) GetChange(ctx context.Context, id string) (*curriculum.Change, error) {
	row := s.db.QueryRow(ctx, `
		SELECT id, source_id, version_id, change_type, subject_name,
		       field_changed, old_value, new_value,
		       status, detected_at, applied_at, applied_by
		FROM curriculum_changes WHERE id = $1`, id)
	c := &curriculum.Change{}
	var ct, st string
	if err := row.Scan(
		&c.ID, &c.SourceID, &c.VersionID, &ct, &c.SubjectName,
		&c.FieldChanged, &c.OldValue, &c.NewValue,
		&st, &c.DetectedAt, &c.AppliedAt, &c.AppliedBy,
	); err != nil {
		return nil, fmt.Errorf("validator.GetChange %s: %w", id, err)
	}
	c.ChangeType = curriculum.ChangeType(ct)
	c.Status = curriculum.ChangeStatus(st)
	return c, nil
}

// ---------------------------------------------------------------------------
// internal helpers
// ---------------------------------------------------------------------------

func (s *Service) listByStatus(ctx context.Context, status curriculum.ChangeStatus) ([]curriculum.Change, error) {
	rows, err := s.db.Query(ctx, `
		SELECT id, source_id, version_id, change_type, subject_name,
		       field_changed, old_value, new_value,
		       status, detected_at, applied_at, applied_by
		FROM curriculum_changes
		WHERE status = $1
		ORDER BY detected_at ASC`,
		string(status),
	)
	if err != nil {
		return nil, fmt.Errorf("validator.listByStatus %s: %w", status, err)
	}
	defer rows.Close()
	return scanChanges(rows)
}

func (s *Service) setStatus(
	ctx context.Context,
	changeIDs []string,
	status curriculum.ChangeStatus,
	reviewerID string,
	notes string,
) ([]string, error) {
	if len(changeIDs) == 0 {
		return nil, nil
	}
	now := time.Now().UTC()

	var approved []string
	for _, id := range changeIDs {
		var resultID string
		err := s.db.QueryRow(ctx, `
			UPDATE curriculum_changes
			SET status     = $2,
			    applied_by = $3,
			    applied_at = CASE WHEN $2 = 'approved' THEN $4 ELSE applied_at END
			WHERE id = $1
			  AND status IN ('pending','reviewing')
			RETURNING id`,
			id, string(status), reviewerID, now,
		).Scan(&resultID)
		if err != nil {
			slog.Warn("validator.setStatus: could not update change",
				"id", id, "status", status, "err", err)
			continue
		}
		approved = append(approved, resultID)
	}
	return approved, nil
}

func scanChanges(rows interface {
	Next() bool
	Scan(dest ...any) error
	Err() error
}) ([]curriculum.Change, error) {
	var out []curriculum.Change
	for rows.Next() {
		c := curriculum.Change{}
		var ct, st string
		if err := rows.Scan(
			&c.ID, &c.SourceID, &c.VersionID, &ct, &c.SubjectName,
			&c.FieldChanged, &c.OldValue, &c.NewValue,
			&st, &c.DetectedAt, &c.AppliedAt, &c.AppliedBy,
		); err != nil {
			return nil, err
		}
		c.ChangeType = curriculum.ChangeType(ct)
		c.Status = curriculum.ChangeStatus(st)
		out = append(out, c)
	}
	return out, rows.Err()
}

func joinStrings(ss []string) string {
	out := ""
	for i, s := range ss {
		if i > 0 {
			out += ","
		}
		out += s
	}
	return out
}
