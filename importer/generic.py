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

Cost per task: a result's "cost_per_task_usd" when given, else derived from what the source
publishes in "extra", always divided by a count from the same entry (never assumed):
  total_cost_usd / test_cases          (Aider: cost of the whole run / exercises in that run)
  total_cost_usd / n_trials            (Terminal-Bench: cost of all trials / trials)
  avg_cost_per_run_usd * runs / answers (MathArena: total cost of the runs / answers given)
A total of 0 is left empty: those sources write 0 when the cost was not tracked.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime

from .normalize import infer_provider, normalize_effort, normalize_provider, split_effort
from .records import BenchmarkRec, Item, ModelRec, ParsedFile, ResultRec, SourceInfo

FORMAT = "benchmark-results/v1"


def cost_per_task(r: dict) -> tuple[float | None, str | None]:
    """(USD per task, how it was worked out) for one result, or (None, None)"""
    if r.get("cost_per_task_usd") is not None:
        return float(r["cost_per_task_usd"]), None
    x = r.get("extra") or {}
    total = x.get("total_cost_usd")
    if total:                                                   # 0 / missing = not tracked
        for count_key in ("test_cases", "n_trials"):
            if x.get(count_key):
                return total / x[count_key], f"total_cost_usd / {count_key}"
    per_run, runs, answers = x.get("avg_cost_per_run_usd"), x.get("runs"), x.get("answers")
    if per_run and runs and answers:
        return per_run * runs / answers, "avg_cost_per_run_usd * runs / answers"
    return None, None


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
            cost, how = cost_per_task(r)
            if how:
                extra["cost_per_task_from"] = how
            results.append(ResultRec(
                benchmark=benchmarks[r["benchmark"]], model=model,
                external_id=r.get("external_id") or f"{r['model']}:{r['benchmark']}@{r['score']}",
                benchmark_score=r["score"], score_unit=benchmarks[r["benchmark"]].default_score_unit,
                reasoning_effort=normalize_effort(r.get("reasoning_effort")) or name_effort,
                api_provider=r.get("api_provider"),
                accuracy=r.get("accuracy") if r.get("accuracy") is not None
                else (r["score"] if r["benchmark"] in is_accuracy else None),
                evaluation_date=eval_date,
                cost_per_task_usd=cost,
                evaluation_method=r.get("evaluation_method"), source_url=src.get("site"),
                additional_metrics=extra))
        parsed.items.append(Item(payload={"source": src["name"], "results": rows},
                                 source_url=src.get("site") or "", results=results))
    return parsed
