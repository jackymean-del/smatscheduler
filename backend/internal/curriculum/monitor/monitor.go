package monitor

import (
	"context"
	"log/slog"
	"sync"
	"time"

	"github.com/jackymean-del/smart-sched/internal/curriculum"
	"github.com/jackymean-del/smart-sched/internal/curriculum/parser"
	"github.com/jackymean-del/smart-sched/internal/curriculum/sources"
	"github.com/jackymean-del/smart-sched/internal/curriculum/versioning"
)

// Monitor is the background worker that polls curriculum sources on a
// configurable schedule, detects content changes via SHA-256 hash comparison,
// and hands changed documents to the parser for diff generation.
//
// Detected changes are stored as pending curriculum_changes rows — they are
// NEVER auto-applied. An admin must approve each change via the review API.
type Monitor struct {
	sourceSvc  *sources.Service
	versionSvc *versioning.Service
	parserSvc  *parser.Service
	interval   time.Duration // how often to poll for due sources
	stopCh     chan struct{}
	wg         sync.WaitGroup
}

// Config holds Monitor construction parameters.
type Config struct {
	// PollInterval is how often the monitor wakes to check DueSources.
	// Defaults to 5 minutes if zero.
	PollInterval time.Duration
}

// New creates a Monitor.
func New(
	srcSvc *sources.Service,
	verSvc *versioning.Service,
	parseSvc *parser.Service,
	cfg Config,
) *Monitor {
	if cfg.PollInterval == 0 {
		cfg.PollInterval = 5 * time.Minute
	}
	return &Monitor{
		sourceSvc:  srcSvc,
		versionSvc: verSvc,
		parserSvc:  parseSvc,
		interval:   cfg.PollInterval,
		stopCh:     make(chan struct{}),
	}
}

// Start launches the background polling goroutine.
// It returns immediately; call Stop to shut down gracefully.
func (m *Monitor) Start(ctx context.Context) {
	m.wg.Add(1)
	go func() {
		defer m.wg.Done()
		slog.Info("curriculum monitor started", "poll_interval", m.interval)

		// Run once immediately on startup, then on each tick.
		m.runCycle(ctx)

		ticker := time.NewTicker(m.interval)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				m.runCycle(ctx)
			case <-m.stopCh:
				slog.Info("curriculum monitor stopped")
				return
			case <-ctx.Done():
				slog.Info("curriculum monitor context cancelled")
				return
			}
		}
	}()
}

// Stop signals the monitor goroutine to exit and waits for it.
func (m *Monitor) Stop() {
	close(m.stopCh)
	m.wg.Wait()
}

// runCycle fetches all due sources and dispatches each to processSource.
func (m *Monitor) runCycle(ctx context.Context) {
	due, err := m.sourceSvc.DueSources(ctx)
	if err != nil {
		slog.Error("curriculum monitor: DueSources failed", "err", err)
		return
	}
	if len(due) == 0 {
		return
	}
	slog.Info("curriculum monitor: processing due sources", "count", len(due))
	for _, src := range due {
		if ctx.Err() != nil {
			return
		}
		m.processSource(ctx, src)
	}
}

// processSource fetches one source, compares its hash, and if changed,
// hands the raw bytes to the parser service.
func (m *Monitor) processSource(ctx context.Context, src curriculum.Source) {
	etag := ""
	if src.ETag != nil {
		etag = *src.ETag
	}

	result, err := Fetch(src.URL, etag)
	if err != nil {
		slog.Error("curriculum monitor: fetch failed",
			"source_id", src.ID, "url", src.URL, "err", err)
		return
	}

	// 304 Not Modified — server confirmed no change.
	if result.NotModified {
		slog.Debug("curriculum monitor: source not modified (304)",
			"source_id", src.ID, "url", src.URL)
		storedHash := ""
		if src.ContentHash != nil {
			storedHash = *src.ContentHash
		}
		newEtag := result.ETag
		_ = m.sourceSvc.RecordFetch(ctx, src.ID, storedHash, &newEtag, false)
		return
	}

	storedHash := ""
	if src.ContentHash != nil {
		storedHash = *src.ContentHash
	}
	changed := HashChanged(storedHash, result.ContentHash)

	newEtag := &result.ETag
	if result.ETag == "" {
		newEtag = nil
	}
	if err := m.sourceSvc.RecordFetch(ctx, src.ID, result.ContentHash, newEtag, changed); err != nil {
		slog.Error("curriculum monitor: RecordFetch failed",
			"source_id", src.ID, "err", err)
	}

	if !changed {
		slog.Debug("curriculum monitor: source hash unchanged",
			"source_id", src.ID, "hash", result.ContentHash)
		return
	}

	slog.Info("curriculum monitor: source changed — queuing parse",
		"source_id", src.ID, "board", src.Board, "name", src.Name)

	// Hand off to parser asynchronously so one slow parse doesn't block the loop.
	go func(src curriculum.Source, body []byte) {
		if err := m.parserSvc.ParseAndDiff(ctx, src, body); err != nil {
			slog.Error("curriculum monitor: ParseAndDiff failed",
				"source_id", src.ID, "err", err)
		}
	}(src, result.Body)
}
