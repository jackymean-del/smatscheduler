package main

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"time"

	"github.com/gofiber/fiber/v3"
	"github.com/gofiber/fiber/v3/middleware/cors"
	"github.com/gofiber/fiber/v3/middleware/logger"
	"github.com/gofiber/fiber/v3/middleware/recover"
	"github.com/jackymean-del/smart-sched/internal/curriculum/monitor"
	"github.com/jackymean-del/smart-sched/internal/curriculum/parser"
	"github.com/jackymean-del/smart-sched/internal/curriculum/sources"
	"github.com/jackymean-del/smart-sched/internal/curriculum/templates"
	"github.com/jackymean-del/smart-sched/internal/curriculum/versioning"
	"github.com/jackymean-del/smart-sched/internal/db"
	"github.com/jackymean-del/smart-sched/internal/handlers"
	"github.com/jackymean-del/smart-sched/internal/middleware"
)

func main() {
	// Structured logging (Go 1.21+ slog)
	log := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))
	slog.SetDefault(log)

	// Load env
	if err := loadEnv(); err != nil {
		slog.Warn("no .env file found", "err", err)
	}

	// Database
	pool, err := db.Connect(os.Getenv("DATABASE_URL"))
	if err != nil {
		slog.Error("db connect failed", "err", err)
		os.Exit(1)
	}
	defer pool.Close()

	ctx := context.Background()

	// ---------------------------------------------------------------------------
	// Bootstrap curriculum intelligence system
	// ---------------------------------------------------------------------------

	// 1. Seed trusted document sources (idempotent)
	srcSvc := sources.NewService(pool)
	if err := srcSvc.SeedTrustedSources(ctx); err != nil {
		slog.Warn("curriculum sources seed failed", "err", err)
	}

	// 2. Seed built-in templates (idempotent — ON CONFLICT DO UPDATE)
	tplSvc := templates.NewService(pool)
	if err := tplSvc.SeedBuiltIn(ctx); err != nil {
		slog.Warn("curriculum templates seed failed", "err", err)
	}

	// 3. Start the background monitor
	verSvc := versioning.NewService(pool)
	pythonCfg := parser.PythonServiceConfig{
		PDFExtractorURL:   getenv("PDF_EXTRACTOR_URL", "http://localhost:5001"),
		SyllabusParserURL: getenv("SYLLABUS_PARSER_URL", "http://localhost:5002"),
	}
	parseSvc := parser.NewService(pool, pythonCfg)

	mon := monitor.New(srcSvc, verSvc, parseSvc, monitor.Config{
		PollInterval: time.Duration(getenvInt("CURRICULUM_POLL_MINUTES", 5)) * time.Minute,
	})
	mon.Start(ctx)
	defer mon.Stop()

	// ---------------------------------------------------------------------------
	// HTTP server
	// ---------------------------------------------------------------------------

	app := fiber.New(fiber.Config{
		AppName:      "SmartSched API v3.0",
		ErrorHandler: customError,
	})

	app.Use(recover.New())
	app.Use(logger.New())
	app.Use(cors.New(cors.Config{
		AllowOrigins: []string{getenv("ALLOWED_ORIGINS", "http://localhost:5173")},
		AllowHeaders: []string{"Origin", "Content-Type", "Accept", "Authorization"},
		AllowMethods: []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
	}))

	// Serve built frontend (Fiber v3 — Static is removed; use a 404 fallback)
	app.Get("/*", func(c fiber.Ctx) error {
		return c.SendFile("../frontend/dist/" + c.Params("*"))
	})

	// Health
	app.Get("/health", func(c fiber.Ctx) error {
		return c.JSON(fiber.Map{
			"status": "ok", "service": "SmartSched", "version": "3.0.0",
			"go": "1.26",
		})
	})

	// API v1
	h := handlers.New(pool)
	api := app.Group("/api/v1", middleware.Auth())

	// --- Timetable routes ---
	api.Get("/timetables",                   h.ListTimetables)
	api.Post("/timetables",                  h.CreateTimetable)
	api.Get("/timetables/:id",               h.GetTimetable)
	api.Put("/timetables/:id",               h.UpdateTimetable)
	api.Delete("/timetables/:id",            h.DeleteTimetable)
	api.Post("/timetables/generate",         h.GenerateTimetable)
	api.Post("/timetables/:id/export",       h.ExportTimetable)
	api.Post("/timetables/:id/substitute",   h.Substitute)
	api.Get("/org-config",                   h.GetOrgConfig)

	// --- Curriculum routes ---
	cur := handlers.NewCurriculumHandlerFromHandler(h)

	// Read endpoints — available to authenticated users
	api.Get("/curriculum/templates", cur.GetTemplates)
	api.Get("/curriculum/boards",    cur.GetBoards)
	api.Get("/curriculum/changes",   cur.GetChanges)
	api.Get("/curriculum/versions",  cur.GetVersions)

	// School overrides — per-school read/write
	api.Get("/curriculum/overrides",         cur.GetOverrides)
	api.Post("/curriculum/overrides",        cur.UpsertOverride)
	api.Delete("/curriculum/overrides/:id",  cur.DeleteOverride)

	// Admin-only mutation endpoints
	// POST /curriculum/review — approve or reject pending changes
	// CRITICAL: Changes are NEVER auto-applied; this is the only path.
	api.Post("/curriculum/review", cur.ReviewChanges)

	// POST /curriculum/apply — actually write approved changes to templates
	api.Post("/curriculum/apply",  cur.ApplyApproved)

	// POST /curriculum/reset — restore built-in seed templates
	api.Post("/curriculum/reset",  cur.ResetTemplates)

	port := getenv("PORT", "8080")
	slog.Info("SmartSched API starting", "port", port)
	if err := app.Listen(":" + port); err != nil {
		slog.Error("server error", "err", err)
		os.Exit(1)
	}
}

func customError(c fiber.Ctx, err error) error {
	code := fiber.StatusInternalServerError
	if e, ok := err.(*fiber.Error); ok {
		code = e.Code
	}
	return c.Status(code).JSON(fiber.Map{"error": err.Error(), "code": code})
}

func getenv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func getenvInt(key string, fallback int) int {
	if v := os.Getenv(key); v != "" {
		var n int
		if _, err := fmt.Sscanf(v, "%d", &n); err == nil {
			return n
		}
	}
	return fallback
}

func loadEnv() error {
	// Use godotenv if available
	return nil
}
