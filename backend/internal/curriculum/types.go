// Package curriculum defines the shared types for the Official Curriculum
// Intelligence Engine. All sub-packages import from here.
//
// Architecture contract:
//   - ALL curriculum intelligence lives in this backend package.
//   - Frontend only calls the REST API — it never computes recommendations.
//   - Changes are NEVER auto-applied. Every change requires admin approval.
//   - School overrides ALWAYS win over board templates.
package curriculum

import (
	"encoding/json"
	"time"
)

// ---------------------------------------------------------------------------
// Core enumerations
// ---------------------------------------------------------------------------

// Board is a recognized curriculum authority.
type Board string

const (
	BoardCBSE      Board = "CBSE"
	BoardICSE      Board = "ICSE"
	BoardIB        Board = "IB"
	BoardCambridge Board = "Cambridge"
	BoardCustom    Board = "Custom"
)

// AllBoards lists every valid Board value.
var AllBoards = []Board{BoardCBSE, BoardICSE, BoardIB, BoardCambridge, BoardCustom}

// GradeGroup maps a school grade band to a canonical identifier.
type GradeGroup string

const (
	GradeGroupPreK     GradeGroup = "preK"      // Nursery / KG
	GradeGroupPrimary  GradeGroup = "primary"   // I–V
	GradeGroupMiddle   GradeGroup = "middle"    // VI–VIII
	GradeGroupSec      GradeGroup = "secondary" // IX–X
	GradeGroupSrSec    GradeGroup = "srSec"     // XI–XII
)

// GradeGroupOrder defines priority for dominant-group resolution (highest first).
var GradeGroupOrder = []GradeGroup{
	GradeGroupSrSec, GradeGroupSec, GradeGroupMiddle,
	GradeGroupPrimary, GradeGroupPreK,
}

// ChangeStatus is the review lifecycle state.
type ChangeStatus string

const (
	StatusPending   ChangeStatus = "pending"
	StatusReviewing ChangeStatus = "reviewing"
	StatusApproved  ChangeStatus = "approved"
	StatusRejected  ChangeStatus = "rejected"
)

// ChangeType classifies what changed in the curriculum.
type ChangeType string

const (
	ChangeSubjectAdded    ChangeType = "subject_added"
	ChangeSubjectRemoved  ChangeType = "subject_removed"
	ChangeSlotsChanged    ChangeType = "slots_changed"
	ChangeGradeChanged    ChangeType = "grade_changed"
	ChangeStreamChanged   ChangeType = "stream_changed"
	ChangeLabChanged      ChangeType = "lab_changed"
	ChangeMandatoryChanged ChangeType = "mandatory_changed"
	ChangeMetadataChanged ChangeType = "metadata_changed"
)

// ---------------------------------------------------------------------------
// Domain models
// ---------------------------------------------------------------------------

// Source represents a trusted external curriculum document (official board PDF,
// syllabus page, etc.). The monitor fetches these on a configurable schedule
// and detects content changes via SHA-256 hash comparison.
type Source struct {
	ID                 string     `json:"id"`
	Board              Board      `json:"board"`
	URL                string     `json:"url"`
	Name               string     `json:"name"`
	ContentHash        *string    `json:"content_hash,omitempty"`
	ETag               *string    `json:"etag,omitempty"`
	LastFetchedAt      *time.Time `json:"last_fetched_at,omitempty"`
	LastChangedAt      *time.Time `json:"last_changed_at,omitempty"`
	FetchIntervalHours int        `json:"fetch_interval_hours"`
	Enabled            bool       `json:"enabled"`
	CreatedAt          time.Time  `json:"created_at"`
	UpdatedAt          time.Time  `json:"updated_at"`
}

// Version is an immutable snapshot of a board's curriculum for one academic year.
// A Version must be approved before its templates are used for recommendations.
type Version struct {
	ID           string       `json:"id"`
	Board        Board        `json:"board"`
	VersionTag   string       `json:"version_tag"`   // e.g. "CBSE_2026"
	AcademicYear string       `json:"academic_year"` // e.g. "2026-27"
	SourceID     *string      `json:"source_id,omitempty"`
	RawContent   *string      `json:"raw_content,omitempty"`
	Status       ChangeStatus `json:"status"`
	ReviewedBy   *string      `json:"reviewed_by,omitempty"`
	ReviewedAt   *time.Time   `json:"reviewed_at,omitempty"`
	Notes        *string      `json:"notes,omitempty"`
	CreatedAt    time.Time    `json:"created_at"`
}

// Change is a single detected difference between the current template state
// and newly fetched source content. It MUST be approved by an admin before
// being applied to curriculum_templates.
type Change struct {
	ID           string          `json:"id"`
	SourceID     string          `json:"source_id"`
	VersionID    *string         `json:"version_id,omitempty"`
	ChangeType   ChangeType      `json:"change_type"`
	SubjectName  string          `json:"subject_name"`
	FieldChanged *string         `json:"field_changed,omitempty"`
	OldValue     json.RawMessage `json:"old_value,omitempty"`
	NewValue     json.RawMessage `json:"new_value,omitempty"`
	Status       ChangeStatus    `json:"status"`
	DetectedAt   time.Time       `json:"detected_at"`
	AppliedAt    *time.Time      `json:"applied_at,omitempty"`
	AppliedBy    *string         `json:"applied_by,omitempty"`
}

// Template is the canonical definition of a subject for a given
// board × grade_group combination. Populated from approved Versions.
// Schools must NOT edit templates directly — they use Overrides.
type Template struct {
	ID           string          `json:"id"`
	Board        Board           `json:"board"`
	GradeGroup   GradeGroup      `json:"grade_group"`
	SubjectName  string          `json:"subject_name"`
	ShortName    string          `json:"short_name"`
	SlotsPerWeek int             `json:"slots_per_week"`
	RequiresLab  bool            `json:"requires_lab"`
	IsLanguage   bool            `json:"is_language"`
	IsActivity   bool            `json:"is_activity"`
	Streams      []string        `json:"streams,omitempty"` // nil = all streams
	VersionID    *string         `json:"version_id,omitempty"`
	IsMandatory  bool            `json:"is_mandatory"`
	Hint         string          `json:"hint"`
	Metadata     json.RawMessage `json:"metadata,omitempty"`
	CreatedAt    time.Time       `json:"created_at"`
	UpdatedAt    time.Time       `json:"updated_at"`
}

// Override is a school-specific adjustment to a curriculum template.
// Fields set to nil inherit from the template; non-nil fields win.
// School overrides ALWAYS take priority — this is the top of the hierarchy.
type Override struct {
	ID                string     `json:"id"`
	SchoolID          string     `json:"school_id"`
	Board             Board      `json:"board"`
	GradeGroup        GradeGroup `json:"grade_group"`
	SubjectName       string     `json:"subject_name"`
	SlotsPerWeek      *int       `json:"slots_per_week,omitempty"`
	IsMandatory       *bool      `json:"is_mandatory,omitempty"`
	CustomSubjectName *string    `json:"custom_subject_name,omitempty"`
	Streams           []string   `json:"streams,omitempty"`
	Notes             *string    `json:"notes,omitempty"`
	CreatedBy         string     `json:"created_by"`
	CreatedAt         time.Time  `json:"created_at"`
	UpdatedAt         time.Time  `json:"updated_at"`
}

// ---------------------------------------------------------------------------
// API response types
// ---------------------------------------------------------------------------

// RecommendedSubject is the merged recommendation returned to the frontend.
// It merges the canonical Template with any applicable school Override,
// following the hierarchy: School Overrides > Board Templates > AI Defaults.
type RecommendedSubject struct {
	SubjectName  string     `json:"subject_name"`
	ShortName    string     `json:"short_name"`
	Board        Board      `json:"board"`
	GradeGroup   GradeGroup `json:"grade_group"`
	SlotsPerWeek int        `json:"slots_per_week"`
	RequiresLab  bool       `json:"requires_lab"`
	IsLanguage   bool       `json:"is_language"`
	IsActivity   bool       `json:"is_activity"`
	Streams      []string   `json:"streams,omitempty"`
	IsMandatory  bool       `json:"is_mandatory"`
	IsOverridden bool       `json:"is_overridden"` // true when a school override was applied
	Confidence   float64    `json:"confidence"`    // 0.0–1.0
	Hint         string     `json:"hint"`
}

// ReviewRequest is the body for POST /curriculum/review.
type ReviewRequest struct {
	ChangeIDs []string     `json:"change_ids"`
	Action    ChangeStatus `json:"action"` // "approved" or "rejected"
	Notes     string       `json:"notes,omitempty"`
	ReviewerID string      `json:"reviewer_id"`
}

// ReviewResult summarises the outcome of a review action.
type ReviewResult struct {
	Applied  int      `json:"applied"`
	Rejected int      `json:"rejected"`
	Errors   []string `json:"errors,omitempty"`
}

// ParsedSubjectEntry is the intermediate representation produced by the
// Python parser microservice, before it is diffed against templates.
type ParsedSubjectEntry struct {
	SubjectName  string     `json:"subject_name"`
	ShortName    string     `json:"short_name"`
	Board        Board      `json:"board"`
	GradeGroup   GradeGroup `json:"grade_group"`
	SlotsPerWeek int        `json:"slots_per_week"`
	RequiresLab  bool       `json:"requires_lab"`
	IsLanguage   bool       `json:"is_language"`
	IsActivity   bool       `json:"is_activity"`
	Streams      []string   `json:"streams,omitempty"`
	IsMandatory  bool       `json:"is_mandatory"`
	Hint         string     `json:"hint"`
	Confidence   float64    `json:"confidence"`
}
