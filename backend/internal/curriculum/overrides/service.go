package overrides

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jackymean-del/smart-sched/internal/curriculum"
)

// Service is the application-layer entry point for override management.
type Service struct{ repo *Repository }

// NewService creates an overrides Service.
func NewService(db *pgxpool.Pool) *Service { return &Service{repo: NewRepository(db)} }

// ListForSchool returns all overrides for a school.
func (s *Service) ListForSchool(
	ctx context.Context,
	schoolID string,
	board curriculum.Board,
) ([]curriculum.Override, error) {
	return s.repo.ListForSchool(ctx, schoolID, board)
}

// Upsert creates or updates a school override.
func (s *Service) Upsert(ctx context.Context, o *curriculum.Override) (string, error) {
	return s.repo.Upsert(ctx, o)
}

// Delete removes an override by ID.
func (s *Service) Delete(ctx context.Context, id string) error {
	return s.repo.Delete(ctx, id)
}

// MapBySubject returns a lookup map for the recommendation engine.
func (s *Service) MapBySubject(
	ctx context.Context,
	schoolID string,
	board curriculum.Board,
	gradeGroup curriculum.GradeGroup,
) (map[string]*curriculum.Override, error) {
	return s.repo.MapBySubject(ctx, schoolID, board, gradeGroup)
}
