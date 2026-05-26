"""
syllabus_parser — Python microservice
Parses plain text curriculum documents into structured subject entries.

POST /parse
    Body: { "text": "...", "board": "CBSE"|"ICSE"|"IB"|"Cambridge" }
    Returns: { "subjects": [ ParsedSubjectEntry, ... ] }

POST /compare
    Body: { "board": "...", "grade_group": "...", "parsed": [...], "existing": [...] }
    Returns: { "added": [...], "removed": [...], "changed": [...] }

Requirements:
    pip install flask spacy
    python -m spacy download en_core_web_sm
"""

import re
import logging
from dataclasses import dataclass, asdict
from typing import Optional
from flask import Flask, request, jsonify

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger(__name__)

app = Flask(__name__)

# ---------------------------------------------------------------------------
# Data structures
# ---------------------------------------------------------------------------

GRADE_GROUPS = {
    "preK":     ["nursery", "kg", "kindergarten", "pre-primary", "early years", "reception"],
    "primary":  ["class i", "class ii", "class iii", "class iv", "class v",
                 "grade 1", "grade 2", "grade 3", "grade 4", "grade 5",
                 "year 1", "year 2", "year 3", "year 4", "year 5",
                 "primary"],
    "middle":   ["class vi", "class vii", "class viii",
                 "grade 6", "grade 7", "grade 8",
                 "year 6", "year 7", "year 8",
                 "middle school", "lower secondary"],
    "secondary":["class ix", "class x",
                 "grade 9", "grade 10",
                 "year 9", "year 10",
                 "igcse", "secondary"],
    "srSec":    ["class xi", "class xii",
                 "grade 11", "grade 12",
                 "year 11", "year 12", "year 13",
                 "senior secondary", "a level", "as level", "ib diploma", "ib dp"],
}

# Board-specific slot heuristics.
# If the PDF doesn't state periods/week explicitly, we fall back to these.
SLOT_DEFAULTS: dict[str, dict[str, dict[str, int]]] = {
    "CBSE": {
        "preK":      {"default": 4},
        "primary":   {"default": 5, "english": 6, "mathematics": 5},
        "middle":    {"default": 5, "english": 6, "mathematics": 6, "science": 5},
        "secondary": {"default": 5, "english": 5, "mathematics": 6, "science": 6},
        "srSec":     {"default": 5, "english": 5, "mathematics": 6, "physics": 5, "chemistry": 5},
    },
    "ICSE": {
        "preK":      {"default": 5},
        "primary":   {"default": 5, "english": 7, "mathematics": 6},
        "middle":    {"default": 5, "english": 7, "mathematics": 6},
        "secondary": {"default": 5, "english": 6, "mathematics": 6},
        "srSec":     {"default": 5, "english": 6, "mathematics": 6},
    },
    "IB": {
        "preK":    {"default": 5},
        "primary": {"default": 5, "language arts": 7, "mathematics": 6},
        "middle":  {"default": 5, "language & literature": 5, "mathematics": 5},
        "secondary":{"default": 5},
        "srSec":   {"default": 4, "mathematics: analysis and approaches": 5},
    },
    "Cambridge": {
        "preK":    {"default": 5},
        "primary": {"default": 5, "english": 7, "mathematics": 6},
        "middle":  {"default": 5, "english": 7, "mathematics": 6},
        "secondary":{"default": 5, "english as a first language": 6, "mathematics": 6},
        "srSec":   {"default": 5, "physics": 6, "chemistry": 6, "mathematics": 6},
    },
}

LAB_SUBJECTS = {
    "physics", "chemistry", "biology", "science", "sciences",
    "co-ordinated sciences", "life sciences", "earth science",
}

LANGUAGE_SUBJECTS = {
    "english", "hindi", "french", "german", "spanish", "arabic", "sanskrit",
    "tamil", "telugu", "kannada", "malayalam", "bengali", "urdu",
    "second language", "additional language", "language arts",
    "language & literature", "language acquisition", "language b",
    "language a: literature", "english as a first language",
    "english language", "literature in english",
}

ACTIVITY_SUBJECTS = {
    "physical education", "pe", "art", "arts", "art & craft", "art & design",
    "fine arts", "music", "drama", "theatre", "dance", "sports",
    "creativity activity service", "cas",
}

MANDATORY_SUBJECTS = {
    "english", "mathematics", "math", "maths", "hindi",
    "language arts", "language & literature", "english as a first language",
}

# ---------------------------------------------------------------------------
# Parser
# ---------------------------------------------------------------------------


def detect_grade_group(text_lower: str) -> str:
    """Detect the dominant grade group from surrounding text."""
    for gg, keywords in reversed(list(GRADE_GROUPS.items())):
        for kw in keywords:
            if kw in text_lower:
                return gg
    return "middle"  # safe default


def detect_slots(subject_lower: str, grade_group: str, board: str) -> int:
    """Estimate slots/week from slot defaults."""
    board_defaults = SLOT_DEFAULTS.get(board, SLOT_DEFAULTS.get("CBSE", {}))
    grade_defaults = board_defaults.get(grade_group, {"default": 5})
    # Try exact subject name match first
    for key, val in grade_defaults.items():
        if key != "default" and key in subject_lower:
            return val
    return grade_defaults.get("default", 5)


def normalise_subject(raw: str) -> str:
    """Clean up a raw subject name extracted from text."""
    # Remove Roman-numeral section markers: "VII – Mathematics" → "Mathematics"
    raw = re.sub(r"^(M|[IVX]+)\s*[–—-]\s*", "", raw)
    # Remove leading/trailing punctuation
    raw = raw.strip(".,;:-–— \t\n")
    # Collapse internal whitespace
    raw = re.sub(r"\s+", " ", raw)
    return raw.strip()


def extract_subjects_from_text(text: str, board: str) -> list[dict]:
    """
    Heuristic extraction of subject names from curriculum text.

    Strategies:
    1. Look for lines matching common patterns like "Subject Name  X periods"
    2. Match known subject names against a curated list
    3. Use heading/section structure to detect grade levels
    """
    lines = text.split("\n")
    results: list[dict] = []
    seen_subjects: set[str] = set()
    current_grade_group = "middle"

    # Patterns that strongly indicate a subject listing line
    subject_patterns = [
        # "Mathematics – 5 periods per week"
        re.compile(r"^([A-Za-z &/\-]+?)\s*[–—:]\s*(\d+)\s*periods?", re.IGNORECASE),
        # "Mathematics (5 p/w)"
        re.compile(r"^([A-Za-z &/\-]+?)\s*\((\d+)\s*p(?:eriods?)?(?:/w(?:eek)?)?\)", re.IGNORECASE),
        # "5. Mathematics" (numbered list)
        re.compile(r"^\d+\.\s+([A-Za-z &/\-]{4,50})\s*$"),
        # "• Mathematics" (bullet)
        re.compile(r"^[•·▪▸\-]\s+([A-Za-z &/\-]{4,50})\s*$"),
    ]

    # Known subject names to scan for (case-insensitive)
    known_subjects = [
        "english", "mathematics", "math", "science", "social science",
        "social studies", "hindi", "physics", "chemistry", "biology",
        "history", "geography", "economics", "accountancy", "accounts",
        "business studies", "business", "political science", "sociology",
        "psychology", "computer science", "informatics practices",
        "physical education", "art education", "art & craft", "fine arts",
        "music", "dance", "environmental studies", "evs",
        "environmental activities", "language arts", "language & literature",
        "language acquisition", "language b", "literature in english",
        "theory of knowledge", "tok", "cas",
        "mathematics: analysis and approaches",
        "mathematics: applications and interpretation",
        "english as a first language", "english language",
        "second language", "additional language", "sanskrit", "french",
        "german", "spanish", "history & civics", "commercial studies",
        "computer applications", "co-ordinated sciences",
        "individuals and societies", "design", "general paper",
    ]

    for line in lines:
        stripped = line.strip()
        if not stripped or len(stripped) < 3:
            continue

        lower = stripped.lower()

        # Update grade group context
        for gg, keywords in GRADE_GROUPS.items():
            for kw in keywords:
                if kw in lower:
                    current_grade_group = gg
                    break

        # Try pattern matching
        subject_name = None
        slots = None

        for pat in subject_patterns:
            m = pat.match(stripped)
            if m:
                subject_name = normalise_subject(m.group(1))
                if len(m.groups()) > 1:
                    try:
                        slots = int(m.group(2))
                    except (IndexError, ValueError):
                        pass
                break

        # Try known subject matching if no pattern hit
        if not subject_name:
            for ks in known_subjects:
                if lower == ks or lower.startswith(ks + " ") or lower.startswith(ks + ":"):
                    subject_name = normalise_subject(stripped.split(":")[0].split("(")[0])
                    break

        if not subject_name:
            continue
        if len(subject_name) < 3 or len(subject_name) > 80:
            continue

        subject_key = subject_name.lower()
        if subject_key in seen_subjects:
            continue
        seen_subjects.add(subject_key)

        if slots is None:
            slots = detect_slots(subject_key, current_grade_group, board)

        requires_lab = any(ls in subject_key for ls in LAB_SUBJECTS)
        is_language = any(ls in subject_key for ls in LANGUAGE_SUBJECTS)
        is_activity = any(ls in subject_key for ls in ACTIVITY_SUBJECTS)
        is_mandatory = any(ms in subject_key for ms in MANDATORY_SUBJECTS)

        results.append({
            "subject_name": subject_name,
            "short_name": make_short(subject_name),
            "board": board,
            "grade_group": current_grade_group,
            "slots_per_week": slots,
            "requires_lab": requires_lab,
            "is_language": is_language,
            "is_activity": is_activity,
            "streams": [],
            "is_mandatory": is_mandatory,
            "hint": f"{board} {current_grade_group} — {subject_name}",
            "confidence": 0.75,
        })

    return results


def make_short(name: str) -> str:
    """Generate a short 2-4 char abbreviation from a subject name."""
    words = re.split(r"[\s&/\-:]+", name)
    if len(words) == 1:
        return words[0][:4].upper()
    if len(words) == 2:
        return (words[0][:2] + words[1][:2]).upper()
    # 3+ words: first char of first 3 words
    return "".join(w[0] for w in words[:3]).upper()


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@app.route("/parse", methods=["POST"])
def parse():
    body = request.get_json(force=True, silent=True)
    if not body:
        return jsonify({"error": "invalid JSON"}), 400

    text = body.get("text", "")
    board = body.get("board", "CBSE")

    if not text:
        return jsonify({"subjects": []}), 200

    log.info("parse: board=%s text_chars=%d", board, len(text))
    subjects = extract_subjects_from_text(text, board)
    log.info("parse: extracted %d subjects", len(subjects))
    return jsonify({"subjects": subjects, "board": board})


@app.route("/compare", methods=["POST"])
def compare():
    """
    Diff parsed subjects against existing template subjects.
    Used to detect added, removed, and changed subjects.
    """
    body = request.get_json(force=True, silent=True)
    if not body:
        return jsonify({"error": "invalid JSON"}), 400

    parsed: list[dict] = body.get("parsed", [])
    existing: list[dict] = body.get("existing", [])

    parsed_map = {s["subject_name"].lower(): s for s in parsed}
    existing_map = {s["subject_name"].lower(): s for s in existing}

    added = [s for k, s in parsed_map.items() if k not in existing_map]
    removed = [s for k, s in existing_map.items() if k not in parsed_map]

    changed = []
    for k, p in parsed_map.items():
        if k in existing_map:
            e = existing_map[k]
            diffs = {}
            if p.get("slots_per_week") != e.get("slots_per_week"):
                diffs["slots_per_week"] = {
                    "old": e.get("slots_per_week"),
                    "new": p.get("slots_per_week"),
                }
            if p.get("requires_lab") != e.get("requires_lab"):
                diffs["requires_lab"] = {
                    "old": e.get("requires_lab"),
                    "new": p.get("requires_lab"),
                }
            if diffs:
                changed.append({"subject_name": p["subject_name"], "diffs": diffs})

    return jsonify({
        "added": added,
        "removed": removed,
        "changed": changed,
    })


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "service": "syllabus_parser"})


if __name__ == "__main__":
    import os
    port = int(os.environ.get("PORT", 5002))
    log.info("syllabus_parser starting on port %d", port)
    app.run(host="0.0.0.0", port=port, debug=False)
