-- =============================================================================
-- Migration 005 — Official Curriculum Intelligence Engine
-- Tables: curriculum_sources, curriculum_versions, curriculum_changes,
--         curriculum_templates, school_curriculum_overrides
--
-- IMPORTANT: Changes are NEVER auto-applied. Every change goes through
-- admin review (status: pending → reviewing → approved | rejected).
-- School overrides ALWAYS win over board templates.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- curriculum_sources
-- Trusted registry of official board curriculum documents.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS curriculum_sources (
    id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    board                TEXT        NOT NULL
                             CHECK (board IN ('CBSE','ICSE','IB','Cambridge','Custom')),
    url                  TEXT        NOT NULL UNIQUE,
    name                 TEXT        NOT NULL,
    content_hash         TEXT,          -- SHA-256 of last successfully fetched content
    etag                 TEXT,          -- HTTP ETag for conditional GET
    last_fetched_at      TIMESTAMPTZ,
    last_changed_at      TIMESTAMPTZ,
    fetch_interval_hours INT         NOT NULL DEFAULT 24,
    enabled              BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_curriculum_sources_board
    ON curriculum_sources (board);
CREATE INDEX IF NOT EXISTS idx_curriculum_sources_enabled
    ON curriculum_sources (enabled) WHERE enabled = TRUE;

-- ---------------------------------------------------------------------------
-- curriculum_versions
-- One row per detected board-year snapshot (e.g. CBSE_2026).
-- Status MUST be 'approved' before templates can reference it.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS curriculum_versions (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    board         TEXT        NOT NULL
                      CHECK (board IN ('CBSE','ICSE','IB','Cambridge','Custom')),
    version_tag   TEXT        NOT NULL,   -- e.g. 'CBSE_2026'
    academic_year TEXT        NOT NULL,   -- e.g. '2026-27'
    source_id     UUID        REFERENCES curriculum_sources (id) ON DELETE SET NULL,
    raw_content   TEXT,                   -- full parsed text from source document
    status        TEXT        NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','reviewing','approved','rejected')),
    reviewed_by   UUID,                   -- user_id of the admin reviewer
    reviewed_at   TIMESTAMPTZ,
    notes         TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (board, version_tag)
);

CREATE INDEX IF NOT EXISTS idx_curriculum_versions_board_status
    ON curriculum_versions (board, status);

-- ---------------------------------------------------------------------------
-- curriculum_changes
-- Every detected diff (added subject, removed subject, slot change, etc.)
-- Lives here until an admin approves or rejects it.
-- NEVER auto-applied — status must be set to 'approved' by a human.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS curriculum_changes (
    id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id      UUID        NOT NULL REFERENCES curriculum_sources (id) ON DELETE CASCADE,
    version_id     UUID        REFERENCES curriculum_versions (id) ON DELETE SET NULL,
    change_type    TEXT        NOT NULL
                       CHECK (change_type IN (
                           'subject_added','subject_removed',
                           'slots_changed','grade_changed',
                           'stream_changed','lab_changed',
                           'mandatory_changed','metadata_changed'
                       )),
    subject_name   TEXT        NOT NULL,
    field_changed  TEXT,                  -- which field changed (e.g. 'slots_per_week')
    old_value      JSONB,
    new_value      JSONB,
    status         TEXT        NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending','reviewing','approved','rejected')),
    detected_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    applied_at     TIMESTAMPTZ,
    applied_by     UUID
);

CREATE INDEX IF NOT EXISTS idx_curriculum_changes_source
    ON curriculum_changes (source_id);
CREATE INDEX IF NOT EXISTS idx_curriculum_changes_status
    ON curriculum_changes (status);
CREATE INDEX IF NOT EXISTS idx_curriculum_changes_pending
    ON curriculum_changes (status, detected_at) WHERE status = 'pending';

-- ---------------------------------------------------------------------------
-- curriculum_templates
-- Canonical subject definitions per board × grade_group.
-- Populated from approved versions; never edited directly by schools.
-- Schools use school_curriculum_overrides instead.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS curriculum_templates (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    board           TEXT        NOT NULL
                        CHECK (board IN ('CBSE','ICSE','IB','Cambridge','Custom')),
    grade_group     TEXT        NOT NULL
                        CHECK (grade_group IN ('preK','primary','middle','secondary','srSec')),
    subject_name    TEXT        NOT NULL,
    short_name      TEXT        NOT NULL,
    slots_per_week  INT         NOT NULL CHECK (slots_per_week > 0),
    requires_lab    BOOLEAN     NOT NULL DEFAULT FALSE,
    is_language     BOOLEAN     NOT NULL DEFAULT FALSE,
    is_activity     BOOLEAN     NOT NULL DEFAULT FALSE,
    streams         TEXT[],               -- NULL = all streams; e.g. '{science,commerce}'
    version_id      UUID        REFERENCES curriculum_versions (id) ON DELETE SET NULL,
    is_mandatory    BOOLEAN     NOT NULL DEFAULT TRUE,
    hint            TEXT,                 -- AI hint text surfaced in UI
    metadata        JSONB,                -- arbitrary extra data
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (board, grade_group, subject_name)
);

CREATE INDEX IF NOT EXISTS idx_curriculum_templates_board_grade
    ON curriculum_templates (board, grade_group);
CREATE INDEX IF NOT EXISTS idx_curriculum_templates_board_subject
    ON curriculum_templates (board, subject_name);

-- ---------------------------------------------------------------------------
-- school_curriculum_overrides
-- School-level overrides that ALWAYS win over board templates.
-- A school can override: slots, mandatory flag, subject display name, streams.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS school_curriculum_overrides (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id           UUID        NOT NULL,
    board               TEXT        NOT NULL
                            CHECK (board IN ('CBSE','ICSE','IB','Cambridge','Custom')),
    grade_group         TEXT        NOT NULL
                            CHECK (grade_group IN ('preK','primary','middle','secondary','srSec')),
    subject_name        TEXT        NOT NULL,    -- must match curriculum_templates.subject_name
    slots_per_week      INT         CHECK (slots_per_week IS NULL OR slots_per_week > 0),
    is_mandatory        BOOLEAN,                 -- NULL = use template value
    custom_subject_name TEXT,                    -- school-specific display name
    streams             TEXT[],                  -- NULL = use template value
    notes               TEXT,
    created_by          UUID        NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (school_id, board, grade_group, subject_name)
);

CREATE INDEX IF NOT EXISTS idx_overrides_school_board
    ON school_curriculum_overrides (school_id, board);
CREATE INDEX IF NOT EXISTS idx_overrides_school_grade
    ON school_curriculum_overrides (school_id, board, grade_group);

-- ---------------------------------------------------------------------------
-- Trigger: auto-update updated_at on curriculum_sources
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_sources_updated_at') THEN
        CREATE TRIGGER trg_sources_updated_at
            BEFORE UPDATE ON curriculum_sources
            FOR EACH ROW EXECUTE FUNCTION set_updated_at();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_templates_updated_at') THEN
        CREATE TRIGGER trg_templates_updated_at
            BEFORE UPDATE ON curriculum_templates
            FOR EACH ROW EXECUTE FUNCTION set_updated_at();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_overrides_updated_at') THEN
        CREATE TRIGGER trg_overrides_updated_at
            BEFORE UPDATE ON school_curriculum_overrides
            FOR EACH ROW EXECUTE FUNCTION set_updated_at();
    END IF;
END $$;
