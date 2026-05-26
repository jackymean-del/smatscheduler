package templates

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jackymean-del/smart-sched/internal/curriculum"
)

// Service is the application-layer entry point for curriculum templates.
type Service struct{ repo *Repository }

// NewService creates a templates Service.
func NewService(db *pgxpool.Pool) *Service { return &Service{repo: NewRepository(db)} }

// SeedBuiltIn inserts all built-in template seed data.
// Safe to call on every startup — idempotent via ON CONFLICT DO UPDATE.
func (s *Service) SeedBuiltIn(ctx context.Context) error {
	seeds := SeedTemplates()
	for _, t := range seeds {
		if err := s.repo.Upsert(ctx, &t); err != nil {
			return fmt.Errorf("templates.SeedBuiltIn: %w", err)
		}
	}
	slog.Info("curriculum templates seeded", "count", len(seeds))
	return nil
}

// ListByBoard returns all templates for a board.
func (s *Service) ListByBoard(ctx context.Context, board curriculum.Board) ([]curriculum.Template, error) {
	return s.repo.ListByBoard(ctx, board)
}

// ListByBoardAndGrade returns templates for a specific board + grade group.
func (s *Service) ListByBoardAndGrade(
	ctx context.Context,
	board curriculum.Board,
	gradeGroup curriculum.GradeGroup,
) ([]curriculum.Template, error) {
	return s.repo.ListByBoardAndGrade(ctx, board, gradeGroup)
}

// Get retrieves one template by ID.
func (s *Service) Get(ctx context.Context, id string) (*curriculum.Template, error) {
	return s.repo.Get(ctx, id)
}

// BoardsAvailable returns all boards that have template data.
func (s *Service) BoardsAvailable(ctx context.Context) ([]curriculum.Board, error) {
	return s.repo.BoardsWithTemplates(ctx)
}

// GetRepository exposes the underlying repository for packages that need direct
// DB-level access (parser, updater).
func (s *Service) GetRepository() *Repository { return s.repo }
