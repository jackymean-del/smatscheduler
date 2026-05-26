"""
pdf_extractor — Python microservice
Extracts plain text from PDF or HTML curriculum documents.

POST /extract
    Body: { "content": <bytes>, "board": "CBSE"|"ICSE"|"IB"|"Cambridge" }
    Returns: { "text": "...", "pages": N, "method": "pdfplumber"|"pymupdf"|"html" }

Requirements:
    pip install flask pdfplumber pymupdf beautifulsoup4 lxml
"""

import hashlib
import io
import logging
from flask import Flask, request, jsonify

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger(__name__)

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 60 * 1024 * 1024  # 60 MB

# ---------------------------------------------------------------------------
# Text extraction strategies
# ---------------------------------------------------------------------------


def extract_pdf_pdfplumber(data: bytes) -> tuple[str, int]:
    """Primary extractor: pdfplumber (better text layout preservation)."""
    import pdfplumber  # type: ignore

    text_parts = []
    with pdfplumber.open(io.BytesIO(data)) as pdf:
        n_pages = len(pdf.pages)
        for page in pdf.pages:
            t = page.extract_text(x_tolerance=2, y_tolerance=2)
            if t:
                text_parts.append(t)
    return "\n\n".join(text_parts), n_pages


def extract_pdf_pymupdf(data: bytes) -> tuple[str, int]:
    """Fallback extractor: PyMuPDF (fitz) — faster, less layout-aware."""
    import fitz  # type: ignore  # PyMuPDF

    text_parts = []
    doc = fitz.open(stream=data, filetype="pdf")
    n_pages = doc.page_count
    for page in doc:
        text_parts.append(page.get_text("text"))
    doc.close()
    return "\n\n".join(text_parts), n_pages


def extract_html(data: bytes) -> tuple[str, int]:
    """Extract text from HTML documents (Cambridge/IB web pages)."""
    from bs4 import BeautifulSoup  # type: ignore

    soup = BeautifulSoup(data, "lxml")
    # Remove boilerplate nav/footer
    for tag in soup.find_all(["nav", "footer", "script", "style", "header"]):
        tag.decompose()
    text = soup.get_text(separator="\n", strip=True)
    return text, 1


def is_pdf(data: bytes) -> bool:
    return data[:4] == b"%PDF"


def is_html(data: bytes) -> bool:
    snippet = data[:512].lower()
    return b"<!doctype html" in snippet or b"<html" in snippet


# ---------------------------------------------------------------------------
# Route
# ---------------------------------------------------------------------------


@app.route("/extract", methods=["POST"])
def extract():
    body = request.get_json(force=True, silent=True)
    if not body:
        return jsonify({"error": "invalid JSON body"}), 400

    raw = body.get("content")
    board = body.get("board", "UNKNOWN")

    if not raw:
        return jsonify({"error": "content required"}), 400

    # Content may arrive as a list of ints (JSON bytes array)
    if isinstance(raw, list):
        data = bytes(raw)
    elif isinstance(raw, str):
        # base64-encoded
        import base64
        data = base64.b64decode(raw)
    else:
        return jsonify({"error": "content must be bytes array or base64 string"}), 400

    content_hash = hashlib.sha256(data).hexdigest()[:12]
    log.info("extract: board=%s size=%d hash=%s", board, len(data), content_hash)

    text = ""
    pages = 0
    method = "unknown"

    try:
        if is_pdf(data):
            try:
                text, pages = extract_pdf_pdfplumber(data)
                method = "pdfplumber"
            except Exception as e:
                log.warning("pdfplumber failed (%s), falling back to pymupdf", e)
                text, pages = extract_pdf_pymupdf(data)
                method = "pymupdf"
        elif is_html(data):
            text, pages = extract_html(data)
            method = "html"
        else:
            # Try PDF anyway (some servers return PDF without correct magic bytes)
            try:
                text, pages = extract_pdf_pdfplumber(data)
                method = "pdfplumber-fallback"
            except Exception:
                text = data.decode("utf-8", errors="replace")
                pages = 1
                method = "raw-text"
    except Exception as e:
        log.error("extraction failed: %s", e)
        return jsonify({"error": f"extraction failed: {e}"}), 500

    log.info("extract: method=%s pages=%d chars=%d", method, pages, len(text))
    return jsonify({"text": text, "pages": pages, "method": method})


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "service": "pdf_extractor"})


if __name__ == "__main__":
    import os
    port = int(os.environ.get("PORT", 5001))
    log.info("pdf_extractor starting on port %d", port)
    app.run(host="0.0.0.0", port=port, debug=False)
