// Package recommendation implements the curriculum recommendation engine.
// It merges board templates with school overrides following the hierarchy:
//
//	School Overrides  (always win)
//	    ↓
//	Board Templates   (official board data from curriculum_templates)
//	    ↓
//	AI Defaults       (built-in seed data as fallback)
//
// The engine NEVER hardcodes curriculum logic. All data comes from the DB.
package recommendation

import (
	"context"
	"log/slog"

	"github.com/jackymean-del/smart-sched/internal/curriculum"
	"github.com/jackymean-del/smart-sched/internal/curriculum/overrides"
	"github.com/jackymean-del/smart-sched/internal/curriculum/templates"
)

// Engine computes merged curriculum recommendations.
type Engine struct {
	tplSvc *templates.Service
	ovrSvc *overrides.Service
}

// NewEngine creates a recommendation Engine.
func NewEngine(tplSvc *templates.Service, ovrSvc *overrides.Service) *Engine {
	return &Engine{tplSvc: tplSvc, ovrSvc: ovrSvc}
}

// Recommend returns the merged subject list for the given parameters.
// schoolID may be empty — in that case no overrides are applied.
func (e *Engine) Recommend(
	ctx context.Context,
	board curriculum.Board,
	gradeGroup curriculum.GradeGroup,
	streams []string,
	schoolID string,
) ([]curriculum.RecommendedSubject, error) {
	// 1. Fetch canonical templates for board + grade group
	tpls, err := e.tplSvc.ListByBoardAndGrade(ctx, board, gradeGroup)
	if err != nil {
		return nil, err
	}

	// 2. Fetch school overrides (empty map when schoolID is blank)
	var ovrMap map[string]*curriculum.Override
	if schoolID != "" {
		ovrMap, err = e.ovrSvc.MapBySubject(ctx, schoolID, board, gradeGroup)
		if err != nil {
			// Non-fatal: log and continue without overrides
			slog.Warn("recommendation: failed to load overrides",
				"school_id", schoolID, "err", err)
			ovrMap = map[string]*curriculum.Override{}
		}
	} else {
		ovrMap = map[string]*curriculum.Override{}
	}

	// 3. Filter by stream and merge
	out := make([]curriculum.RecommendedSubject, 0, len(tpls))
	for _, t := range tpls {
		if !matchesStream(t.Streams, streams) {
			continue
		}
		rec := mergeTemplate(t, ovrMap[t.SubjectName])
		out = append(out, rec)
	}

	return out, nil
}

// RecommendAll returns recommendations for all grade groups for a board.
// Useful for the wizard's "AI Assign All" bulk action.
func (e *Engine) RecommendAll(
	ctx context.Context,
	board curriculum.Board,
	streams []string,
	schoolID string,
) (map[curriculum.GradeGroup][]curriculum.RecommendedSubject, error) {
	result := make(map[curriculum.GradeGroup][]curriculum.RecommendedSubject)
	for _, gg := range curriculum.GradeGroupOrder {
		recs, err := e.Recommend(ctx, board, gg, streams, schoolID)
		if err != nil {
			return nil, err
		}
		if len(recs) > 0 {
			result[gg] = recs
		}
	}
	return result, nil
}

// ---------------------------------------------------------------------------
// merge helpers
// ---------------------------------------------------------------------------

// mergeTemplate merges a template with an optional school override.
// The override wins on every field where it is non-nil.
func mergeTemplate(t curriculum.Template, o *curriculum.Override) curriculum.RecommendedSubject {
	rec := curriculum.RecommendedSubject{
		SubjectName:  t.SubjectName,
		ShortName:    t.ShortName,
		Board:        t.Board,
		GradeGroup:   t.GradeGroup,
		SlotsPerWeek: t.SlotsPerWeek,
		RequiresLab:  t.RequiresLab,
		IsLanguage:   t.IsLanguage,
		IsActivity:   t.IsActivity,
		Streams:      t.Streams,
		IsMandatory:  t.IsMandatory,
		Confidence:   1.0, // template-backed = full confidence
		Hint:         t.Hint,
	}

	if o == nil {
		return rec
	}

	// Apply school override (school ALWAYS wins)
	rec.IsOverridden = true
	if o.SlotsPerWeek != nil {
		rec.SlotsPerWeek = *o.SlotsPerWeek
	}
	if o.IsMandatory != nil {
		rec.IsMandatory = *o.IsMandatory
	}
	if o.CustomSubjectName != nil {
		rec.SubjectName = *o.CustomSubjectName
	}
	if len(o.Streams) > 0 {
		rec.Streams = o.Streams
	}
	return rec
}

// matchesStream reports whether a template's streams field is compatible with
// the requested streams. A nil/empty Streams on the template means "all streams".
func matchesStream(tplStreams []string, requestedStreams []string) bool {
	if len(tplStreams) == 0 {
		return true // subject applies to all streams
	}
	if len(requestedStreams) == 0 {
		return true // caller didn't specify a stream filter
	}
	for _, rs := range requestedStreams {
		for _, ts := range tplStreams {
			if ts == rs {
				return true
			}
		}
	}
	return false
}
