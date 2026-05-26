// Package overrides manages school_curriculum_overrides.
// School overrides ALWAYS win over board templates in the recommendation
// hierarchy: School Overrides > Board Templates > AI Defaults.
package overrides

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jackymean-del/smart-sched/internal/curriculum"
)

// Repository handles DB access for school_curriculum_overrides.
type Repository struct{ db *pgxpool.Pool }

// NewRepository returns a Repository.
func NewRepository(db *pgxpool.Pool) *Repository { return &Repository{db: db} }

// ListForSchool returns all overrides for a school, optionally filtered by board.
// Pass board="" to list all boards.
func (r *Repository) ListForSchool(
	ctx context.Context,
	schoolID string,
	board curriculum.Board,
) ([]curriculum.Override, error) {
	rows, err := r.db.Query(ctx, `
		SELECT id, school_id, board, grade_group, subject_name,
		       slots_per_week, is_mandatory, custom_subject_name,
		       streams, notes, created_by, created_at, updated_at
		FROM school_curriculum_overrides
		WHERE school_id = $1
		  AND ($2 = '' OR board = $2)
		ORDER BY board, grade_group, subject_name`,
		schoolID, string(board),
	)
	if err != nil {
		return nil, fmt.Errorf("overrides.ListForSchool: %w", err)
	}
	defer rows.Close()
	return scanOverrides(rows)
}

// GetForSubject returns the override (if any) for a specific school/board/grade/subject.
// Returns nil, nil when no override exists.
func (r *Repository) GetForSubject(
	ctx context.Context,
	schoolID string,
	board curriculum.Board,
	gradeGroup curriculum.GradeGroup,
	subjectName string,
) (*curriculum.Override, error) {
	o := &curriculum.Override{}
	var boardStr, gg string
	err := r.db.QueryRow(ctx, `
		SELECT id, school_id, board, grade_group, subject_name,
		       slots_per_week, is_mandatory, custom_subject_name,
		       streams, notes, created_by, created_at, updated_at
		FROM school_curriculum_overrides
		WHERE school_id = $1 AND board = $2 AND grade_group = $3 AND subject_name = $4`,
		schoolID, string(board), string(gradeGroup), subjectName,
	).Scan(
		&o.ID, &o.SchoolID, &boardStr, &gg, &o.SubjectName,
		&o.SlotsPerWeek, &o.IsMandatory, &o.CustomSubjectName,
		&o.Streams, &o.Notes, &o.CreatedBy, &o.CreatedAt, &o.UpdatedAt,
	)
	if err != nil {
		// pgx returns pgx.ErrNoRows when there's no row
		if err.Error() == "no rows in result set" {
			return nil, nil
		}
		return nil, fmt.Errorf("overrides.GetForSubject: %w", err)
	}
	o.Board = curriculum.Board(boardStr)
	o.GradeGroup = curriculum.GradeGroup(gg)
	return o, nil
}

// Upsert creates or updates an override.
func (r *Repository) Upsert(ctx context.Context, o *curriculum.Override) (string, error) {
	var id string
	err := r.db.QueryRow(ctx, `
		INSERT INTO school_curriculum_overrides
		    (school_id, board, grade_group, subject_name,
		     slots_per_week, is_mandatory, custom_subject_name,
		     streams, notes, created_by)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
		ON CONFLICT (school_id, board, grade_group, subject_name) DO UPDATE
		    SET slots_per_week      = EXCLUDED.slots_per_week,
		        is_mandatory        = EXCLUDED.is_mandatory,
		        custom_subject_name = EXCLUDED.custom_subject_name,
		        streams             = EXCLUDED.streams,
		        notes               = EXCLUDED.notes,
		        updated_at          = NOW()
		RETURNING id`,
		o.SchoolID, string(o.Board), string(o.GradeGroup), o.SubjectName,
		o.SlotsPerWeek, o.IsMandatory, o.CustomSubjectName,
		o.Streams, o.Notes, o.CreatedBy,
	).Scan(&id)
	if err != nil {
		return "", fmt.Errorf("overrides.Upsert: %w", err)
	}
	return id, nil
}

// Delete removes an override.
func (r *Repository) Delete(ctx context.Context, id string) error {
	_, err := r.db.Exec(ctx, `DELETE FROM school_curriculum_overrides WHERE id = $1`, id)
	if err != nil {
		return fmt.Errorf("overrides.Delete %s: %w", id, err)
	}
	return nil
}

// MapBySubject returns a map of subject_name → Override for efficient lookup
// during recommendation merging.
func (r *Repository) MapBySubject(
	ctx context.Context,
	schoolID string,
	board curriculum.Board,
	gradeGroup curriculum.GradeGroup,
) (map[string]*curriculum.Override, error) {
	rows, err := r.db.Query(ctx, `
		SELECT id, school_id, board, grade_group, subject_name,
		       slots_per_week, is_mandatory, custom_subject_name,
		       streams, notes, created_by, created_at, updated_at
		FROM school_curriculum_overrides
		WHERE school_id = $1 AND board = $2 AND grade_group = $3`,
		schoolID, string(board), string(gradeGroup),
	)
	if err != nil {
		return nil, fmt.Errorf("overrides.MapBySubject: %w", err)
	}
	defer rows.Close()

	overrides, err := scanOverrides(rows)
	if err != nil {
		return nil, err
	}
	m := make(map[string]*curriculum.Override, len(overrides))
	for i := range overrides {
		m[overrides[i].SubjectName] = &overrides[i]
	}
	return m, nil
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

func scanOverrides(rows interface {
	Next() bool
	Scan(dest ...any) error
	Err() error
}) ([]curriculum.Override, error) {
	var out []curriculum.Override
	for rows.Next() {
		o := curriculum.Override{}
		var board, gg string
		if err := rows.Scan(
			&o.ID, &o.SchoolID, &board, &gg, &o.SubjectName,
			&o.SlotsPerWeek, &o.IsMandatory, &o.CustomSubjectName,
			&o.Streams, &o.Notes, &o.CreatedBy, &o.CreatedAt, &o.UpdatedAt,
		); err != nil {
			return nil, err
		}
		o.Board = curriculum.Board(board)
		o.GradeGroup = curriculum.GradeGroup(gg)
		out = append(out, o)
	}
	return out, rows.Err()
}
