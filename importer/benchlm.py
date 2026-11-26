"""data/benchlm.json -> records.

Benchmarks created:
  * every source benchmark BenchLM publishes scores for (name from BenchLM; when
    two BenchLM benchmarks share a name, the version tells them apart)
  * BenchLM's own composites: "BenchLM Overall" and "BenchLM <category>",
    versioned by BenchLM's ranking mode (e.g. "bench-align-v5")

BenchLM's export has no evaluation dates, so results are snapshots:
external_id = "<model key>:<benchmark key>@<value>"; a new row appears only
when a value changes. Units: 0-100 values are "points"; ratings are "elo";
anything else outside 0-100 keeps BenchLM's native unit as "score".
License: CC BY-NC 4.0 (non-commercial use with attribution).
"""
from __future__ import annotations

import re
from collections import defaultdict
from datetime import date, datetime

from .normalize import normalize_provider, split_effort
from .records import BenchmarkRec, Item, ModelRec, ParsedFile, PriceRec, ResultRec, SourceInfo

SITE = "https://benchlm.ai/"

CATEGORY_LABELS = {
    "agentic": "Agentic", "coding": "Coding", "reasoning": "Reasoning",
    "multimodalGrounded": "Multimodal", "knowledge": "Knowledge", "multilingual": "Multilingual",
    "instructionFollowing": "Instruction Following", "math": "Math",
    "external": "External", "korean": "Korean",
}
AREAS = {
    "agentic": "agentic", "coding": "coding", "reasoning": "reasoning", "multimodalGrounded": "multimodal",
    "knowledge": "knowledge", "multilingual": "multilingual", "instructionFollowing": "instruction following",
    "math": "math", "external": "other", "korean": "multilingual",
}
# model entries that are benchmark-specific system setups, not general models
SYSTEM_VARIANTS = {"benchmark-system", "decision-system"}
_RATING = re.compile(r"\b(elo|rating|bradley)", re.I)
# BenchLM formats such as "Accuracy", "Accuracy (%)", "Overall accuracy", "Average accuracy"
_ACCURACY = re.compile(r"\baccuracy\b", re.I)


def _date(text: str | None) -> date | None:
    if not text:
        return None
    for fmt in ("%B %d, %Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(text[:10] if fmt == "%Y-%m-%d" else text, fmt).date()
        except ValueError:
            continue
    return None


def _unit(fmt: str | None, values: list[float]) -> str:
    if fmt and _RATING.search(fmt):
        return "elo"
    if values and all(0 <= v <= 100 for v in values):
        return "points"
    return "score"


def parse(doc: dict, *, include_systems: bool = False) -> ParsedFile:
    src = doc["source"]
    collected = datetime.fromisoformat(src["collected_at"])
    parsed = ParsedFile(SourceInfo("BenchLM", src.get("site", SITE), src.get("attribution"), collected), [])
    files = {f["file"]: f for f in src.get("files", [])}
    price_date = _date((files.get("pricing.json") or {}).get("source_last_updated")) or collected.date()
    mode = doc.get("leaderboard", {}).get("ranking_mode") or "unversioned"

    # ---- benchmark definitions (first definition of a key wins) -------------------------------
    defs: dict[str, dict] = {}
    for b in doc["benchmarks"]:
        defs.setdefault(b["key"], b)
    values = defaultdict(list)
    models = [m for m in doc["models"]
              if include_systems or (m.get("family") or {}).get("variantType") not in SYSTEM_VARIANTS]
    skipped = len(doc["models"]) - len(models)
    if skipped:
        parsed.warnings.append(f"skipped {skipped} benchmark/decision-system entries (use --include-benchmark-systems)")
    for m in models:
        for s in m.get("scores", []):
            if isinstance(s.get("value"), (int, float)):
                values[s["benchmark_key"]].append(s["value"])

    by_name = defaultdict(list)
    for key in values:
        by_name[(defs.get(key) or {}).get("name") or key].append(key)

    bench_cache: dict[str, BenchmarkRec] = {}
    first_price: dict[str, PriceRec] = {}   # one price per model and date; variants' prices kept on it

    def source_bench(key: str, score_category: str) -> BenchmarkRec:
        if key in bench_cache:
            return bench_cache[key]
        d = defs.get(key) or {}
        name = d.get("name") or key
        version = None
        if len(by_name[name]) > 1:  # same name used by different BenchLM benchmarks
            pubs = [(defs.get(k) or {}).get("upstream_publisher") for k in by_name[name]]
            pub = d.get("upstream_publisher")
            version = pub if pub and pubs.count(pub) == 1 else key
        cat = d.get("category") or score_category
        rec = BenchmarkRec(
            name, version, AREAS.get(cat, cat), d.get("difficulty") or d.get("tasks"),
            _unit(d.get("format"), values[key]), None,
            d.get("full_name") or d.get("description"), d.get("url") or d.get("paper_url"),
            metadata={k: v for k, v in {
                "benchlm_key": key, "format": d.get("format"), "lower_is_better": d.get("lower_is_better"),
                "upstream_publisher": d.get("upstream_publisher"), "paper_url": d.get("paper_url"),
                "benchlm_category": cat, "defined_in_export": d.get("defined_in_export", True),
            }.items() if v is not None})
        bench_cache[key] = rec
        return rec

    def composite(category: str | None) -> BenchmarkRec:
        label = "Overall" if category is None else CATEGORY_LABELS.get(category, category)
        return BenchmarkRec(f"BenchLM {label}", mode, "general" if category is None else AREAS.get(category, category),
                            "composite score", "points", None,
                            f"BenchLM's published {label.lower()} score ({mode}).", SITE,
                            metadata={"composite": True, "ranking_mode": mode})

    for m in models:
        base, effort = split_effort(m["name"])
        model = ModelRec(normalize_provider(m.get("creator")), base,
                         release_date=_date(m.get("release_date")), aliases=[m["name"], m["key"]])
        speed = m.get("speed") or {}
        common = dict(model=model, reasoning_effort=effort, source_url=m.get("url") or SITE,
                      evaluation_method="Published on BenchLM")
        meta = {k: v for k, v in {"model_key": m["key"], "benchlm_name": m["name"],
                                   "source_type": m.get("source_type"), "reasoning_type": m.get("reasoning_type"),
                                   "variant_type": (m.get("family") or {}).get("variantType")}.items() if v is not None}
        results = []

        ov = m.get("overall") or {}
        if ov.get("score") is not None:
            results.append(ResultRec(
                benchmark=composite(None), external_id=f"{m['key']}:overall@{ov['score']}",
                benchmark_score=ov["score"], score_unit="points",
                tokens_per_sec=speed.get("tokens_per_second"), ttft_sec=speed.get("time_to_first_token_seconds"),
                additional_metrics={**meta, **{k: v for k, v in {
                    "rank": ov.get("rank"), "ranking_eligible": ov.get("ranking_eligible"),
                    "evidence_status": ov.get("evidence_status"), "score_interval_90": ov.get("score_interval_90"),
                    "coverage": m.get("coverage"),
                    "speed_source": speed.get("upstream_source"),
                }.items() if v is not None}}, **common))
        for cat, score in (m.get("category_scores") or {}).items():
            if score is None:
                continue
            results.append(ResultRec(
                benchmark=composite(cat), external_id=f"{m['key']}:{cat}@{score}",
                benchmark_score=score, score_unit="points",
                additional_metrics={**meta, **{k: v for k, v in {
                    "rank": (m.get("category_ranks") or {}).get(cat),
                    "ranking_eligible": (m.get("category_ranking_eligible") or {}).get(cat)}.items() if v is not None}},
                **common))

        seen = set()
        for s in m.get("scores", []):
            key, value = s["benchmark_key"], s.get("value")
            if not isinstance(value, (int, float)) or key in seen:  # a key can be listed under two categories
                continue
            seen.add(key)
            bench = source_bench(key, s.get("category"))
            extra = {**meta, "benchmark_key": key}
            if s.get("source"):
                extra["source"] = s["source"]
            if bench.metadata.get("upstream_publisher"):
                extra["upstream_publisher"] = bench.metadata["upstream_publisher"]
            fmt = bench.metadata.get("format") or ""
            accuracy = value if (_ACCURACY.search(fmt) and bench.default_score_unit == "points") else None
            results.append(ResultRec(
                benchmark=bench, external_id=f"{m['key']}:{key}@{value}", benchmark_score=value, accuracy=accuracy,
                score_unit=bench.default_score_unit, additional_metrics=extra, **common))

        prices = []
        p = m.get("pricing_usd_per_1m_tokens") or {}
        if (p.get("input") is not None or p.get("output") is not None) and model.key in first_price:
            kept = first_price[model.key]
            vals = {"input": p.get("input"), "output": p.get("output"), "cached_input": p.get("cached_input")}
            if (kept.input_token_price, kept.output_token_price, kept.cache_read_price) != tuple(vals.values()):
                kept.additional_pricing.setdefault("other_variant_prices", {})[m["name"]] = vals
        elif p.get("input") is not None or p.get("output") is not None:
            prices.append(PriceRec(
                model=model, api_provider=model.provider, effective_from=price_date,
                input_token_price=p.get("input"), output_token_price=p.get("output"),
                cache_read_price=p.get("cached_input"), source_url=m.get("url") or SITE,
                additional_pricing={k: v for k, v in {"basis": "BenchLM pricing export", "variant": m["name"],
                                                       "note": p.get("note"), "is_free": p.get("is_free")}.items()
                                    if v is not None}))
            first_price[model.key] = prices[-1]

        if results or prices:
            parsed.items.append(Item(payload=m, source_url=m.get("url") or SITE, results=results, prices=prices))
    return parsed
