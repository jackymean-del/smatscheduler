package versioning

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jackymean-del/smart-sched/internal/curriculum"
)

// Service is the application-layer entry point for version management.
type Service struct{ repo *Repository }

// NewService returns a Service.
func NewService(db *pgxpool.Pool) *Service { return &Service{repo: NewRepository(db)} }

// List returns all versions, optionally filtered by board.
func (s *Service) List(ctx context.Context, board curriculum.Board) ([]curriculum.Version, error) {
	return s.repo.List(ctx, board)
}

// Get retrieves one version by ID.
func (s *Service) Get(ctx context.Context, id string) (*curriculum.Version, error) {
	return s.repo.Get(ctx, id)
}

// LatestApproved returns the most recent approved version for a board.
func (s *Service) LatestApproved(ctx context.Context, board curriculum.Board) (*curriculum.Version, error) {
	return s.repo.LatestApproved(ctx, board)
}

// GetRepository exposes the underlying repository for use by the parser
// and updater packages that need direct DB-level access.
func (s *Service) GetRepository() *Repository { return s.repo }
