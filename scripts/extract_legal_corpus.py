#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
from multiprocessing import get_context
from pathlib import Path
from typing import Any

import fitz  # PyMuPDF

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "legal" / "manifest.json"
OUT_DIR = ROOT / "legal" / "processed"
MIN_TEXT_CHARS_PER_PAGE = 80
MIN_OCR_CONFIDENCE = 0.55
OCR_SCALE = 1.5
_OCR_WORKER_READER: Any | None = None
_OCR_WORKER_DOCUMENT: fitz.Document | None = None


def normalize_text(text: str) -> str:
    text = text.replace("\u00ad", "")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_ocr_reader() -> Any:
    try:
        import easyocr
    except ImportError as exc:  # pragma: no cover - environment-dependent
        raise RuntimeError("OCR is required. Install requirements-legal-ocr.txt first.") from exc
    return easyocr.Reader(["vi", "en"], gpu=False, verbose=False)


def ocr_page(page: fitz.Page, reader: Any) -> tuple[str, float | None]:
    import numpy as np

    pixmap = page.get_pixmap(matrix=fitz.Matrix(OCR_SCALE, OCR_SCALE), alpha=False)
    image = np.frombuffer(pixmap.samples, dtype=np.uint8).reshape(pixmap.height, pixmap.width, pixmap.n)
    results = reader.readtext(image, detail=1, paragraph=False, batch_size=4)
    results.sort(key=lambda row: (min(point[1] for point in row[0]), row[0][0][0]))
    text = normalize_text("\n".join(str(row[1]) for row in results))
    confidence = sum(float(row[2]) for row in results) / len(results) if results else None
    return text, confidence


def init_ocr_worker(path: str, torch_threads: int) -> None:
    global _OCR_WORKER_DOCUMENT, _OCR_WORKER_READER

    import torch

    torch.set_num_threads(torch_threads)
    _OCR_WORKER_DOCUMENT = fitz.open(path)
    _OCR_WORKER_READER = load_ocr_reader()


def ocr_page_worker(index: int) -> tuple[int, str, float | None]:
    if _OCR_WORKER_DOCUMENT is None or _OCR_WORKER_READER is None:
        raise RuntimeError("OCR worker was not initialized")
    text, confidence = ocr_page(_OCR_WORKER_DOCUMENT[index], _OCR_WORKER_READER)
    return index, text, confidence


def extract_pdf(path: Path, use_ocr: bool, ocr_workers: int = 1) -> tuple[str, list[dict[str, object]], str]:
    document = fitz.open(path)
    native = [normalize_text(page.get_text("text")) for page in document]
    avg_native = sum(map(len, native)) / max(len(native), 1)
    needs_ocr = avg_native < MIN_TEXT_CHARS_PER_PAGE
    should_ocr = needs_ocr and use_ocr
    reader = load_ocr_reader() if should_ocr and ocr_workers == 1 else None
    method = "easyocr_vi_en" if should_ocr else "pymupdf_text"
    ocr_results: dict[int, tuple[str, float | None]] = {}

    if should_ocr and ocr_workers > 1:
        worker_count = min(ocr_workers, len(document))
        torch_threads = max(1, (os.cpu_count() or worker_count) // worker_count)
        context = get_context("spawn")
        with context.Pool(
            processes=worker_count,
            initializer=init_ocr_worker,
            initargs=(str(path), torch_threads),
        ) as pool:
            for completed, (index, text, confidence) in enumerate(pool.imap(ocr_page_worker, range(len(document))), start=1):
                ocr_results[index] = (text, confidence)
                print(f"  OCR page {completed}/{len(document)} ({worker_count} workers)", flush=True)

    pages: list[dict[str, object]] = []
    full: list[str] = []

    for index, page in enumerate(document):
        confidence: float | None = None
        text = native[index]
        if index in ocr_results:
            text, confidence = ocr_results[index]
        elif reader:
            text, confidence = ocr_page(page, reader)
        pages.append(
            {
                "page": index + 1,
                "char_count": len(text),
                "method": method,
                "ocr_confidence": round(confidence, 4) if confidence is not None else None,
                "text": text,
            }
        )
        full.append(f"\n\n--- PAGE {index + 1} ---\n\n{text}")
        if reader:
            print(f"  OCR page {index + 1}/{len(document)}", flush=True)
    return "".join(full).strip(), pages, method


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Extract verified legal PDFs, optionally OCRing image-only files.")
    parser.add_argument("--ocr", action="store_true", help="OCR scan-only PDFs")
    parser.add_argument(
        "--ocr-workers",
        type=int,
        default=1,
        help="Parallel EasyOCR worker processes (default: 1).",
    )
    parser.add_argument(
        "--reuse-pages",
        action="store_true",
        help="Rebuild extraction metadata from existing page JSON without rerunning OCR.",
    )
    parser.add_argument(
        "--documents",
        help="Comma-separated document IDs. Omit to process every manifest document.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.ocr_workers < 1:
        raise ValueError("--ocr-workers must be at least 1")
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    selected = set(args.documents.split(",")) if args.documents else None
    previous_report_path = OUT_DIR / "extraction_report.json"
    previous_report = json.loads(previous_report_path.read_text(encoding="utf-8")) if previous_report_path.exists() else []
    report_by_id = {row["document_id"]: row for row in previous_report}

    for item in manifest["documents"]:
        if selected is not None and item["id"] not in selected:
            continue
        source = (ROOT / item["local_path"]).resolve()
        actual_hash = sha256(source)
        if actual_hash != item["sha256"]:
            raise RuntimeError(f"Checksum mismatch for {item['id']}; extraction stopped (fail closed).")
        if source.read_bytes()[:5] != b"%PDF-":
            raise RuntimeError(f"Invalid PDF signature for {item['id']}")

        stem = Path(item["file"]).stem
        pages_path = OUT_DIR / f"{stem}.pages.json"
        print(f"Extracting {item['id']}...", flush=True)
        if args.reuse_pages and pages_path.exists():
            pages = json.loads(pages_path.read_text(encoding="utf-8"))
            text = "".join(f"\n\n--- PAGE {page['page']} ---\n\n{page.get('text', '')}" for page in pages).strip()
            methods = {str(page.get("method", "unknown")) for page in pages}
            method = "+".join(sorted(methods))
        else:
            text, pages, method = extract_pdf(source, args.ocr, args.ocr_workers)
        page_count = max(len(pages), 1)
        avg_chars = len(text) / page_count
        needs_ocr = avg_chars < MIN_TEXT_CHARS_PER_PAGE
        confidence_values = [float(page["ocr_confidence"]) for page in pages if page.get("ocr_confidence") is not None]
        avg_ocr_confidence = sum(confidence_values) / len(confidence_values) if confidence_values else None
        ocr_quality_low = avg_ocr_confidence is not None and avg_ocr_confidence < MIN_OCR_CONFIDENCE
        (OUT_DIR / f"{stem}.txt").write_text(text, encoding="utf-8")
        (OUT_DIR / f"{stem}.pages.json").write_text(json.dumps(pages, ensure_ascii=False, indent=2), encoding="utf-8")
        report_by_id[item["id"]] = {
            "document_id": item["id"],
            "file": item["file"],
            "source_sha256": actual_hash,
            "page_count": page_count,
            "text_chars": len(text),
            "avg_chars_per_page": round(avg_chars, 2),
            "extraction_method": method,
            "avg_ocr_confidence": (round(avg_ocr_confidence, 4) if avg_ocr_confidence is not None else None),
            "needs_ocr": needs_ocr,
            "ocr_quality_low": ocr_quality_low,
            "eligible_for_rag": not needs_ocr and not ocr_quality_low,
        }
        state = "NEEDS_OCR" if needs_ocr else "LOW_OCR" if ocr_quality_low else "OK"
        print(
            f"{state:10} {item['id']}: {len(text)} chars / {page_count} pages / {method}",
            flush=True,
        )

    ordered_report = [report_by_id[doc["id"]] for doc in manifest["documents"] if doc["id"] in report_by_id]
    previous_report_path.write_text(json.dumps(ordered_report, ensure_ascii=False, indent=2), encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
