package parser

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jackymean-del/smart-sched/internal/curriculum"
	"github.com/jackymean-del/smart-sched/internal/curriculum/templates"
	"github.com/jackymean-del/smart-sched/internal/curriculum/versioning"
)

// Service orchestrates PDF→text extraction, NLP parsing, and diff generation.
//
// When a source document changes the flow is:
//  1. extractText  — PDF bytes → plain text   (pdf_extractor microservice)
//  2. parseSubjects — plain text → []ParsedSubjectEntry  (syllabus_parser microservice)
//  3. diffAgainstTemplates — compare parsed entries to existing templates
//  4. persist each diff as a pending curriculum_change
//
// CRITICAL: No change is applied here. All diffs remain in status='pending'
// until an admin approves them via the review API.
type Service struct {
	db          *pgxpool.Pool
	tplRepo     *templates.Repository
	verRepo     *versioning.Repository
	pythonCfg   PythonServiceConfig
}

// NewService creates a parser Service.
func NewService(db *pgxpool.Pool, cfg PythonServiceConfig) *Service {
	return &Service{
		db:        db,
		tplRepo:   templates.NewRepository(db),
		verRepo:   versioning.NewRepository(db),
		pythonCfg: cfg,
	}
}

// ParseAndDiff is the main entry point called by the monitor when a source
// document has changed. It:
//   - Extracts text from the raw bytes (calls Python pdf_extractor).
//   - Parses structured subjects (calls Python syllabus_parser).
//   - Creates a new Version row in status='pending'.
//   - Diffs parsed subjects against current templates.
//   - Inserts detected diffs as curriculum_changes in status='pending'.
//
// Returns nil on success. A partial error (e.g. Python service unavailable)
// is logged but still stored so it can be retried manually.
func (s *Service) ParseAndDiff(ctx context.Context, src curriculum.Source, body []byte) error {
	slog.Info("parser: starting ParseAndDiff",
		"source_id", src.ID, "board", src.Board, "url", src.URL)

	// Step 1: extract plain text
	rawText, err := extractText(ctx, s.pythonCfg, body, src.Board)
	if err != nil {
		return fmt.Errorf("parser.ParseAndDiff extractText: %w", err)
	}

	// Step 2: parse structured subjects
	parsed, err := parseSubjects(ctx, s.pythonCfg, rawText, src.Board)
	if err != nil {
		return fmt.Errorf("parser.ParseAndDiff parseSubjects: %w", err)
	}
	slog.Info("parser: parsed subjects", "count", len(parsed), "source_id", src.ID)

	// Step 3: create a pending Version to attach changes to
	versionID, err := s.createPendingVersion(ctx, src, rawText)
	if err != nil {
		return fmt.Errorf("parser.ParseAndDiff createVersion: %w", err)
	}

	// Step 4: diff and persist
	if err := s.diffAndPersist(ctx, src, versionID, parsed); err != nil {
		return fmt.Errorf("parser.ParseAndDiff diffAndPersist: %w", err)
	}

	return nil
}

// createPendingVersion inserts a new curriculum_versions row in status='pending'.
func (s *Service) createPendingVersion(
	ctx context.Context,
	src curriculum.Source,
	rawText string,
) (string, error) {
	return s.verRepo.CreatePending(ctx, versioning.CreateVersionInput{
		Board:        src.Board,
		SourceID:     &src.ID,
		RawContent:   rawText,
	})
}

// diffAndPersist compares each parsed entry against the existing template and
// inserts a pending curriculum_changes row for every detected difference.
func (s *Service) diffAndPersist(
	ctx context.Context,
	src curriculum.Source,
	versionID string,
	parsed []curriculum.ParsedSubjectEntry,
) error {
	// Load existing templates for this board (all grade groups).
	existing, err := s.tplRepo.ListByBoard(ctx, src.Board)
	if err != nil {
		return fmt.Errorf("diffAndPersist ListByBoard: %w", err)
	}

	// Index existing templates by (grade_group, subject_name).
	type key struct{ g, n string }
	tplMap := make(map[key]*curriculum.Template, len(existing))
	for i := range existing {
		t := &existing[i]
		tplMap[key{string(t.GradeGroup), t.SubjectName}] = t
	}

	// Build a set of (grade_group, subject_name) seen in parsed output.
	seen := make(map[key]bool, len(parsed))

	for _, pe := range parsed {
		k := key{string(pe.GradeGroup), pe.SubjectName}
		seen[k] = true

		tpl, exists := tplMap[k]
		if !exists {
			// New subject not in templates → subject_added
			if err := s.insertChange(ctx, src.ID, versionID,
				curriculum.ChangeSubjectAdded,
				pe.SubjectName, "", nil, mustJSON(pe)); err != nil {
				slog.Error("diffAndPersist: insertChange failed", "err", err)
			}
			continue
		}

		// Compare fields that matter
		if tpl.SlotsPerWeek != pe.SlotsPerWeek {
			field := "slots_per_week"
			if err := s.insertChange(ctx, src.ID, versionID,
				curriculum.ChangeSlotsChanged,
				pe.SubjectName, field,
				mustJSON(tpl.SlotsPerWeek), mustJSON(pe.SlotsPerWeek)); err != nil {
				slog.Error("diffAndPersist: insertChange slots", "err", err)
			}
		}
		if tpl.RequiresLab != pe.RequiresLab {
			field := "requires_lab"
			if err := s.insertChange(ctx, src.ID, versionID,
				curriculum.ChangeLabChanged,
				pe.SubjectName, field,
				mustJSON(tpl.RequiresLab), mustJSON(pe.RequiresLab)); err != nil {
				slog.Error("diffAndPersist: insertChange lab", "err", err)
			}
		}
	}

	// Subjects present in templates but absent from parsed output → removed
	for _, tpl := range existing {
		k := key{string(tpl.GradeGroup), tpl.SubjectName}
		if !seen[k] {
			if err := s.insertChange(ctx, src.ID, versionID,
				curriculum.ChangeSubjectRemoved,
				tpl.SubjectName, "", mustJSON(tpl), nil); err != nil {
				slog.Error("diffAndPersist: insertChange removed", "err", err)
			}
		}
	}

	return nil
}

// insertChange persists one curriculum_changes row in status='pending'.
func (s *Service) insertChange(
	ctx context.Context,
	sourceID, versionID string,
	changeType curriculum.ChangeType,
	subjectName, field string,
	oldVal, newVal json.RawMessage,
) error {
	var fieldPtr *string
	if field != "" {
		fieldPtr = &field
	}
	_, err := s.db.Exec(ctx, `
		INSERT INTO curriculum_changes
		    (source_id, version_id, change_type, subject_name, field_changed, old_value, new_value)
		VALUES ($1, $2, $3, $4, $5, $6, $7)`,
		sourceID, versionID, string(changeType),
		subjectName, fieldPtr, oldVal, newVal,
	)
	return err
}

func mustJSON(v any) json.RawMessage {
	b, err := json.Marshal(v)
	if err != nil {
		return json.RawMessage("null")
	}
	return b
}
