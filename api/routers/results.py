"""Raw result browsing, leaderboards and model comparison."""
from __future__ import annotations

from datetime import date
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query

from ..db import Where, fetch_all, fetch_one, get_conn
from ..queries import BENCHMARK_REF_COLS, get_benchmark, ranked_results, result_filters
from ..scales import scored
from ..schemas import (ChartPoint, Comparison, FilterOptions, GroupBy, Leaderboard, ModelConfig, ModelConfigInfo, Page, Pick,
                       RawPayload, Result)

router = APIRouter(tags=["results"])
Conn = Annotated[object, Depends(get_conn)]

EFFORT_DOC = ("none | minimal | low | medium | high | xhigh | max | enabled, "
              "or 'unspecified' for results without an effort")

# sort key -> ORDER BY expressions (direction is applied to each)
_EFFORT_ORDER = ("CASE reasoning_effort WHEN 'none' THEN 0 WHEN 'minimal' THEN 1 WHEN 'low' THEN 2 "
                 "WHEN 'medium' THEN 3 WHEN 'high' THEN 4 WHEN 'xhigh' THEN 5 WHEN 'max' THEN 6 "
                 "WHEN 'enabled' THEN 7 END")
SORTS = {
    # the 0-100 score (api/scales.py); results that cannot be put on it sort last, by their own number
    "benchmark_score": ["sort_score", "benchmark_score"],
    "accuracy": ["accuracy"],
    "date": ["COALESCE(evaluation_date, collected_at::date)"],
    "evaluation_date": ["evaluation_date"],
    "collected_at": ["collected_at"],
    "cost_per_task_usd": ["cost_per_task_usd"],
    "tokens_per_sec": ["tokens_per_sec"],
    "model_name": ["lower(model_name)"],
    "provider": ["lower(provider)", "lower(model_name)"],
    "benchmark": ["lower(benchmark_name)", "benchmark_version"],
    "area": ["area", "lower(benchmark_name)"],
    "reasoning_effort": [_EFFORT_ORDER],
    "source_name": ["source_name"],
}


# a model configuration as one string: "<model ID>~<effort>~<mode>" with empty trailing parts dropped
# ("anthropic/claude-opus-4.5~high", "openai/gpt-5.2~none~search", "openai/gpt-4o")
CONFIG_SQL = "rtrim(model_key || '~' || COALESCE(reasoning_effort, '') || '~' || COALESCE(mode, ''), '~')"


def any_of(where: Where, *conditions: tuple[str, str, list | None]) -> None:
    """Add "(cond1 OR cond2 ...)" for the conditions that have values; nothing if none do."""
    used = [(sql, name, value) for sql, name, value in conditions if value]
    if used:
        where.add("(" + " OR ".join(sql for sql, _, _ in used) + ")", **{name: value for _, name, value in used})


@router.get("/results", response_model=Page[Result],
            summary="Filterable flat benchmark records (v_benchmark_records)")
def list_results(
    conn: Conn,
    # every list filter accepts one value or several (?area=coding&area=math): any of them matches
    benchmark_id: Annotated[list[UUID] | None, Query()] = None,
    model_id: Annotated[list[UUID] | None, Query()] = None,
    source_id: Annotated[list[UUID] | None, Query()] = None,
    provider: Annotated[list[str] | None, Query()] = None,
    area: Annotated[list[str] | None, Query()] = None,
    reasoning_effort: Annotated[list[str] | None, Query(description=EFFORT_DOC)] = None,
    q: Annotated[str | None, Query(description="substring of model, model ID, the source's model name, developer or benchmark")] = None,
    min_score: float | None = None,
    configs: Annotated[str | None, Query(description=(
        "only these model configurations, comma-separated '<model ID>~<effort>~<mode>' "
        "(see /configs); 'none' matches nothing"))] = None,
    date_from: date | None = None,
    date_to: date | None = None,
    latest_only: Annotated[bool, Query(description=(
        "only the newest result per benchmark, model and reasoning effort"))] = False,
    sort: Literal[tuple(SORTS)] = "benchmark_score",  # type: ignore[valid-type]
    order: Literal["asc", "desc"] = "desc",
    limit: Annotated[int, Query(ge=1, le=500)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
):
    where = Where()
    # Source/benchmark and developer/model are pairs of a group and its items: within a
    # pair a result matches the chosen groups OR the chosen items ("all of LiveBench plus
    # SWE-bench Verified"); different pairs and other filters still all have to match.
    any_of(where, ("source_id = ANY(%(source_ids)s)", "source_ids", source_id),
                  ("benchmark_id = ANY(%(benchmark_ids)s)", "benchmark_ids", benchmark_id))
    any_of(where, ("lower(provider) = ANY(%(providers)s)", "providers", [p.lower() for p in provider or []]),
                  ("model_id = ANY(%(model_ids)s)", "model_ids", model_id))
    if area:
        where.add("lower(area) = ANY(%(areas)s)", areas=[a.lower() for a in area])
    if reasoning_effort:
        levels = [e for e in reasoning_effort if e != "unspecified"]
        parts = (["reasoning_effort = ANY(%(efforts)s)"] if levels else []) + \
                (["reasoning_effort IS NULL"] if "unspecified" in reasoning_effort else [])
        where.add("(" + " OR ".join(parts) + ")", efforts=levels)
    where.add_if(min_score, "sort_score >= %(min_score)s", "min_score")
    if configs is not None:
        wanted = [c.strip() for c in configs.split(",") if c.strip() and c.strip() != "none"]
        where.add(f"{CONFIG_SQL} = ANY(%(configs)s)", configs=wanted)
    if q:
        where.add("(model_name ILIKE '%%' || %(q)s || '%%' OR provider ILIKE '%%' || %(q)s || '%%' "
                  "OR model_key ILIKE '%%' || %(q)s || '%%' OR raw_model_name ILIKE '%%' || %(q)s || '%%' "
                  "OR (benchmark_name || ' ' || COALESCE(benchmark_version, '')) ILIKE '%%' || %(q)s || '%%')",
                  q=q.strip())
    result_filters(where, date_from=date_from, date_to=date_to)
    table, scale_params = scored("v_latest_results" if latest_only else "v_benchmark_records")
    params = {**where.params, **scale_params}
    total = fetch_one(conn, f"SELECT COUNT(*)::int AS n FROM {table} {where.sql()}", params)["n"]
    direction = order.upper()
    order_by = ", ".join(f"{expr} {direction} NULLS LAST" for expr in SORTS[sort])
    items = fetch_all(conn, f"""
        SELECT * FROM {table} {where.sql()}
         ORDER BY {order_by}, id
         LIMIT %(limit)s OFFSET %(offset)s
    """, {**params, "limit": limit, "offset": offset})
    return {"items": items, "total": total, "limit": limit, "offset": offset}


@router.get("/configs", response_model=list[ModelConfig],
            summary="The model configurations (model + effort + mode) that have results on these benchmarks")
def list_configs(conn: Conn, benchmark_id: Annotated[list[UUID] | None, Query()] = None):
    where = Where()
    where.add_if(benchmark_id, "benchmark_id = ANY(%(benchmark_ids)s)", "benchmark_ids")
    table, scale_params = scored("v_benchmark_records")
    return fetch_all(conn, f"""
        SELECT t.*, COALESCE(o.providers, '{{}}') AS yugos_providers
          FROM (SELECT config_id, {CONFIG_SQL} AS config, model_key, model_name, provider, reasoning_effort, mode,
                       MIN(effort_rank) AS effort_rank, COUNT(*)::int AS results, MAX(sort_score)::float AS best_score,
                       MAX(COALESCE(evaluation_date, collected_at::date)) AS latest
                  FROM {table} {where.sql()}
                 GROUP BY 1, 2, 3, 4, 5, 6, 7) t
          LEFT JOIN (SELECT config_id, array_agg(DISTINCT provider ORDER BY provider) AS providers
                       FROM yugos_offers GROUP BY 1) o ON o.config_id = t.config_id
         ORDER BY t.best_score DESC NULLS LAST, t.model_name""", {**where.params, **scale_params})


@router.get("/chart-points", response_model=list[ChartPoint],
            summary="One point per configuration (latest result) per benchmark and source, with every chartable metric")
def chart_points(
    conn: Conn,
    benchmark_id: Annotated[list[UUID], Query()],
    configs: Annotated[str | None, Query(description="as in /results; omitted = every configuration")] = None,
):
    where = Where()
    where.add("benchmark_id = ANY(%(benchmark_ids)s)", benchmark_ids=benchmark_id)
    if configs is not None:
        wanted = [c.strip() for c in configs.split(",") if c.strip() and c.strip() != "none"]
        where.add(f"{CONFIG_SQL} = ANY(%(configs)s)", configs=wanted)
    table, scale_params = scored("v_benchmark_records")
    return fetch_all(conn, f"""
        SELECT p.*, COALESCE(p.output_price_then, cp.output_token_price::float) AS output_price,
               COALESCE(p.input_price_then, cp.input_token_price::float) AS input_price,
               COALESCE(o.providers, '{{}}') AS yugos_providers
          FROM (SELECT DISTINCT ON (config_id, benchmark_id, source_id)
                       config_id, model_id, {CONFIG_SQL} AS config, model_key, model_name, provider, reasoning_effort, mode,
                       effort_rank, benchmark_name, benchmark_version, source_name,
                       COALESCE(display_score, benchmark_score)::float AS quality, sort_score::float AS sort_score,
                       accuracy::float AS accuracy, cost_per_task_usd::float AS cost_per_task,
                       time_per_task_sec::float AS time_per_task, ttft_sec::float AS ttft,
                       tokens_per_sec::float AS tokens_per_sec, output_tokens_per_task::float AS output_tokens,
                       output_token_price::float AS output_price_then, input_token_price::float AS input_price_then,
                       COALESCE(evaluation_date, collected_at::date) AS date
                  FROM {table} {where.sql()}
                 ORDER BY config_id, benchmark_id, source_id, COALESCE(evaluation_date, collected_at::date) DESC, collected_at DESC) p
          -- no price from the result's own date (older results): the model's current price, same mode first
          LEFT JOIN LATERAL (SELECT mp.output_token_price, mp.input_token_price FROM model_pricing mp
                              WHERE mp.model_id = p.model_id AND mp.effective_to IS NULL
                              ORDER BY (mp.mode IS NOT DISTINCT FROM p.mode) DESC, (mp.model_snapshot IS NULL) DESC,
                                       mp.effective_from DESC LIMIT 1) cp ON true
          LEFT JOIN (SELECT config_id, array_agg(DISTINCT provider ORDER BY provider) AS providers
                       FROM yugos_offers GROUP BY 1) o ON o.config_id = p.config_id""", {**where.params, **scale_params})


@router.get("/model-configs", response_model=list[ModelConfigInfo],
            summary="Every configuration of a model (effort ladder), with results and Yugos offers")
def model_configs(conn: Conn, model_key: Annotated[str, Query(description="project model ID, e.g. anthropic/claude-opus-4.5")]):
    return fetch_all(conn, """
        SELECT config_key AS config, model_key, model_name, provider, effort AS reasoning_effort, mode,
               effort_rank, effort_label, results, yugos_offers, COALESCE(yugos_providers, '{}') AS yugos_providers
          FROM v_model_configs WHERE model_key = %(k)s
         ORDER BY effort_rank NULLS FIRST, mode NULLS FIRST""", {"k": model_key})


@router.get("/filters", response_model=FilterOptions,
            summary="Values available for the results filters")
def filter_options(conn: Conn):
    benchmarks = fetch_all(conn, """
        SELECT b.id, b.benchmark_name, b.benchmark_version, b.area,
               ARRAY_AGG(DISTINCT s.source_name) AS sources, COUNT(*)::int AS result_count
          FROM benchmarks b JOIN benchmark_results r ON r.benchmark_id = b.id
          JOIN sources s ON s.id = r.source_id
         GROUP BY b.id ORDER BY lower(b.benchmark_name), b.benchmark_version NULLS FIRST
    """)
    sources = fetch_all(conn, """
        SELECT s.id, s.source_name, COUNT(r.id)::int AS result_count
          FROM sources s JOIN benchmark_results r ON r.source_id = s.id
         GROUP BY s.id ORDER BY s.source_name
    """)
    models = fetch_all(conn, """
        SELECT m.id, m.model_name, m.provider, COUNT(*)::int AS result_count
          FROM models m JOIN benchmark_results r ON r.model_id = m.id
         GROUP BY m.id ORDER BY lower(m.provider), lower(m.model_name)
    """)
    values = lambda sql: [r["v"] for r in fetch_all(conn, sql)]
    return {
        "sources": sources,
        "benchmarks": benchmarks,
        "models": models,
        "areas": values("SELECT DISTINCT b.area AS v FROM benchmarks b JOIN benchmark_results r "
                        "ON r.benchmark_id = b.id WHERE b.area IS NOT NULL ORDER BY 1"),
        "providers": values("SELECT DISTINCT m.provider AS v FROM models m JOIN benchmark_results r "
                            "ON r.model_id = m.id ORDER BY 1"),
        "reasoning_efforts": values(f"SELECT DISTINCT reasoning_effort AS v, {_EFFORT_ORDER} AS o "
                                    "FROM benchmark_results WHERE reasoning_effort IS NOT NULL ORDER BY o"),
        "sorts": list(SORTS),
    }


@router.get("/results/{result_id}", response_model=Result)
def get_result(result_id: UUID, conn: Conn):
    table, scale_params = scored("v_benchmark_records")
    row = fetch_one(conn, f"SELECT * FROM {table} WHERE id = %(id)s", {**scale_params, "id": result_id})
    if row is None:
        raise HTTPException(404, f"result {result_id} not found")
    return row


@router.get("/results/{result_id}/raw", response_model=RawPayload,
            summary="Original payload the result was parsed from (provenance)")
def get_result_raw(result_id: UUID, conn: Conn):
    row = fetch_one(conn, """
        SELECT d.id AS raw_data_id, d.source_url, d.fetch_method, d.collected_at,
               d.parsed_at, d.payload
          FROM benchmark_results r JOIN raw_data d ON d.id = r.raw_data_id
         WHERE r.id = %(id)s
    """, {"id": result_id})
    if row is None:
        raise HTTPException(404, f"no raw payload for result {result_id}")
    return row


@router.get("/leaderboard/{benchmark_id}", response_model=Leaderboard,
            summary="Ranked models on one benchmark")
def leaderboard(
    benchmark_id: UUID,
    conn: Conn,
    pick: Annotated[Pick, Query(description="best: top score per group; latest: newest result")] = "best",
    group_by: Annotated[GroupBy, Query(description="one row per model, or per model + reasoning effort")] = "model",
    source_id: UUID | None = None,
    provider: str | None = None,
    reasoning_effort: Annotated[str | None, Query(description=EFFORT_DOC)] = None,
    date_from: date | None = None,
    date_to: date | None = None,
    score_unit: Annotated[str | None, Query(description="defaults to the benchmark's unit")] = None,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
):
    benchmark = get_benchmark(conn, benchmark_id)
    where = result_filters(Where(), source_id=source_id, provider=provider,
                           reasoning_effort=reasoning_effort, date_from=date_from, date_to=date_to)
    rows, unit = ranked_results(conn, benchmark, pick=pick, group_by=group_by,
                                score_unit=score_unit, where=where, limit=limit)
    entries = [{**r, "result_id": r["id"]} for r in rows]
    return {"benchmark": benchmark, "pick": pick, "group_by": group_by,
            "score_unit": unit, "entries": entries}


@router.get("/compare", response_model=Comparison,
            summary="Side-by-side best scores of several models across benchmarks")
def compare(
    conn: Conn,
    model_id: Annotated[list[UUID], Query(min_length=2, max_length=10)],
    benchmark_id: Annotated[list[UUID] | None, Query()] = None,
    area: str | None = None,
    reasoning_effort: Annotated[str | None, Query(description=EFFORT_DOC)] = None,
    only_shared: Annotated[bool, Query(description="only benchmarks every model has a result on")] = False,
):
    model_ids = list(dict.fromkeys(model_id))
    models = fetch_all(conn, "SELECT id, provider, model_name FROM models WHERE id = ANY(%(ids)s)",
                       {"ids": model_ids})
    found = {m["id"] for m in models}
    missing = [str(i) for i in model_ids if i not in found]
    if missing:
        raise HTTPException(404, f"models not found: {', '.join(missing)}")
    models.sort(key=lambda m: model_ids.index(m["id"]))

    where = Where()
    where.add_if(benchmark_id, "benchmark_id = ANY(%(benchmark_ids)s)", "benchmark_ids")
    where.add_if(area, "area ILIKE %(area)s", "area")
    where.add("benchmark_score IS NOT NULL")
    where.add("(default_unit IS NULL OR score_unit = default_unit)")  # never mix units
    result_filters(where, reasoning_effort=reasoning_effort)
    # rank every model's best result per benchmark, then keep the requested models
    rows = fetch_all(conn, f"""
        WITH rec AS (
            SELECT v.*, b.default_score_unit AS default_unit
              FROM v_benchmark_records v JOIN benchmarks b ON b.id = v.benchmark_id
        ),
        best AS (
            SELECT DISTINCT ON (benchmark_id, model_id) *
              FROM rec {where.sql()}
             ORDER BY benchmark_id, model_id, benchmark_score DESC, evaluation_date DESC NULLS LAST
        ),
        ranked AS (
            SELECT RANK() OVER (PARTITION BY benchmark_id ORDER BY benchmark_score DESC) AS rank,
                   COUNT(*) OVER (PARTITION BY benchmark_id) AS ranked_models, *
              FROM best
        )
        SELECT * FROM ranked WHERE model_id = ANY(%(model_ids)s)
    """, {**where.params, "model_ids": model_ids})

    by_bench: dict = {}
    for r in rows:
        by_bench.setdefault(r["benchmark_id"], {})[r["model_id"]] = {**r, "result_id": r["id"]}
    if not by_bench:
        return {"models": models, "rows": []}
    benches = fetch_all(conn, f"SELECT {BENCHMARK_REF_COLS} FROM benchmarks WHERE id = ANY(%(ids)s) "
                              "ORDER BY area NULLS LAST, benchmark_name, benchmark_version NULLS FIRST",
                        {"ids": list(by_bench)})
    out_rows = []
    for b in benches:
        cells = [by_bench[b["id"]].get(m["id"]) for m in models]
        if only_shared and any(c is None for c in cells):
            continue
        out_rows.append({"benchmark": b, "cells": cells})
    return {"models": models, "rows": out_rows}
