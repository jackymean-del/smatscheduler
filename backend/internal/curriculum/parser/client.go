// Package parser orchestrates the extraction of structured curriculum data
// from raw document bytes by calling the Python microservices, then diffing
// the result against existing curriculum_templates to produce Change records.
package parser

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/jackymean-del/smart-sched/internal/curriculum"
)

// pythonClient is the HTTP client used for Python microservice calls.
var pythonClient = &http.Client{Timeout: 120 * time.Second}

// PythonServiceConfig holds endpoints for the Python microservices.
type PythonServiceConfig struct {
	// PDFExtractorURL is the base URL for the pdf_extractor microservice.
	// e.g. "http://localhost:5001"
	PDFExtractorURL string
	// SyllabusParserURL is the base URL for the syllabus_parser microservice.
	// e.g. "http://localhost:5002"
	SyllabusParserURL string
}

// DefaultConfig returns config pointing at local Python services.
func DefaultConfig() PythonServiceConfig {
	return PythonServiceConfig{
		PDFExtractorURL:   "http://localhost:5001",
		SyllabusParserURL: "http://localhost:5002",
	}
}

// extractText calls the pdf_extractor Python microservice to convert raw
// document bytes (PDF or HTML) into plain text.
func extractText(ctx context.Context, cfg PythonServiceConfig, body []byte, board curriculum.Board) (string, error) {
	payload, _ := json.Marshal(map[string]any{
		"content": body,
		"board":   string(board),
	})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		cfg.PDFExtractorURL+"/extract", bytes.NewReader(payload))
	if err != nil {
		return "", fmt.Errorf("extractText build req: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := pythonClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("extractText POST: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("extractText HTTP %d", resp.StatusCode)
	}

	var out struct {
		Text string `json:"text"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return "", fmt.Errorf("extractText decode: %w", err)
	}
	return out.Text, nil
}

// parseSubjects calls the syllabus_parser Python microservice to extract
// structured subject entries from plain text.
func parseSubjects(
	ctx context.Context,
	cfg PythonServiceConfig,
	text string,
	board curriculum.Board,
) ([]curriculum.ParsedSubjectEntry, error) {
	payload, _ := json.Marshal(map[string]any{
		"text":  text,
		"board": string(board),
	})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		cfg.SyllabusParserURL+"/parse", bytes.NewReader(payload))
	if err != nil {
		return nil, fmt.Errorf("parseSubjects build req: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := pythonClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("parseSubjects POST: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("parseSubjects HTTP %d", resp.StatusCode)
	}

	var out struct {
		Subjects []curriculum.ParsedSubjectEntry `json:"subjects"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return nil, fmt.Errorf("parseSubjects decode: %w", err)
	}
	return out.Subjects, nil
}
