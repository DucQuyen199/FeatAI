#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "legal" / "manifest.json"
PROCESSED = ROOT / "legal" / "processed"
OUTPUT = PROCESSED / "legal_chunks.jsonl"
MAX_CHARS = 1800
OVERLAP = 220
MIN_TEXT_CHARS_PER_PAGE = 80
MIN_PAGE_OCR_CONFIDENCE = 0.45
ARTICLE_RE = re.compile(r"(?im)^\s*(Điều\s+\d+[a-zA-Z]?\.\s*[^\n]*)")


def sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def windows(text: str) -> list[str]:
    if len(text) <= MAX_CHARS:
        return [text]
    chunks: list[str] = []
    start = 0
    while start < len(text):
        end = min(start + MAX_CHARS, len(text))
        if end < len(text):
            boundary = max(text.rfind("\n\n", start, end), text.rfind(". ", start, end))
            if boundary > start + MAX_CHARS // 2:
                end = boundary + 1
        chunk = text[start:end].strip()
        if chunk:
            chunks.append(chunk)
        if end >= len(text):
            break
        start = max(end - OVERLAP, start + 1)
    return chunks


def page_sections(text: str, current_article: str) -> tuple[list[tuple[str, str]], str]:
    matches = list(ARTICLE_RE.finditer(text))
    if not matches:
        return [(current_article, text)], current_article
    sections: list[tuple[str, str]] = []
    prefix = text[: matches[0].start()].strip()
    if prefix:
        sections.append((current_article, prefix))
    for index, match in enumerate(matches):
        article = match.group(1).strip()
        end = matches[index + 1].start() if index + 1 < len(matches) else len(text)
        body = text[match.start() : end].strip()
        if body:
            sections.append((article, body))
        current_article = article
    return sections, current_article


def main() -> int:
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    report_path = PROCESSED / "extraction_report.json"
    report = json.loads(report_path.read_text(encoding="utf-8"))
    report_by_id = {row["document_id"]: row for row in report}
    written = 0
    eligible_documents = 0
    excluded_pages = 0
    excluded: list[str] = []

    temporary_output = OUTPUT.with_suffix(".jsonl.tmp")
    with temporary_output.open("w", encoding="utf-8") as out:
        for doc in manifest["documents"]:
            extraction = report_by_id.get(doc["id"])
            pages_path = PROCESSED / f"{Path(doc['file']).stem}.pages.json"
            if (
                not extraction
                or extraction.get("source_sha256") != doc["sha256"]
                or not extraction.get("eligible_for_rag")
                or not pages_path.exists()
            ):
                excluded.append(doc["id"])
                print(f"EXCLUDE unverified/OCR-required: {doc['id']}")
                continue

            pages = json.loads(pages_path.read_text(encoding="utf-8"))
            current_article = "Không xác định điều"
            doc_written = 0
            for page in pages:
                text = str(page.get("text", "")).strip()
                confidence = page.get("ocr_confidence")
                if len(text) < MIN_TEXT_CHARS_PER_PAGE or (
                    page.get("method") == "easyocr_vi_en" and confidence is not None and float(confidence) < MIN_PAGE_OCR_CONFIDENCE
                ):
                    excluded_pages += 1
                    continue
                sections, current_article = page_sections(text, current_article)
                part_index = 0
                for article, section in sections:
                    for body in windows(section):
                        part_index += 1
                        page_number = int(page["page"])
                        locator = f"Trang {page_number} · {article}"
                        record = {
                            "chunk_id": f"{doc['id']}::p{page_number:04d}::{part_index:02d}",
                            "document_id": doc["id"],
                            "number": doc["number"],
                            "title": doc["title"],
                            "effective_from": doc["effective"],
                            "status_at_snapshot": doc["status"],
                            "article": article,
                            "page_start": page_number,
                            "page_end": page_number,
                            "locator": locator,
                            "text": body,
                            "chunk_sha256": sha256_text(body),
                            "extraction_method": extraction["extraction_method"],
                            "ocr_confidence": confidence,
                            "source_page_url": doc["page_url"],
                            "source_pdf_url": doc["pdf_url"],
                            "source_sha256": doc["sha256"],
                            "snapshot_date": manifest["snapshot_date"],
                            "review_status": "machine_extracted_pending_legal_review",
                        }
                        out.write(json.dumps(record, ensure_ascii=False) + "\n")
                        written += 1
                        doc_written += 1
            if doc_written:
                eligible_documents += 1
            else:
                excluded.append(doc["id"])

    temporary_output.replace(OUTPUT)
    index = {
        "snapshot_date": manifest["snapshot_date"],
        "manifest_sha256": hashlib.sha256(MANIFEST.read_bytes()).hexdigest(),
        "documents_in_manifest": len(manifest["documents"]),
        "documents_indexed": eligible_documents,
        "documents_excluded": sorted(set(excluded)),
        "chunks": written,
        "pages_excluded_non_content_or_low_quality": excluded_pages,
        "chunking": {"unit": "pdf_page", "max_chars": MAX_CHARS, "overlap": OVERLAP},
    }
    index_path = PROCESSED / "corpus_index.json"
    temporary_index = index_path.with_suffix(".json.tmp")
    temporary_index.write_text(json.dumps(index, ensure_ascii=False, indent=2), encoding="utf-8")
    temporary_index.replace(index_path)
    print(f"Wrote {written} verified page chunks from {eligible_documents} documents")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
