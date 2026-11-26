"""Sources, benchmarks, models, pricing, overview."""
from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query

from ..db import Where, fetch_all, fetch_one, get_conn
from ..schemas import Benchmark, Model, ModelDetail, Overview, Pricing, Source

router = APIRouter(tags=["catalog"])
Conn = Annotated[object, Depends(get_conn)]

SOURCES_SQL = """
    SELECT s.id, s.source_name, s.homepage_url, s.description,
           COUNT(r.id)::int AS result_count, MAX(r.collected_at) AS last_collected_at
      FROM sources s LEFT JOIN benchmark_results r ON r.source_id = s.id
     GROUP BY s.id ORDER BY s.source_name
"""


@router.get("/overview", response_model=Overview, summary="Database totals for the dashboard home")
def overview(conn: Conn):
    counts = fetch_one(conn, """
        SELECT (SELECT COUNT(*) FROM sources)::int           AS sources,
               (SELECT COUNT(*) FROM models)::int            AS models,
               (SELECT COUNT(*) FROM benchmarks)::int        AS benchmarks,
               (SELECT COUNT(*) FROM benchmark_results)::int AS results,
               (SELECT COUNT(*) FROM model_pricing)::int     AS pricing_records
    """)
    by_area = fetch_all(conn, """
        SELECT COALESCE(b.area, 'unknown') AS area, COUNT(*)::int AS n
          FROM benchmark_results r JOIN benchmarks b ON b.id = r.benchmark_id
         GROUP BY 1 ORDER BY 2 DESC
    """)
    return {"counts": counts, "results_by_area": {r["area"]: r["n"] for r in by_area},
            "sources": fetch_all(conn, SOURCES_SQL)}


@router.get("/sources", response_model=list[Source])
def list_sources(conn: Conn):
    return fetch_all(conn, SOURCES_SQL)


BENCHMARK_SQL = """
    SELECT b.id, b.benchmark_name, b.benchmark_version, b.area, b.sub_area,
           b.default_score_unit, b.total_tasks, b.homepage_url, b.description,
           COUNT(r.id)::int                 AS result_count,
           COUNT(DISTINCT r.model_id)::int  AS model_count,
           COALESCE(ARRAY_AGG(DISTINCT s.source_name) FILTER (WHERE s.source_name IS NOT NULL),
                    '{{}}')                 AS sources,
           MAX(r.evaluation_date)           AS latest_evaluation_date
      FROM benchmarks b
      LEFT JOIN benchmark_results r ON r.benchmark_id = b.id
      LEFT JOIN sources s ON s.id = r.source_id
      {where}
     GROUP BY b.id
"""


@router.get("/benchmarks", response_model=list[Benchmark])
def list_benchmarks(
    conn: Conn,
    area: str | None = None,
    source_id: UUID | None = None,
    q: Annotated[str | None, Query(description="substring of benchmark name")] = None,
):
    where = Where()
    where.add_if(area, "b.area ILIKE %(area)s", "area")
    where.add_if(q, "b.benchmark_name ILIKE '%%' || %(q)s || '%%'", "q")
    if source_id:
        where.add("EXISTS (SELECT 1 FROM benchmark_results x WHERE x.benchmark_id = b.id "
                  "AND x.source_id = %(source_id)s)", source_id=source_id)
    sql = BENCHMARK_SQL.format(where=where.sql()) + \
        " ORDER BY b.area NULLS LAST, b.benchmark_name, b.benchmark_version NULLS FIRST"
    return fetch_all(conn, sql, where.params)


@router.get("/benchmarks/{benchmark_id}", response_model=Benchmark)
def get_benchmark(benchmark_id: UUID, conn: Conn):
    row = fetch_one(conn, BENCHMARK_SQL.format(where="WHERE b.id = %(id)s"), {"id": benchmark_id})
    if row is None:
        raise HTTPException(404, f"benchmark {benchmark_id} not found")
    return row


MODEL_SQL = """
    SELECT m.id, m.canonical_key, m.provider, m.model_name, m.model_version,
           m.release_date, m.aliases,
           COUNT(r.id)::int                    AS result_count,
           COUNT(DISTINCT r.benchmark_id)::int AS benchmark_count
      FROM models m LEFT JOIN benchmark_results r ON r.model_id = m.id
      {where}
     GROUP BY m.id
"""


@router.get("/models", response_model=list[Model])
def list_models(
    conn: Conn,
    provider: str | None = None,
    q: Annotated[str | None, Query(description="substring of model name or alias")] = None,
    benchmark_id: Annotated[UUID | None, Query(description="only models with results here")] = None,
):
    where = Where()
    where.add_if(provider, "m.provider ILIKE %(provider)s", "provider")
    if q:
        where.add("(m.model_name ILIKE '%%' || %(q)s || '%%' OR EXISTS "
                  "(SELECT 1 FROM unnest(m.aliases) a WHERE a ILIKE '%%' || %(q)s || '%%'))", q=q)
    if benchmark_id:
        where.add("EXISTS (SELECT 1 FROM benchmark_results x WHERE x.model_id = m.id "
                  "AND x.benchmark_id = %(benchmark_id)s)", benchmark_id=benchmark_id)
    sql = MODEL_SQL.format(where=where.sql()) + " ORDER BY m.provider, m.model_name"
    return fetch_all(conn, sql, where.params)


PRICING_SQL = """
    SELECT p.api_provider, p.input_token_price, p.output_token_price, p.cache_read_price,
           p.cache_write_price, p.currency, p.effective_from, p.effective_to,
           s.source_name, p.source_url, p.additional_pricing
      FROM model_pricing p LEFT JOIN sources s ON s.id = p.source_id
     WHERE p.model_id = %(id)s {extra}
     ORDER BY p.api_provider, p.effective_from DESC
"""


@router.get("/models/{model_id}", response_model=ModelDetail,
            summary="Model with current prices and its best result on every benchmark")
def get_model(model_id: UUID, conn: Conn):
    model = fetch_one(conn, MODEL_SQL.format(where="WHERE m.id = %(id)s"), {"id": model_id})
    if model is None:
        raise HTTPException(404, f"model {model_id} not found")
    model["current_pricing"] = fetch_all(
        conn, PRICING_SQL.format(extra="AND p.effective_to IS NULL"), {"id": model_id})
    model["best_results"] = fetch_all(conn, """
        SELECT DISTINCT ON (benchmark_id, reasoning_effort) *
          FROM v_benchmark_records
         WHERE model_id = %(id)s AND benchmark_score IS NOT NULL
         ORDER BY benchmark_id, reasoning_effort, benchmark_score DESC,
                  evaluation_date DESC NULLS LAST
    """, {"id": model_id})
    model["best_results"].sort(key=lambda r: (r["area"] or "~", r["benchmark_name"],
                                              r["benchmark_version"] or "", r["reasoning_effort"] or ""))
    return model


@router.get("/models/{model_id}/pricing", response_model=list[Pricing],
            summary="Full price history of a model, per hosting provider")
def model_pricing(model_id: UUID, conn: Conn):
    if fetch_one(conn, "SELECT 1 FROM models WHERE id = %(id)s", {"id": model_id}) is None:
        raise HTTPException(404, f"model {model_id} not found")
    return fetch_all(conn, PRICING_SQL.format(extra=""), {"id": model_id})

