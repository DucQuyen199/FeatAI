#!/usr/bin/env python3
from __future__ import annotations

import csv
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "legal" / "manifest.json"
OUTPUT = ROOT / "legal" / "manifest.csv"
FIELDS = [
    "id",
    "number",
    "title",
    "issued",
    "effective",
    "status",
    "domain",
    "priority",
    "use",
    "local_path",
    "sha256",
    "size_bytes",
    "page_url",
    "pdf_url",
    "snapshot_date",
]


def main() -> int:
    data = json.loads(MANIFEST.read_text(encoding="utf-8"))
    with OUTPUT.open("w", encoding="utf-8", newline="") as target:
        writer = csv.DictWriter(target, fieldnames=FIELDS, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(data["documents"])
    print(f"Synchronized {len(data['documents'])} rows to {OUTPUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
