package handlers

import (
	"log/slog"

	"github.com/gofiber/fiber/v3"
	"github.com/jackymean-del/smart-sched/internal/curriculum"
	"github.com/jackymean-del/smart-sched/internal/curriculum/overrides"
	"github.com/jackymean-del/smart-sched/internal/curriculum/recommendation"
	"github.com/jackymean-del/smart-sched/internal/curriculum/templates"
	"github.com/jackymean-del/smart-sched/internal/curriculum/updater"
	"github.com/jackymean-del/smart-sched/internal/curriculum/validator"
	"github.com/jackymean-del/smart-sched/internal/curriculum/versioning"
)

// CurriculumHandler groups all curriculum API endpoints.
type CurriculumHandler struct {
	tplSvc  *templates.Service
	ovrSvc  *overrides.Service
	verSvc  *versioning.Service
	valSvc  *validator.Service
	updSvc  *updater.Service
	recSvc  *recommendation.Service
}

// NewCurriculumHandler creates a CurriculumHandler with all required services.
func NewCurriculumHandler(db interface{ // *pgxpool.Pool
}) *CurriculumHandler {
	// This constructor signature accepts the pool via the Handler struct.
	// Use NewCurriculumHandlerFromHandler instead.
	return nil
}

// NewCurriculumHandlerFromHandler constructs a CurriculumHandler using the
// shared DB pool from the main Handler struct.
func NewCurriculumHandlerFromHandler(h *Handler) *CurriculumHandler {
	tplSvc := templates.NewService(h.db)
	ovrSvc := overrides.NewService(h.db)
	verSvc := versioning.NewService(h.db)
	valSvc := validator.NewService(h.db)
	updSvc := updater.NewService(h.db)
	engine := recommendation.NewEngine(tplSvc, ovrSvc)
	recSvc := recommendation.NewService(engine)

	return &CurriculumHandler{
		tplSvc: tplSvc,
		ovrSvc: ovrSvc,
		verSvc: verSvc,
		valSvc: valSvc,
		updSvc: updSvc,
		recSvc: recSvc,
	}
}

// ---------------------------------------------------------------------------
// GET /api/v1/curriculum/templates
// Query params: board, grade_group, stream, school_id
// Returns merged recommendations (templates + school overrides).
// ---------------------------------------------------------------------------
func (h *CurriculumHandler) GetTemplates(c fiber.Ctx) error {
	board := curriculum.Board(c.Query("board", "CBSE"))
	gradeGroupStr := c.Query("grade_group", "")
	streamStr := c.Query("stream", "")
	schoolID := c.Query("school_id", "")

	var streams []string
	if streamStr != "" {
		streams = []string{streamStr}
	}

	if gradeGroupStr == "" {
		// Return all grade groups
		result, err := h.recSvc.ForAllGrades(c.Context(), board, streams, schoolID)
		if err != nil {
			slog.Error("curriculum.GetTemplates ForAllGrades", "err", err)
			return fiber.NewError(fiber.StatusInternalServerError, "failed to load templates")
		}
		// Flatten into a single slice with grade_group field
		type entry struct {
			GradeGroup string                        `json:"grade_group"`
			Subjects   []curriculum.RecommendedSubject `json:"subjects"`
		}
		var out []entry
		for _, gg := range curriculum.GradeGroupOrder {
			if subs, ok := result[gg]; ok && len(subs) > 0 {
				out = append(out, entry{GradeGroup: string(gg), Subjects: subs})
			}
		}
		return c.JSON(fiber.Map{
			"board":  string(board),
			"groups": out,
		})
	}

	gg := curriculum.GradeGroup(gradeGroupStr)
	subs, err := h.recSvc.ForGrade(c.Context(), board, gg, streams, schoolID)
	if err != nil {
		slog.Error("curriculum.GetTemplates ForGrade", "err", err)
		return fiber.NewError(fiber.StatusInternalServerError, "failed to load templates")
	}
	return c.JSON(fiber.Map{
		"board":       string(board),
		"grade_group": gradeGroupStr,
		"subjects":    subs,
	})
}

// ---------------------------------------------------------------------------
// GET /api/v1/curriculum/boards
// Returns list of boards with template data.
// ---------------------------------------------------------------------------
func (h *CurriculumHandler) GetBoards(c fiber.Ctx) error {
	boards, err := h.tplSvc.BoardsAvailable(c.Context())
	if err != nil {
		slog.Error("curriculum.GetBoards", "err", err)
		return fiber.NewError(fiber.StatusInternalServerError, "failed to load boards")
	}
	labels := map[curriculum.Board]string{
		curriculum.BoardCBSE:      "CBSE — Central Board of Secondary Education",
		curriculum.BoardICSE:      "ICSE/ISC — Council for Indian School Certificate Examinations",
		curriculum.BoardIB:        "IB — International Baccalaureate",
		curriculum.BoardCambridge: "Cambridge — Cambridge Assessment International Education",
		curriculum.BoardCustom:    "Custom",
	}
	type boardInfo struct {
		ID    string `json:"id"`
		Label string `json:"label"`
	}
	var out []boardInfo
	for _, b := range boards {
		out = append(out, boardInfo{ID: string(b), Label: labels[b]})
	}
	return c.JSON(fiber.Map{"boards": out})
}

// ---------------------------------------------------------------------------
// GET /api/v1/curriculum/changes
// Query params: status (default: pending), source_id
// ---------------------------------------------------------------------------
func (h *CurriculumHandler) GetChanges(c fiber.Ctx) error {
	status := curriculum.ChangeStatus(c.Query("status", string(curriculum.StatusPending)))
	changes, err := h.valSvc.ListByStatus(c.Context(), status)
	if err != nil {
		slog.Error("curriculum.GetChanges", "err", err)
		return fiber.NewError(fiber.StatusInternalServerError, "failed to load changes")
	}
	return c.JSON(fiber.Map{
		"status":  string(status),
		"changes": changes,
		"total":   len(changes),
	})
}

// ---------------------------------------------------------------------------
// POST /api/v1/curriculum/review
// Body: { change_ids: [], action: "approved"|"rejected", notes: "", reviewer_id: "" }
//
// CRITICAL: This is the ONLY way changes are applied. Never auto-applied.
// ---------------------------------------------------------------------------
func (h *CurriculumHandler) ReviewChanges(c fiber.Ctx) error {
	var req curriculum.ReviewRequest
	if err := c.Bind().JSON(&req); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "invalid request body")
	}
	if len(req.ChangeIDs) == 0 {
		return fiber.NewError(fiber.StatusBadRequest, "change_ids required")
	}
	if req.Action != curriculum.StatusApproved && req.Action != curriculum.StatusRejected {
		return fiber.NewError(fiber.StatusBadRequest, "action must be 'approved' or 'rejected'")
	}
	if req.ReviewerID == "" {
		// Fall back to JWT user if available
		if uid, ok := c.Locals("user_id").(string); ok {
			req.ReviewerID = uid
		}
	}

	var updated []string
	var err error

	switch req.Action {
	case curriculum.StatusApproved:
		updated, err = h.valSvc.Approve(c.Context(), req.ChangeIDs, req.ReviewerID, req.Notes)
	case curriculum.StatusRejected:
		updated, err = h.valSvc.Reject(c.Context(), req.ChangeIDs, req.ReviewerID, req.Notes)
	}
	if err != nil {
		slog.Error("curriculum.ReviewChanges", "action", req.Action, "err", err)
		return fiber.NewError(fiber.StatusInternalServerError, "review failed")
	}

	result := curriculum.ReviewResult{
		Applied:  len(updated),
		Rejected: len(req.ChangeIDs) - len(updated),
	}
	return c.JSON(result)
}

// ---------------------------------------------------------------------------
// POST /api/v1/curriculum/apply
// Applies all approved-but-unapplied changes to curriculum_templates.
// Requires admin role. Safe to call multiple times (idempotent for already
// applied changes).
// ---------------------------------------------------------------------------
func (h *CurriculumHandler) ApplyApproved(c fiber.Ctx) error {
	applied, errs := h.updSvc.ApplyApproved(c.Context())

	var errMsgs []string
	for _, e := range errs {
		errMsgs = append(errMsgs, e.Error())
		slog.Error("curriculum.ApplyApproved error", "err", e)
	}

	return c.JSON(fiber.Map{
		"applied_count": len(applied),
		"applied_ids":   applied,
		"errors":        errMsgs,
	})
}

// ---------------------------------------------------------------------------
// POST /api/v1/curriculum/reset
// Resets built-in templates to the seeded defaults.
// Admin-only endpoint. Does NOT touch school overrides.
// ---------------------------------------------------------------------------
func (h *CurriculumHandler) ResetTemplates(c fiber.Ctx) error {
	if err := h.tplSvc.SeedBuiltIn(c.Context()); err != nil {
		slog.Error("curriculum.ResetTemplates", "err", err)
		return fiber.NewError(fiber.StatusInternalServerError, "reset failed")
	}
	return c.JSON(fiber.Map{"message": "templates reset to built-in defaults"})
}

// ---------------------------------------------------------------------------
// GET /api/v1/curriculum/overrides
// Query params: school_id (required), board
// ---------------------------------------------------------------------------
func (h *CurriculumHandler) GetOverrides(c fiber.Ctx) error {
	schoolID := c.Query("school_id", "")
	if schoolID == "" {
		return fiber.NewError(fiber.StatusBadRequest, "school_id required")
	}
	board := curriculum.Board(c.Query("board", ""))
	ovrs, err := h.ovrSvc.ListForSchool(c.Context(), schoolID, board)
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, "failed to load overrides")
	}
	return c.JSON(fiber.Map{"school_id": schoolID, "overrides": ovrs})
}

// ---------------------------------------------------------------------------
// POST /api/v1/curriculum/overrides
// Body: Override object
// ---------------------------------------------------------------------------
func (h *CurriculumHandler) UpsertOverride(c fiber.Ctx) error {
	var o curriculum.Override
	if err := c.Bind().JSON(&o); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "invalid body")
	}
	if o.SchoolID == "" || o.SubjectName == "" {
		return fiber.NewError(fiber.StatusBadRequest, "school_id and subject_name required")
	}
	if o.CreatedBy == "" {
		if uid, ok := c.Locals("user_id").(string); ok {
			o.CreatedBy = uid
		}
	}
	id, err := h.ovrSvc.Upsert(c.Context(), &o)
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, "failed to save override")
	}
	o.ID = id
	return c.Status(fiber.StatusCreated).JSON(o)
}

// ---------------------------------------------------------------------------
// DELETE /api/v1/curriculum/overrides/:id
// ---------------------------------------------------------------------------
func (h *CurriculumHandler) DeleteOverride(c fiber.Ctx) error {
	id := c.Params("id")
	if err := h.ovrSvc.Delete(c.Context(), id); err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, "failed to delete override")
	}
	return c.JSON(fiber.Map{"id": id, "deleted": true})
}

// ---------------------------------------------------------------------------
// GET /api/v1/curriculum/versions
// Query params: board
// ---------------------------------------------------------------------------
func (h *CurriculumHandler) GetVersions(c fiber.Ctx) error {
	board := curriculum.Board(c.Query("board", ""))
	versions, err := h.verSvc.List(c.Context(), board)
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, "failed to load versions")
	}
	return c.JSON(fiber.Map{"versions": versions})
}
