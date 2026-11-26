"""Build data/yugos/models.json: every model the Yugos router can pick (one row per canonical model).

    python3 -I scripts/build_yugos_models.py \
        /root/cic/sn34-yugos/research/llm-lineage/models.csv \
        /root/cic/sn34-yugos/research/data/world-card-2026-11-26.json

Inputs (made by the Yugos research work in /root/cic/sn34-yugos/research):
- llm-lineage/models.csv: canonical models with vendor, line, parent, successor, release date, prices
  and the world-card ids that map to each model.
- the world card itself (https://upload.yugos.ai/world/cards/active): per-provider prices and the
  source each provider's limits were read from; used here for "where to buy" and reference links.

Nothing is fetched here. Re-run after the research folder is refreshed.
"""
from __future__ import annotations

import csv
import json
import re
import sys
from datetime import date
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "data" / "yugos" / "models.json"


def num(s: str) -> float | None:
    try:
        return float(s) if s.strip() else None
    except ValueError:
        return None


def first_url(text: str) -> str | None:
    m = re.search(r"https?://[^\s;,)]+", text or "")
    return m.group(0) if m else None


def main(lineage_csv: str, card_json: str) -> None:
    card_doc = json.load(open(card_json))
    card = card_doc["card"]
    rows = list(csv.DictReader(open(lineage_csv, newline="")))

    by_id: dict[str, str] = {}                        # world-card model id -> canonical model
    for r in rows:
        for cid in r["card_ids"].split():
            by_id[cid] = r["model"]

    offers: dict[str, list[dict]] = {}                # canonical model -> every provider listing
    for p in card["providers"]:
        prices, limits = p.get("token_prices", {}), p.get("model_limits", {})
        for m in p["models"]:
            model = by_id.get(m["model_id"])
            if not model:
                continue
            pr, lim = prices.get(m["model_id"], {}), limits.get(m["model_id"]) or {}
            offers.setdefault(model, []).append({
                "provider": p["provider_id"],
                "id": m["model_id"],
                "in": pr.get("input_usd_per_million"),
                "out": pr.get("output_usd_per_million"),
                "cached": pr.get("cached_usd_per_million"),
                "efforts": [e for e in m.get("effort_levels", []) if e],
                "valid_until": lim.get("valid_until"),
                "source_url": first_url(lim.get("source", "")),
            })

    def reference(model: str) -> tuple[str | None, str]:
        """A page a person can open: OpenAI docs, else the OpenRouter model page, else the catalog the card cites."""
        listings = offers.get(model, [])
        for o in listings:
            if o["provider"] == "openai" and o["source_url"] and "developers.openai.com" in o["source_url"]:
                return re.sub(r"\.md$", "", o["source_url"]), "OpenAI docs"
        for o in listings:
            if o["provider"] == "openrouter":
                return f"https://openrouter.ai/{o['id']}", "OpenRouter"
        for o in listings:
            if o["source_url"]:
                return o["source_url"], f"{o['provider']} catalog"
        return None, ""

    models = []
    for r in rows:
        ref, ref_label = reference(r["model"])
        models.append({
            "model": r["model"],
            "vendor": r["vendor"],
            "line": r["line"],
            "parent": r["parent"] or None,
            "successor": r["successor"] or None,
            "released": r["released"] or None,
            "in_usd_m": num(r["in_usd_m"]),
            "out_usd_m": num(r["out_usd_m"]),
            "price_source": r["price_source"],
            "cheapest_out_usd_m": num(r["cheapest_out_usd_m"]),
            "cheapest_provider": r["cheapest_provider"],
            "efforts": r["efforts"].split() if r["efforts"].strip() else [],
            "providers": r["providers"].split(),
            "valid_until": r["valid_until"] or None,
            "kind": r["kind"],
            "alias_of": r["alias_of"] or None,
            "track": r["track"],
            "card_ids": r["card_ids"].split(),
            "reference_url": ref,
            "reference_label": ref_label,
            "offers": sorted(offers.get(r["model"], []), key=lambda o: (o["out"] is None, o["out"] or 0)),
        })

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({
        "format": "yugos-models/v1",
        "built": date.today().isoformat(),
        "world_card": {"sha256": card_doc.get("sha256"), "synced_at": card_doc.get("synced_at"),
                       "world_state_id": card.get("world_state_id"),
                       "url": "https://upload.yugos.ai/world/cards/active"},
        "notes": ["Release dates are OpenRouter listing dates (close to vendor launch; can lag a few days).",
                  "Prices are USD per 1M tokens: first-party where the vendor sells direct, else the cheapest aggregator.",
                  "Parents are judgement calls where vendors renamed tiers (see llm-lineage/README.md)."],
        "models": models,
    }, indent=1))
    n_off = sum(len(m["offers"]) for m in models)
    print(f"wrote {OUT}: {len(models)} models, {n_off} provider listings, "
          f"{sum(1 for m in models if m['reference_url'])} with a reference link")


if __name__ == "__main__":
    main(*sys.argv[1:3])
