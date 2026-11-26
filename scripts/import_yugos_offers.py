"""Load the Yugos world card's offers into the database, one row per listing and effort it accepts.

    .venv/bin/python -I scripts/import_yugos_offers.py

Reads data/yugos/models.json (the world card per model, scripts/build_yugos_models.py) and
data/models/yugos-links.csv (Yugos model -> project model ID). Every listing becomes yugos_offers rows
linked to model_configs: one per effort the listing accepts; a listing that takes no effort setting
links to the model's Default configuration. Replaces all offers each run (one transaction).
"""
from __future__ import annotations

import collections
import csv
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import psycopg  # noqa: E402
from psycopg.rows import dict_row  # noqa: E402

from api.config import load_dotenv  # noqa: E402
from importer.writer import Stats, Writer  # noqa: E402

LADDER = {"none", "minimal", "low", "medium", "high", "xhigh", "max"}


def main() -> int:
    load_dotenv(ROOT / ".env")
    dsn = os.environ.get("DATABASE_URL", "postgresql://bench:bench@localhost:5432/llm_bench")
    doc = json.loads((ROOT / "data/yugos/models.json").read_text())
    links = {r["yugos_model"]: r for r in csv.DictReader((ROOT / "data/models/yugos-links.csv").open(newline="", encoding="utf-8"))}
    registry = {r["model_id"]: r for r in csv.DictReader((ROOT / "data/models/registry.csv").open(newline="", encoding="utf-8"))}
    synced = doc.get("world_card", {}).get("synced_at")
    n = collections.Counter()
    unknown_efforts = collections.Counter()
    with psycopg.connect(dsn, row_factory=dict_row, autocommit=True) as conn, conn.transaction():
        w = Writer(conn, Stats("Yugos world card"))
        conn.execute("DELETE FROM yugos_offers")
        for m in doc["models"]:
            link = links.get(m["model"])
            if not link or not link["model_id"]:
                n["no model ID"] += 1
                continue
            key = link["model_id"]
            reg = registry.get(key, {})
            # the model row (created here for Yugos models that have no benchmark data yet)
            row = conn.execute(
                """INSERT INTO models (canonical_key, provider, model_name, aliases) VALUES (%s, %s, %s, %s)
                   ON CONFLICT (canonical_key) DO NOTHING RETURNING id""",
                (key, reg.get("vendor") or m["vendor"], reg.get("display_name") or m["model"], [m["model"]])).fetchone()
            mid = row["id"] if row else conn.execute("SELECT id FROM models WHERE canonical_key = %s", (key,)).fetchone()["id"]
            n["models created" if row else "models existing"] += 1
            for o in m["offers"]:
                efforts = [e for e in o["efforts"] if e] or [None]       # no effort setting -> Default
                for e in efforts:
                    if e is not None and e not in LADDER:
                        unknown_efforts[e] += 1
                        continue
                    cid = w.config(mid, key, e, None)
                    conn.execute(
                        """INSERT INTO yugos_offers (config_id, provider, card_model_id, yugos_model, input_usd_m,
                               output_usd_m, cached_usd_m, valid_until, card_synced_at)
                           VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s) ON CONFLICT DO NOTHING""",
                        (cid, o["provider"], o["id"], m["model"], o["in"], o["out"], o["cached"], o["valid_until"], synced))
                    n["offers"] += 1
        # configurations left with neither results nor offers (e.g. an effort a provider stopped offering)
        n["orphan configs removed"] = conn.execute(
            """DELETE FROM model_configs c WHERE NOT EXISTS (SELECT 1 FROM benchmark_results r WHERE r.config_id = c.id)
                 AND NOT EXISTS (SELECT 1 FROM yugos_offers o WHERE o.config_id = c.id)""").rowcount
    print(", ".join(f"{k}: {v}" for k, v in n.items()))
    if unknown_efforts:
        print("efforts not on the ladder (skipped):", dict(unknown_efforts))
    return 0


if __name__ == "__main__":
    sys.exit(main())
