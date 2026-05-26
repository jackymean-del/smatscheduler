package sources

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jackymean-del/smart-sched/internal/curriculum"
)

// Repository handles persistence for curriculum_sources.
type Repository struct{ db *pgxpool.Pool }

// NewRepository constructs a Repository backed by the given connection pool.
func NewRepository(db *pgxpool.Pool) *Repository { return &Repository{db: db} }

const selectCols = `
	SELECT id, board, url, name,
	       content_hash, etag,
	       last_fetched_at, last_changed_at,
	       fetch_interval_hours, enabled,
	       created_at, updated_at
	FROM curriculum_sources`

// ListEnabled returns all sources with enabled = TRUE.
func (r *Repository) ListEnabled(ctx context.Context) ([]curriculum.Source, error) {
	rows, err := r.db.Query(ctx, selectCols+`
		WHERE enabled = TRUE
		ORDER BY board, name`)
	if err != nil {
		return nil, fmt.Errorf("sources.ListEnabled: %w", err)
	}
	defer rows.Close()
	return scanSources(rows)
}

// ListByBoard returns all sources for the given board.
func (r *Repository) ListByBoard(ctx context.Context, board curriculum.Board) ([]curriculum.Source, error) {
	rows, err := r.db.Query(ctx, selectCols+`
		WHERE board = $1
		ORDER BY name`,
		string(board),
	)
	if err != nil {
		return nil, fmt.Errorf("sources.ListByBoard: %w", err)
	}
	defer rows.Close()
	return scanSources(rows)
}

// Get returns one source by ID.
func (r *Repository) Get(ctx context.Context, id string) (*curriculum.Source, error) {
	s := &curriculum.Source{}
	var board string
	err := r.db.QueryRow(ctx, selectCols+` WHERE id = $1`, id).Scan(
		&s.ID, &board, &s.URL, &s.Name,
		&s.ContentHash, &s.ETag,
		&s.LastFetchedAt, &s.LastChangedAt,
		&s.FetchIntervalHours, &s.Enabled,
		&s.CreatedAt, &s.UpdatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("sources.Get %s: %w", id, err)
	}
	s.Board = curriculum.Board(board)
	return s, nil
}

// Upsert inserts or updates a source identified by URL.
// Used when seeding trusted sources at startup.
func (r *Repository) Upsert(ctx context.Context, s *curriculum.Source) (string, error) {
	var id string
	err := r.db.QueryRow(ctx, `
		INSERT INTO curriculum_sources (board, url, name, fetch_interval_hours, enabled)
		VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (url) DO UPDATE
		    SET name                 = EXCLUDED.name,
		        fetch_interval_hours = EXCLUDED.fetch_interval_hours,
		        enabled              = EXCLUDED.enabled,
		        updated_at           = NOW()
		RETURNING id`,
		string(s.Board), s.URL, s.Name, s.FetchIntervalHours, s.Enabled,
	).Scan(&id)
	if err != nil {
		return "", fmt.Errorf("sources.Upsert: %w", err)
	}
	return id, nil
}

// UpdateFetchResult persists the result of a fetch attempt.
func (r *Repository) UpdateFetchResult(
	ctx context.Context,
	id string,
	contentHash string,
	etag *string,
	changed bool,
) error {
	now := time.Now().UTC()
	var lastChangedAt *time.Time
	if changed {
		lastChangedAt = &now
	}
	_, err := r.db.Exec(ctx, `
		UPDATE curriculum_sources
		SET content_hash    = $2,
		    etag            = $3,
		    last_fetched_at = $4,
		    last_changed_at = COALESCE($5, last_changed_at),
		    updated_at      = NOW()
		WHERE id = $1`,
		id, contentHash, etag, now, lastChangedAt,
	)
	if err != nil {
		return fmt.Errorf("sources.UpdateFetchResult %s: %w", id, err)
	}
	return nil
}

// DueSources returns sources whose next fetch is due now.
// A fetch is due when last_fetched_at + fetch_interval_hours <= NOW().
func (r *Repository) DueSources(ctx context.Context) ([]curriculum.Source, error) {
	rows, err := r.db.Query(ctx, selectCols+`
		WHERE enabled = TRUE
		  AND (
		        last_fetched_at IS NULL
		     OR last_fetched_at + (fetch_interval_hours * INTERVAL '1 hour') <= NOW()
		      )
		ORDER BY last_fetched_at ASC NULLS FIRST`,
	)
	if err != nil {
		return nil, fmt.Errorf("sources.DueSources: %w", err)
	}
	defer rows.Close()
	return scanSources(rows)
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

func scanSources(rows interface {
	Next() bool
	Scan(dest ...any) error
	Err() error
}) ([]curriculum.Source, error) {
	var out []curriculum.Source
	for rows.Next() {
		s := curriculum.Source{}
		var board string
		if err := rows.Scan(
			&s.ID, &board, &s.URL, &s.Name,
			&s.ContentHash, &s.ETag,
			&s.LastFetchedAt, &s.LastChangedAt,
			&s.FetchIntervalHours, &s.Enabled,
			&s.CreatedAt, &s.UpdatedAt,
		); err != nil {
			return nil, err
		}
		s.Board = curriculum.Board(board)
		out = append(out, s)
	}
	return out, rows.Err()
}
