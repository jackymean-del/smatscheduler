// Package versioning manages curriculum_versions — immutable snapshots of a
// board's curriculum for a specific academic year.
package versioning

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jackymean-del/smart-sched/internal/curriculum"
)

// Repository handles DB access for curriculum_versions.
type Repository struct{ db *pgxpool.Pool }

// NewRepository returns a Repository.
func NewRepository(db *pgxpool.Pool) *Repository { return &Repository{db: db} }

// CreateVersionInput holds the fields required to create a new pending version.
type CreateVersionInput struct {
	Board        curriculum.Board
	VersionTag   string  // if empty, auto-generated from board + year
	AcademicYear string  // if empty, derived from current date
	SourceID     *string
	RawContent   string
}

// CreatePending inserts a new curriculum_versions row in status='pending'
// and returns the new row's ID.
func (r *Repository) CreatePending(ctx context.Context, in CreateVersionInput) (string, error) {
	if in.AcademicYear == "" {
		in.AcademicYear = currentAcademicYear()
	}
	if in.VersionTag == "" {
		in.VersionTag = fmt.Sprintf("%s_%d", string(in.Board), time.Now().Year())
	}

	var id string
	err := r.db.QueryRow(ctx, `
		INSERT INTO curriculum_versions
		    (board, version_tag, academic_year, source_id, raw_content, status)
		VALUES ($1, $2, $3, $4, $5, 'pending')
		ON CONFLICT (board, version_tag) DO UPDATE
		    SET raw_content = EXCLUDED.raw_content,
		        source_id   = EXCLUDED.source_id,
		        status      = 'pending'
		RETURNING id`,
		string(in.Board), in.VersionTag, in.AcademicYear,
		in.SourceID, in.RawContent,
	).Scan(&id)
	if err != nil {
		return "", fmt.Errorf("versioning.CreatePending: %w", err)
	}
	return id, nil
}

// List returns all versions, optionally filtered by board.
// Pass board = "" to list all boards.
func (r *Repository) List(ctx context.Context, board curriculum.Board) ([]curriculum.Version, error) {
	query := `
		SELECT id, board, version_tag, academic_year, source_id,
		       raw_content, status, reviewed_by, reviewed_at, notes, created_at
		FROM curriculum_versions
		WHERE ($1 = '' OR board = $1)
		ORDER BY created_at DESC`
	rows, err := r.db.Query(ctx, query, string(board))
	if err != nil {
		return nil, fmt.Errorf("versioning.List: %w", err)
	}
	defer rows.Close()
	return scanVersions(rows)
}

// Get returns one version by ID.
func (r *Repository) Get(ctx context.Context, id string) (*curriculum.Version, error) {
	v := &curriculum.Version{}
	var board string
	var status string
	err := r.db.QueryRow(ctx, `
		SELECT id, board, version_tag, academic_year, source_id,
		       raw_content, status, reviewed_by, reviewed_at, notes, created_at
		FROM curriculum_versions WHERE id = $1`, id,
	).Scan(
		&v.ID, &board, &v.VersionTag, &v.AcademicYear, &v.SourceID,
		&v.RawContent, &status, &v.ReviewedBy, &v.ReviewedAt, &v.Notes, &v.CreatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("versioning.Get %s: %w", id, err)
	}
	v.Board = curriculum.Board(board)
	v.Status = curriculum.ChangeStatus(status)
	return v, nil
}

// SetStatus updates the review status of a version.
func (r *Repository) SetStatus(
	ctx context.Context,
	id string,
	status curriculum.ChangeStatus,
	reviewerID string,
	notes string,
) error {
	now := time.Now().UTC()
	_, err := r.db.Exec(ctx, `
		UPDATE curriculum_versions
		SET status      = $2,
		    reviewed_by = $3,
		    reviewed_at = $4,
		    notes       = $5
		WHERE id = $1`,
		id, string(status), reviewerID, now, notes,
	)
	if err != nil {
		return fmt.Errorf("versioning.SetStatus %s: %w", id, err)
	}
	return nil
}

// LatestApproved returns the most recently approved version for a board.
func (r *Repository) LatestApproved(ctx context.Context, board curriculum.Board) (*curriculum.Version, error) {
	v := &curriculum.Version{}
	var boardStr, status string
	err := r.db.QueryRow(ctx, `
		SELECT id, board, version_tag, academic_year, source_id,
		       raw_content, status, reviewed_by, reviewed_at, notes, created_at
		FROM curriculum_versions
		WHERE board = $1 AND status = 'approved'
		ORDER BY created_at DESC
		LIMIT 1`,
		string(board),
	).Scan(
		&v.ID, &boardStr, &v.VersionTag, &v.AcademicYear, &v.SourceID,
		&v.RawContent, &status, &v.ReviewedBy, &v.ReviewedAt, &v.Notes, &v.CreatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("versioning.LatestApproved %s: %w", board, err)
	}
	v.Board = curriculum.Board(boardStr)
	v.Status = curriculum.ChangeStatus(status)
	return v, nil
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

func scanVersions(rows interface {
	Next() bool
	Scan(dest ...any) error
	Err() error
}) ([]curriculum.Version, error) {
	var out []curriculum.Version
	for rows.Next() {
		v := curriculum.Version{}
		var board, status string
		if err := rows.Scan(
			&v.ID, &board, &v.VersionTag, &v.AcademicYear, &v.SourceID,
			&v.RawContent, &status, &v.ReviewedBy, &v.ReviewedAt, &v.Notes, &v.CreatedAt,
		); err != nil {
			return nil, err
		}
		v.Board = curriculum.Board(board)
		v.Status = curriculum.ChangeStatus(status)
		out = append(out, v)
	}
	return out, rows.Err()
}

// currentAcademicYear returns the academic year string for the current date.
// Indian academic year: April–March. e.g. April 2026 → "2026-27".
func currentAcademicYear() string {
	now := time.Now()
	year := now.Year()
	if now.Month() < 4 { // Jan–Mar belongs to previous year's academic session
		year--
	}
	return fmt.Sprintf("%d-%02d", year, (year+1)%100)
}
