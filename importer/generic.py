"""Generic format "benchmark-results/v1" -> records.

Used for single-benchmark sources (data/hle.json, data/mmlu_pro.json, data/gpqa.json)
and any future file in the same shape:

    {"format": "benchmark-results/v1",
     "source": {"name", "site", "description", "attribution", "license", "collected_at", ...},
     "benchmarks": [{"key", "name", "version", "area", "sub_area", "unit", "total_tasks",
                     "description", "url", "lower_is_better"?, "metric"?}],
     "results": [{"benchmark": <key>, "model", "developer"?, "developer_inferred"?,
                  "model_version"?, "reasoning_effort"?, "api_provider"?, "score", "accuracy"?,
                  "evaluation_date"?, "evaluation_method"?, "external_id"?, "extra"?}]}

A benchmark with "metric": "accuracy" (the publisher reports its score as the
percentage answered correctly) also fills each result's accuracy with the score.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime

from .normalize import infer_provider, normalize_effort, normalize_provider, split_effort
from .records import BenchmarkRec, Item, ModelRec, ParsedFile, ResultRec, SourceInfo

FORMAT = "benchmark-results/v1"


def parse(doc: dict) -> ParsedFile:
    src = doc["source"]
    collected = datetime.fromisoformat(src["collected_at"]) if src.get("collected_at") else None
    description = " ".join(x for x in (src.get("description"), src.get("license") and f"License: {src['license']}.",
                                       src.get("attribution")) if x)
    parsed = ParsedFile(SourceInfo(src["name"], src.get("site"), description or None, collected), [])

    benchmarks = {}
    for b in doc["benchmarks"]:
        benchmarks[b["key"]] = BenchmarkRec(
            b["name"], b.get("version"), b.get("area"), b.get("sub_area"), b.get("unit") or "points",
            b.get("total_tasks"), b.get("description"), b.get("url") or src.get("site"),
            metadata={k: v for k, v in {"lower_is_better": b.get("lower_is_better"), "key": b["key"],
                                         "metric": b.get("metric")}.items() if v is not None})
    is_accuracy = {b["key"] for b in doc["benchmarks"] if b.get("metric") == "accuracy"}

    # group a model's results into one raw record (one item per model/run)
    groups: dict[str, list[dict]] = defaultdict(list)
    for r in doc["results"]:
        if r["benchmark"] not in benchmarks:
            parsed.warnings.append(f"result for unknown benchmark key {r['benchmark']!r} skipped")
            continue
        run = (r.get("external_id") or "").split("@")[0].split(":")[0] or r["model"]
        groups[f"{r['model']}|{run}"].append(r)

    for rows in groups.values():
        first = rows[0]
        base, name_effort = split_effort(first["model"])
        dev = first.get("developer") or infer_provider(first["model"])
        model = ModelRec(normalize_provider(dev), base, model_version=first.get("model_version"),
                         aliases=[first["model"]])
        results = []
        for r in rows:
            extra = dict(r.get("extra") or {})
            if r.get("developer_inferred"):
                extra["developer_inferred"] = True
            eval_date = date.fromisoformat(r["evaluation_date"]) if r.get("evaluation_date") else None
            results.append(ResultRec(
                benchmark=benchmarks[r["benchmark"]], model=model,
                external_id=r.get("external_id") or f"{r['model']}:{r['benchmark']}@{r['score']}",
                benchmark_score=r["score"], score_unit=benchmarks[r["benchmark"]].default_score_unit,
                reasoning_effort=normalize_effort(r.get("reasoning_effort")) or name_effort,
                api_provider=r.get("api_provider"),
                accuracy=r.get("accuracy") if r.get("accuracy") is not None
                else (r["score"] if r["benchmark"] in is_accuracy else None),
                evaluation_date=eval_date,
                evaluation_method=r.get("evaluation_method"), source_url=src.get("site"),
                additional_metrics=extra))
        parsed.items.append(Item(payload={"source": src["name"], "results": rows},
                                 source_url=src.get("site") or "", results=results))
    return parsed
