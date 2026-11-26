"""data/artificial_analysis.json -> records.

Benchmarks: the Intelligence Index (versioned) and the six capability indices.
AA publishes no evaluation dates, so results are snapshots: external_id is
"<AA model id>@<score>", and a new row appears only when a score changes.
Prices go to model_pricing, dated by the collection date.
"""
from __future__ import annotations

from datetime import date, datetime

from .normalize import normalize_effort, normalize_provider
from .records import BenchmarkRec, Item, ModelRec, ParsedFile, PriceRec, ResultRec, SourceInfo

SITE = "https://artificialanalysis.ai/"

CAPABILITIES = {
    "finance_and_accounting": ("Finance & Accounting", "finance & accounting"),
    "strategy_and_ops": ("Strategy & Ops", "strategy & operations"),
    "legal": ("Legal", "legal"),
    "healthcare_and_medical": ("Healthcare & Medical", "healthcare"),
    "engineering": ("Engineering", "engineering"),
    "economics": ("Economics", "economics"),
}


def parse(doc: dict) -> ParsedFile:
    src = doc["source"]
    collected = datetime.fromisoformat(src["collected_at"])
    as_of: date = collected.date()
    version = src.get("intelligence_index_version")
    parsed = ParsedFile(SourceInfo("Artificial Analysis", src.get("site", SITE), src.get("attribution"),
                                   collected), [])

    index_bench = BenchmarkRec(
        "Artificial Analysis Intelligence Index", f"v{version}" if version is not None else None,
        "general", "composite index", "points", None,
        "Composite of AA's evaluations. Compare scores only within one index version.", SITE)

    seen_prices: dict[str, tuple[tuple, PriceRec]] = {}
    for m in doc["models"]:
        model = ModelRec(normalize_provider((m.get("creator") or {}).get("name")), m["base_name"],
                         release_date=date.fromisoformat(m["release_date"]) if m.get("release_date") else None,
                         aliases=[m["name"], m["slug"]])
        perf = m.get("performance") or {}
        cost = m.get("intelligence_index_cost_usd") or {}
        common = dict(
            model=model,
            reasoning_effort=normalize_effort(m.get("reasoning_effort")),
            score_unit="points",
            tokens_per_sec=perf.get("output_tokens_per_second"),
            ttft_sec=perf.get("time_to_first_token_seconds"),
            source_url=SITE,
            evaluation_method="Artificial Analysis independent evaluation",
        )
        meta = {k: v for k, v in {"aa_id": m["id"], "slug": m["slug"], "aa_name": m["name"],
                                   "variant_label": m.get("variant_label"),
                                   "time_to_first_answer_token_seconds": perf.get("time_to_first_answer_token_seconds"),
                                   }.items() if v is not None}
        results = []
        if m.get("intelligence_index") is not None:
            results.append(ResultRec(
                benchmark=index_bench, external_id=f"{m['id']}@{m['intelligence_index']}",
                benchmark_score=m["intelligence_index"], cost_per_task_usd=cost.get("per_task"),
                additional_metrics={**meta, "rank": m.get("intelligence_index_rank"),
                                    **({"index_total_cost_usd": cost["total"]} if cost.get("total") is not None else {})},
                **common))
        for key, value in (m.get("capability_indices") or {}).items():
            if value is None:
                continue
            title, sub = CAPABILITIES.get(key, (key.replace("_", " ").title(), key.replace("_", " ")))
            results.append(ResultRec(
                benchmark=BenchmarkRec(f"Artificial Analysis {title} Index", None, "domain", sub, "points",
                                       None, "AA capability index.", SITE),
                external_id=f"{m['id']}@{value}", benchmark_score=value,
                additional_metrics=dict(meta), **common))

        prices = []
        pr = m.get("pricing_usd_per_1m_tokens") or {}
        if any(pr.get(k) is not None for k in ("input", "output", "cache_read", "cache_write")):
            vals = (pr.get("input"), pr.get("output"), pr.get("cache_read"), pr.get("cache_write"))
            key = model.key
            if key in seen_prices:
                first_vals, rec = seen_prices[key]
                if vals != first_vals:  # effort variant priced differently: keep it on the row
                    rec.additional_pricing.setdefault("other_variant_prices", {})[m["name"]] = dict(
                        zip(("input", "output", "cache_read", "cache_write"), vals))
            else:
                rec = PriceRec(
                    model=model, api_provider=model.provider, effective_from=as_of,
                    input_token_price=vals[0], output_token_price=vals[1],
                    cache_read_price=vals[2], cache_write_price=vals[3], source_url=SITE,
                    additional_pricing={"basis": "Artificial Analysis model-level price",
                                        "variant": m["name"],
                                        **({"blended_3_to_1": pr["blended_3_to_1_computed"]}
                                           if pr.get("blended_3_to_1_computed") is not None else {})})
                seen_prices[key] = (vals, rec)
                prices.append(rec)

        if results or prices:
            parsed.items.append(Item(payload=m, source_url=src.get("api_endpoint", SITE),
                                     results=results, prices=prices))
    return parsed
