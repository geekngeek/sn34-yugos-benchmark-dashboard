"""data/livebench.json -> records.

Benchmarks: one per generation + category, plus an Overall per generation:
  LiveBench "2.0 Overall", "2.0 Coding", ..., "1.0 Mathematics", ...
Each release is a dated evaluation (evaluation_date = release date), so the
releases form the history of every LiveBench benchmark.
"""
from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Any

from .normalize import normalize_effort, normalize_provider, split_effort
from .records import BenchmarkRec, Item, ModelRec, ParsedFile, ResultRec, SourceInfo

SITE = "https://livebench.ai"

AREAS = {
    "Overall": ("general", "overall"),
    "Long Agentic": ("agentic", "long-horizon tasks"),
    "Browser": ("agentic", "browser use"),
    "Research": ("research", "research reports"),
    "Design": ("design", "documents & presentations"),
    "Reasoning": ("reasoning", "logic puzzles"),
    "Coding": ("coding", "code generation & bug fixing"),
    "Agentic Coding": ("coding", "agentic coding"),
    "Mathematics": ("math", "competition math"),
    "Data Analysis": ("data analysis", "table tasks"),
    "Language": ("language", "language puzzles"),
    "IF": ("instruction following", "instruction following"),
}


def _date(s: str | None) -> date | None:
    return date.fromisoformat(s[:10]) if s else None


def _compact(d: dict[str, Any]) -> dict[str, Any]:
    return {k: v for k, v in d.items() if v is not None and v != {} and v != []}


def _column_costs(cost: dict, columns: list[str]) -> tuple[float | None, int | None, float | None]:
    """cost per task, tasks and output tokens per task over some columns."""
    by_col = (cost or {}).get("by_column") or {}
    total = tasks = out_w = 0.0
    for c in columns:
        col = by_col.get(c) or {}
        n = col.get("tasks")
        if n and col.get("total_cost_usd") is not None:
            total += col["total_cost_usd"]
            tasks += n
        if n and col.get("avg_output_tokens") is not None:
            out_w += col["avg_output_tokens"] * n
    if not tasks:
        return None, None, None
    return round(total / tasks, 6), int(tasks), round(out_w / tasks, 2) if out_w else None


def _column_time(time: dict, columns: list[str]) -> float | None:
    by_col = (time or {}).get("by_column") or {}
    vals = [by_col[c]["mean_llm_seconds"] for c in columns
            if c in by_col and by_col[c].get("mean_llm_seconds") is not None]
    return round(sum(vals) / len(vals), 3) if vals else None


def parse(doc: dict, *, include_hidden: bool = False) -> ParsedFile:
    src = doc["source"]
    collected = datetime.fromisoformat(src["collected_at"]) if src.get("collected_at") else None
    parsed = ParsedFile(SourceInfo("LiveBench", src.get("site", SITE), src.get("description"), collected), [])

    for rel in doc["releases"]:
        gen, rdate = rel["generation"], _date(rel["release_date"])
        published = datetime(rdate.year, rdate.month, rdate.day, tzinfo=timezone.utc)
        cats = {c["name"]: c for c in rel["categories"]}

        def bench(name: str) -> BenchmarkRec:
            area, sub = AREAS.get(name, (name.lower(), None))
            tasks = None
            if name in cats and cats[name].get("subcategories"):
                tasks = sum(s.get("tasks", 0) for s in cats[name]["subcategories"]) or None
            return BenchmarkRec("LiveBench", f"{gen} {name}", area, sub, "points", tasks,
                                f"LiveBench {gen}: {name}" if name != "Overall" else rel.get("overall_method"),
                                SITE)

        for m in rel["models"]:
            if not m.get("shown_on_site") and not include_hidden:
                continue
            display = m.get("display_name") or m["model_key"]
            base, name_effort = split_effort(display)
            effort = name_effort or normalize_effort(m.get("effort"))
            model = ModelRec(normalize_provider(m.get("organization")), base,
                             aliases=[display, m["model_key"]])
            common = dict(
                model=model,
                reasoning_effort=effort,
                score_unit="points",
                evaluation_date=rdate,
                published_at=published,
                source_url=rel.get("page_url"),
                evaluation_method=f"LiveBench {gen}, release {rel['release_date']}",
            )
            meta = _compact({"release_id": rel["release_id"], "model_key": m["model_key"],
                             "display_name": display, "open_weight": m.get("open_weight"),
                             "reasoner": m.get("reasoner"), "shown_on_site": m.get("shown_on_site"),
                             "in_default_view": m.get("in_default_view")})
            cost, time = m.get("cost") or {}, m.get("time") or {}
            results = []

            if m.get("overall") is not None:
                results.append(ResultRec(
                    benchmark=bench("Overall"), external_id=f"{rel['release_id']}:{m['model_key']}",
                    benchmark_score=m["overall"],
                    total_tasks=cost.get("tasks_costed"),
                    cost_per_task_usd=cost.get("cost_per_task_usd"),
                    output_tokens_per_task=cost.get("avg_output_tokens_per_task"),
                    time_per_task_sec=time.get("llm_seconds_per_task"),
                    additional_metrics=_compact({
                        **meta, "rank": m.get("rank"), "overall_note": m.get("overall_note"),
                        "overall_weights": rel.get("overall_weights"),
                        "cost_per_successful_task_usd": cost.get("cost_per_successful_task_usd"),
                        "input_price_per_million_usd": cost.get("input_price_per_million_usd"),
                        "output_price_per_million_usd": cost.get("output_price_per_million_usd"),
                    }),
                    **common))

            for cat_name, score in (m.get("category_scores") or {}).items():
                if score is None:
                    continue
                cols = cats.get(cat_name, {}).get("columns", [])
                cpt, tasks, out_tok = _column_costs(cost, cols)
                extra = dict(meta)
                if gen == "1.0":
                    extra["task_scores"] = {c: (m.get("task_scores") or {}).get(c) for c in cols}
                if (m.get("subcategory_scores") or {}).get(cat_name):
                    extra["subcategory_scores"] = m["subcategory_scores"][cat_name]
                results.append(ResultRec(
                    benchmark=bench(cat_name), external_id=f"{rel['release_id']}:{m['model_key']}",
                    benchmark_score=score, total_tasks=tasks, cost_per_task_usd=cpt,
                    output_tokens_per_task=out_tok, time_per_task_sec=_column_time(time, cols),
                    additional_metrics=_compact(extra), **common))

            parsed.items.append(Item(
                payload={"release_id": rel["release_id"], "release_date": rel["release_date"],
                         "generation": gen, "model": m},
                source_url=rel.get("page_url") or SITE, results=results))
    return parsed
