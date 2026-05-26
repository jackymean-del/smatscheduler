// Package templates provides the repository and service for curriculum_templates.
// Templates represent the canonical curriculum definition for each
// board × grade_group × subject_name combination.
package templates

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jackymean-del/smart-sched/internal/curriculum"
)

// Repository handles DB access for curriculum_templates.
type Repository struct{ db *pgxpool.Pool }

// NewRepository returns a Repository.
func NewRepository(db *pgxpool.Pool) *Repository { return &Repository{db: db} }

// ListByBoard returns all templates for a given board, ordered by grade group
// priority then subject name.
func (r *Repository) ListByBoard(ctx context.Context, board curriculum.Board) ([]curriculum.Template, error) {
	rows, err := r.db.Query(ctx, `
		SELECT id, board, grade_group, subject_name, short_name,
		       slots_per_week, requires_lab, is_language, is_activity,
		       streams, version_id, is_mandatory,
		       COALESCE(hint,'') as hint, metadata,
		       created_at, updated_at
		FROM curriculum_templates
		WHERE board = $1
		ORDER BY
		    CASE grade_group
		        WHEN 'srSec'     THEN 1
		        WHEN 'secondary' THEN 2
		        WHEN 'middle'    THEN 3
		        WHEN 'primary'   THEN 4
		        WHEN 'preK'      THEN 5
		        ELSE 6
		    END,
		    subject_name`,
		string(board),
	)
	if err != nil {
		return nil, fmt.Errorf("templates.ListByBoard %s: %w", board, err)
	}
	defer rows.Close()
	return scanTemplates(rows)
}

// ListByBoardAndGrade returns templates for a specific board + grade group.
func (r *Repository) ListByBoardAndGrade(
	ctx context.Context,
	board curriculum.Board,
	gradeGroup curriculum.GradeGroup,
) ([]curriculum.Template, error) {
	rows, err := r.db.Query(ctx, `
		SELECT id, board, grade_group, subject_name, short_name,
		       slots_per_week, requires_lab, is_language, is_activity,
		       streams, version_id, is_mandatory,
		       COALESCE(hint,'') as hint, metadata,
		       created_at, updated_at
		FROM curriculum_templates
		WHERE board = $1 AND grade_group = $2
		ORDER BY subject_name`,
		string(board), string(gradeGroup),
	)
	if err != nil {
		return nil, fmt.Errorf("templates.ListByBoardAndGrade: %w", err)
	}
	defer rows.Close()
	return scanTemplates(rows)
}

// Get returns one template by primary key.
func (r *Repository) Get(ctx context.Context, id string) (*curriculum.Template, error) {
	t := &curriculum.Template{}
	var board, gradeGroup string
	err := r.db.QueryRow(ctx, `
		SELECT id, board, grade_group, subject_name, short_name,
		       slots_per_week, requires_lab, is_language, is_activity,
		       streams, version_id, is_mandatory,
		       COALESCE(hint,'') as hint, metadata,
		       created_at, updated_at
		FROM curriculum_templates WHERE id = $1`, id,
	).Scan(
		&t.ID, &board, &gradeGroup, &t.SubjectName, &t.ShortName,
		&t.SlotsPerWeek, &t.RequiresLab, &t.IsLanguage, &t.IsActivity,
		&t.Streams, &t.VersionID, &t.IsMandatory,
		&t.Hint, &t.Metadata, &t.CreatedAt, &t.UpdatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("templates.Get %s: %w", id, err)
	}
	t.Board = curriculum.Board(board)
	t.GradeGroup = curriculum.GradeGroup(gradeGroup)
	return t, nil
}

// Upsert inserts or updates a template.  Used during seeding and when an
// approved change is applied.
func (r *Repository) Upsert(ctx context.Context, t *curriculum.Template) error {
	_, err := r.db.Exec(ctx, `
		INSERT INTO curriculum_templates
		    (board, grade_group, subject_name, short_name,
		     slots_per_week, requires_lab, is_language, is_activity,
		     streams, version_id, is_mandatory, hint, metadata)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
		ON CONFLICT (board, grade_group, subject_name) DO UPDATE
		    SET short_name     = EXCLUDED.short_name,
		        slots_per_week = EXCLUDED.slots_per_week,
		        requires_lab   = EXCLUDED.requires_lab,
		        is_language    = EXCLUDED.is_language,
		        is_activity    = EXCLUDED.is_activity,
		        streams        = EXCLUDED.streams,
		        version_id     = EXCLUDED.version_id,
		        is_mandatory   = EXCLUDED.is_mandatory,
		        hint           = EXCLUDED.hint,
		        metadata       = EXCLUDED.metadata,
		        updated_at     = NOW()`,
		string(t.Board), string(t.GradeGroup), t.SubjectName, t.ShortName,
		t.SlotsPerWeek, t.RequiresLab, t.IsLanguage, t.IsActivity,
		t.Streams, t.VersionID, t.IsMandatory, t.Hint, t.Metadata,
	)
	if err != nil {
		return fmt.Errorf("templates.Upsert %s/%s/%s: %w",
			t.Board, t.GradeGroup, t.SubjectName, err)
	}
	return nil
}

// BoardsWithTemplates returns all boards that have at least one template.
func (r *Repository) BoardsWithTemplates(ctx context.Context) ([]curriculum.Board, error) {
	rows, err := r.db.Query(ctx, `
		SELECT DISTINCT board FROM curriculum_templates ORDER BY board`)
	if err != nil {
		return nil, fmt.Errorf("templates.BoardsWithTemplates: %w", err)
	}
	defer rows.Close()
	var boards []curriculum.Board
	for rows.Next() {
		var b string
		if err := rows.Scan(&b); err != nil {
			return nil, err
		}
		boards = append(boards, curriculum.Board(b))
	}
	return boards, rows.Err()
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

func scanTemplates(rows interface {
	Next() bool
	Scan(dest ...any) error
	Err() error
}) ([]curriculum.Template, error) {
	var out []curriculum.Template
	for rows.Next() {
		t := curriculum.Template{}
		var board, gradeGroup string
		if err := rows.Scan(
			&t.ID, &board, &gradeGroup, &t.SubjectName, &t.ShortName,
			&t.SlotsPerWeek, &t.RequiresLab, &t.IsLanguage, &t.IsActivity,
			&t.Streams, &t.VersionID, &t.IsMandatory,
			&t.Hint, &t.Metadata, &t.CreatedAt, &t.UpdatedAt,
		); err != nil {
			return nil, err
		}
		t.Board = curriculum.Board(board)
		t.GradeGroup = curriculum.GradeGroup(gradeGroup)
		out = append(out, t)
	}
	return out, rows.Err()
}
