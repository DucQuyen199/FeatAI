#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import json
import re
from datetime import date
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "legal" / "manifest.json"
RAW_DIR = (ROOT / "legal" / "raw").resolve()
OFFICIAL_HOSTS = {
    "congbao.chinhphu.vn",
    "datafiles.chinhphu.vn",
    "stc.vinhlong.gov.vn",
    "vanban.chinhphu.vn",
}
REQUIRED_FIELDS = {
    "id",
    "file",
    "title",
    "number",
    "issued",
    "effective",
    "domain",
    "priority",
    "status",
    "use",
    "page_url",
    "pdf_url",
    "local_path",
    "sha256",
    "size_bytes",
    "snapshot_date",
    "source_authority",
    "review_required",
}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def inside_raw(path: Path) -> bool:
    try:
        path.resolve().relative_to(RAW_DIR)
        return True
    except ValueError:
        return False


def main() -> int:
    data = json.loads(MANIFEST.read_text(encoding="utf-8"))
    failures: list[str] = []
    seen_ids: set[str] = set()
    seen_files: set[str] = set()

    if not data.get("snapshot_date"):
        failures.append("MANIFEST: snapshot_date is required")

    for index, doc in enumerate(data.get("documents", []), start=1):
        label = str(doc.get("id", f"document[{index}]"))
        missing = sorted(REQUIRED_FIELDS - set(doc))
        if missing:
            failures.append(f"FIELDS {label}: missing={','.join(missing)}")
            continue

        if doc["id"] in seen_ids:
            failures.append(f"DUPLICATE ID {label}")
        if doc["file"] in seen_files:
            failures.append(f"DUPLICATE FILE {label}: {doc['file']}")
        seen_ids.add(doc["id"])
        seen_files.add(doc["file"])

        path = (ROOT / doc["local_path"]).resolve()
        if not inside_raw(path):
            failures.append(f"PATH {label}: must stay inside {RAW_DIR}")
            continue
        if path.name != doc["file"]:
            failures.append(f"FILE {label}: local_path basename differs from file")
        if not re.fullmatch(r"[a-f0-9]{64}", str(doc["sha256"])):
            failures.append(f"SHA256 FORMAT {label}: expected lowercase hex digest")
        if doc["review_required"] is not True:
            failures.append(f"REVIEW {label}: review_required must be true")
        for field in ("issued", "effective", "snapshot_date"):
            try:
                date.fromisoformat(str(doc[field]))
            except ValueError:
                failures.append(f"DATE {label}.{field}: expected YYYY-MM-DD")
        if str(doc["snapshot_date"]) > str(data["snapshot_date"]):
            failures.append(f"SNAPSHOT {label}: document snapshot is newer than manifest")
        if not path.exists():
            failures.append(f"MISSING {label}: {path}")
            continue
        if path.read_bytes()[:5] != b"%PDF-":
            failures.append(f"FORMAT {label}: not a PDF file")

        for field in ("page_url", "pdf_url"):
            parsed = urlparse(doc[field])
            if parsed.scheme != "https" or parsed.hostname not in OFFICIAL_HOSTS:
                failures.append(f"SOURCE {label}.{field}: expected HTTPS official host, got {doc[field]}")

        actual_size = path.stat().st_size
        actual_hash = sha256(path)
        if actual_size != doc["size_bytes"]:
            failures.append(f"SIZE {label}: expected={doc['size_bytes']} actual={actual_size}")
        if actual_hash != doc["sha256"]:
            failures.append(f"SHA256 {label}: expected={doc['sha256']} actual={actual_hash}")

    if failures:
        print("Legal corpus verification FAILED")
        for item in failures:
            print(f"- {item}")
        return 1

    print(f"Legal corpus verification OK: {len(data['documents'])} PDFs; snapshot={data['snapshot_date']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
