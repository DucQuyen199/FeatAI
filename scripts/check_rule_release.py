#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]
RULES = ROOT / "config" / "rules" / "invoice_rules.example.yaml"
MANIFEST = ROOT / "legal" / "manifest.json"


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate legal and segregation-of-duties gates for a rule release")
    parser.add_argument("--production", action="store_true", help="Require an approved, production-eligible ruleset")
    args = parser.parse_args()
    config = yaml.safe_load(RULES.read_text(encoding="utf-8"))
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    manifest_documents = {item["id"]: item for item in manifest["documents"]}
    manifest_ids = set(manifest_documents)
    ruleset = config["ruleset"]
    failures: list[str] = []
    warnings: list[str] = []

    if ruleset.get("legal_snapshot") != manifest.get("snapshot_date"):
        failures.append("ruleset legal_snapshot must match the verified manifest snapshot")

    if args.production and ruleset.get("status") != "approved":
        failures.append("ruleset status must be approved")
    identities = [ruleset.get("author"), ruleset.get("reviewer"), ruleset.get("approver")]
    if ruleset.get("status") == "approved":
        if any(not item for item in identities):
            failures.append("author, reviewer and approver are mandatory")
        elif len(set(identities)) != 3:
            failures.append("author, reviewer and approver must be three distinct identities")
        if not ruleset.get("rollback_target"):
            failures.append("approved release requires rollback_target")
    else:
        warnings.append("ruleset remains draft and cannot run in production")

    for rule in config["rules"]:
        prefix = rule["id"]
        if rule.get("status") == "approved" and ruleset.get("status") != "approved":
            failures.append(f"{prefix}: rule cannot be approved inside a draft ruleset")
        tests = rule.get("tests", {})
        for case in ("positive", "negative", "boundary"):
            if not tests.get(case):
                failures.append(f"{prefix}: missing {case} test fixture")
        for basis in rule.get("legal_basis", []):
            if basis["document_id"] not in manifest_ids:
                failures.append(f"{prefix}: unknown document_id {basis['document_id']}")
                continue
            document = manifest_documents[basis["document_id"]]
            if document["effective"] > str(ruleset.get("effective_from")):
                failures.append(f"{prefix}: {basis['document_id']} is not effective on ruleset effective_from")
            if basis.get("locator") == "TODO_LEGAL_REVIEW":
                message = f"{prefix}: legal locator is pending for {basis['document_id']}"
                (failures if args.production else warnings).append(message)
            elif "trang" not in str(basis.get("locator", "")).lower():
                message = f"{prefix}: locator lacks an exact PDF page for {basis['document_id']}"
                (failures if args.production else warnings).append(message)

    for warning in warnings:
        print(f"WARNING: {warning}")
    if failures:
        for failure in failures:
            print(f"ERROR: {failure}")
        return 1
    print(f"Rule release check OK ({len(config['rules'])} rules, status={ruleset['status']})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
