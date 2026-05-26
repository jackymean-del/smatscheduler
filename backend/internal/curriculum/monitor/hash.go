// Package monitor provides the background goroutine that periodically fetches
// curriculum source documents and detects content changes via hash comparison.
package monitor

import (
	"crypto/sha256"
	"fmt"
	"io"
	"net/http"
	"time"
)

// defaultClient is shared across all fetch calls; timeouts prevent hangs.
var defaultClient = &http.Client{
	Timeout: 60 * time.Second,
}

// FetchResult holds the raw bytes, computed hash, and ETag of a successful
// HTTP fetch.
type FetchResult struct {
	Body        []byte
	ContentHash string // hex-encoded SHA-256
	ETag        string // may be empty if the server doesn't send one
	StatusCode  int
	NotModified bool // true when HTTP 304 was returned
}

// Fetch performs a conditional GET against url.  If etag is non-empty,
// an If-None-Match header is sent; a 304 response sets NotModified = true.
func Fetch(url string, etag string) (*FetchResult, error) {
	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		return nil, fmt.Errorf("fetch build request %s: %w", url, err)
	}
	req.Header.Set("User-Agent", "SmartSched-CurriculumMonitor/1.0")
	if etag != "" {
		req.Header.Set("If-None-Match", etag)
	}

	resp, err := defaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("fetch GET %s: %w", url, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNotModified {
		return &FetchResult{
			StatusCode:  http.StatusNotModified,
			NotModified: true,
			ETag:        resp.Header.Get("ETag"),
		}, nil
	}

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("fetch %s: HTTP %d", url, resp.StatusCode)
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, 50*1024*1024)) // 50 MB cap
	if err != nil {
		return nil, fmt.Errorf("fetch read body %s: %w", url, err)
	}

	hash := sha256.Sum256(body)
	return &FetchResult{
		Body:        body,
		ContentHash: fmt.Sprintf("%x", hash),
		ETag:        resp.Header.Get("ETag"),
		StatusCode:  resp.StatusCode,
	}, nil
}

// HashBytes returns the hex-encoded SHA-256 of b.
func HashBytes(b []byte) string {
	h := sha256.Sum256(b)
	return fmt.Sprintf("%x", h)
}

// HashChanged reports whether newHash differs from storedHash.
// If storedHash is empty (first fetch) it is always considered changed.
func HashChanged(storedHash, newHash string) bool {
	return storedHash == "" || storedHash != newHash
}
