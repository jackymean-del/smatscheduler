package sources

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jackymean-del/smart-sched/internal/curriculum"
)

// Service orchestrates source management — seeding, listing, and status.
type Service struct {
	repo *Repository
}

// NewService returns a Service backed by the given pool.
func NewService(db *pgxpool.Pool) *Service {
	return &Service{repo: NewRepository(db)}
}

// SeedTrustedSources inserts built-in trusted sources if they do not already
// exist.  Safe to call on every startup; it is idempotent.
func (s *Service) SeedTrustedSources(ctx context.Context) error {
	for _, src := range TrustedRegistry {
		id, err := s.repo.Upsert(ctx, &src)
		if err != nil {
			return fmt.Errorf("SeedTrustedSources %s: %w", src.URL, err)
		}
		slog.Info("curriculum source seeded", "id", id, "board", src.Board, "name", src.Name)
	}
	return nil
}

// ListEnabled returns all enabled sources.
func (s *Service) ListEnabled(ctx context.Context) ([]curriculum.Source, error) {
	return s.repo.ListEnabled(ctx)
}

// ListByBoard returns all sources for a given board.
func (s *Service) ListByBoard(ctx context.Context, board curriculum.Board) ([]curriculum.Source, error) {
	return s.repo.ListByBoard(ctx, board)
}

// Get retrieves a single source by ID.
func (s *Service) Get(ctx context.Context, id string) (*curriculum.Source, error) {
	return s.repo.Get(ctx, id)
}

// DueSources returns sources whose scheduled fetch window has elapsed.
func (s *Service) DueSources(ctx context.Context) ([]curriculum.Source, error) {
	return s.repo.DueSources(ctx)
}

// RecordFetch persists the outcome of one fetch cycle.
func (s *Service) RecordFetch(
	ctx context.Context,
	sourceID string,
	hash string,
	etag *string,
	changed bool,
) error {
	return s.repo.UpdateFetchResult(ctx, sourceID, hash, etag, changed)
}
