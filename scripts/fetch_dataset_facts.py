#!/usr/bin/env python3
"""One-off: Hugging Face facts for each candidate dataset in data/yugos-match/dataset-candidates.csv.

For rows with an `hf` id: licence, gating, creation and last-change dates, downloads, size/task/language tags (Hub API),
and total rows per split (datasets-server /size). Writes data/yugos-match/dataset-facts.json. No dataset contents are
downloaded. A token in HF_TOKEN (optional) lets gated cards be read.

Usage: HF_TOKEN=... python3 -I scripts/fetch_dataset_facts.py
"""
from __future__ import annotations

import csv
import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DIR = ROOT / "data" / "yugos-match"


def get(url: str) -> dict | None:
    req = urllib.request.Request(url, headers={"User-Agent": "dataset-facts"})
    if os.environ.get("HF_TOKEN"):
        req.add_header("Authorization", f"Bearer {os.environ['HF_TOKEN']}")
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code in (401, 403, 404):
                return {"_error": e.code}
            time.sleep(2 * (attempt + 1))
        except Exception:  # noqa: BLE001 - network hiccup: retry
            time.sleep(2 * (attempt + 1))
    return {"_error": "timeout"}


def main() -> int:
    rows = list(csv.DictReader((DIR / "dataset-candidates.csv").open(encoding="utf-8")))
    out = {}
    for r in rows:
        hf = r["hf"].strip()
        rec = {"id": r["id"], "hf": hf or None}
        if hf:
            info = get(f"https://huggingface.co/api/datasets/{hf}") or {}
            if "_error" in info:
                rec["hub_error"] = info["_error"]
            else:
                card = info.get("cardData") or {}
                tags = info.get("tags") or []
                rec.update({
                    "licence": card.get("license") or next((t.split(":", 1)[1] for t in tags if t.startswith("license:")), None),
                    "gated": info.get("gated") or False,
                    "created": (info.get("createdAt") or "")[:10] or None,
                    "last_modified": (info.get("lastModified") or "")[:10] or None,
                    "downloads": info.get("downloads"),
                    "size_category": next((t.split(":", 1)[1] for t in tags if t.startswith("size_categories:")), None),
                    "task_categories": [t.split(":", 1)[1] for t in tags if t.startswith("task_categories:")],
                    "languages": [t.split(":", 1)[1] for t in tags if t.startswith("language:")],
                })
            size = get(f"https://datasets-server.huggingface.co/size?dataset={hf}") or {}
            if "size" in size:
                splits = {}
                for s in size["size"].get("splits", []):
                    splits[f"{s['config']}/{s['split']}"] = s.get("num_rows")
                rec["rows_total"] = size["size"].get("dataset", {}).get("num_rows")
                rec["rows_by_split"] = splits
            else:
                rec["size_error"] = size.get("_error") or size.get("error")
        out[r["id"]] = rec
        print(r["id"], hf, rec.get("rows_total"), rec.get("licence"), rec.get("hub_error") or "", flush=True)
    (DIR / "dataset-facts.json").write_text(json.dumps(out, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
