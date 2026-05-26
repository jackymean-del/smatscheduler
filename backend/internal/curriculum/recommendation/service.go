package recommendation

import (
	"context"

	"github.com/jackymean-del/smart-sched/internal/curriculum"
)

// Service wraps the recommendation Engine with application-layer ergonomics.
type Service struct{ engine *Engine }

// NewService creates a recommendation Service.
func NewService(engine *Engine) *Service { return &Service{engine: engine} }

// ForGrade returns merged recommendations for a specific board + grade group.
//
// Parameters:
//   - board:      e.g. "CBSE", "IB"
//   - gradeGroup: e.g. "middle", "srSec"
//   - streams:    e.g. ["science"] — nil means no stream filter (return all)
//   - schoolID:   empty string = no school-level overrides applied
func (s *Service) ForGrade(
	ctx context.Context,
	board curriculum.Board,
	gradeGroup curriculum.GradeGroup,
	streams []string,
	schoolID string,
) ([]curriculum.RecommendedSubject, error) {
	return s.engine.Recommend(ctx, board, gradeGroup, streams, schoolID)
}

// ForAllGrades returns recommendations for every grade group for a board.
func (s *Service) ForAllGrades(
	ctx context.Context,
	board curriculum.Board,
	streams []string,
	schoolID string,
) (map[curriculum.GradeGroup][]curriculum.RecommendedSubject, error) {
	return s.engine.RecommendAll(ctx, board, streams, schoolID)
}
