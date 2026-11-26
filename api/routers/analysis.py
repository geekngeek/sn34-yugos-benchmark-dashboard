"""Historical trends and cost/performance analysis."""
from __future__ import annotations

from datetime import date
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Query

from ..db import Where, fetch_all, get_conn
from ..queries import AS_OF, get_benchmark, ranked_results, result_filters
from ..schemas import BenchmarkTrend, CostPerformance, GroupBy, Pick

router = APIRouter(prefix="/analysis", tags=["analysis"])
Conn = Annotated[object, Depends(get_conn)]


@router.get("/trends/{benchmark_id}", response_model=BenchmarkTrend,
            summary="State-of-the-art over time, plus score history per model")
def benchmark_trend(
    benchmark_id: UUID,
    conn: Conn,
    model_id: Annotated[list[UUID] | None, Query(description="models to chart (default: current top N)")] = None,
    top: Annotated[int, Query(ge=1, le=20, description="N when model_id is not given")] = 5,
    source_id: UUID | None = None,
    provider: str | None = None,
    reasoning_effort: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
):
    filters = dict(source_id=source_id, provider=provider, reasoning_effort=reasoning_effort,
                   date_from=date_from, date_to=date_to)
    benchmark = get_benchmark(conn, benchmark_id)
    unit = benchmark["default_score_unit"]

    where = result_filters(Where(), **filters)
    where.add("benchmark_id = %(benchmark_id)s", benchmark_id=benchmark_id)
    where.add("benchmark_score IS NOT NULL")
    if unit:
        where.add("score_unit = %(unit)s", unit=unit)
    rows = fetch_all(conn, f"""
        SELECT {AS_OF} AS date, benchmark_score, id AS result_id, model_id, model_name,
               provider, reasoning_effort, source_name
          FROM v_benchmark_records {where.sql()}
         ORDER BY 1, benchmark_score DESC
    """, where.params)

    # frontier: every result that beat the best score seen before its date
    frontier, best = [], None
    for r in rows:
        if best is None or r["benchmark_score"] > best:
            best = r["benchmark_score"]
            if frontier and frontier[-1]["date"] == r["date"]:
                frontier[-1] = r          # keep only the day's best
            else:
                frontier.append(r)

    if model_id:
        wanted = list(dict.fromkeys(model_id))
    else:
        top_rows, _ = ranked_results(conn, benchmark, where=result_filters(Where(), **filters), limit=top)
        wanted = [r["model_id"] for r in top_rows]

    series = []
    for mid in wanted:
        points = [r for r in rows if r["model_id"] == mid]
        if points:
            p0 = points[0]
            series.append({"model": {"id": mid, "provider": p0["provider"], "model_name": p0["model_name"]},
                           "points": points})
    return {"benchmark": benchmark, "score_unit": unit, "frontier": frontier, "series": series}


CostMetric = Literal["cost_per_task", "blended_price"]


@router.get("/cost-performance/{benchmark_id}", response_model=CostPerformance,
            summary="Score vs. cost scatter with the Pareto frontier marked")
def cost_performance(
    benchmark_id: UUID,
    conn: Conn,
    cost_metric: Annotated[CostMetric, Query(description=(
        "cost_per_task: published USD per task; blended_price: USD per 1M tokens, "
        "3:1 input:output"))] = "cost_per_task",
    pick: Pick = "best",
    group_by: GroupBy = "model_effort",
    source_id: UUID | None = None,
    provider: str | None = None,
    reasoning_effort: str | None = None,
):
    benchmark = get_benchmark(conn, benchmark_id)
    where = result_filters(Where(), source_id=source_id, provider=provider,
                           reasoning_effort=reasoning_effort)
    rows, unit = ranked_results(conn, benchmark, pick=pick, group_by=group_by, where=where)

    points = []
    for r in rows:
        if cost_metric == "cost_per_task":
            cost = r["cost_per_task_usd"]
        elif r["input_token_price"] is not None and r["output_token_price"] is not None:
            cost = (3 * r["input_token_price"] + r["output_token_price"]) / 4
        else:
            cost = None
        # a published cost of 0 means "not reported" in practice; it would top the frontier
        if cost is not None and cost > 0:
            points.append({**r, "result_id": r["id"], "cost": cost, "is_pareto": False})

    # Pareto: walking from cheapest up, a point is efficient if it beats every cheaper score
    best = None
    for p in sorted(points, key=lambda p: (p["cost"], -p["benchmark_score"])):
        if best is None or p["benchmark_score"] > best:
            p["is_pareto"] = True
            best = p["benchmark_score"]
    points.sort(key=lambda p: p["cost"])
    return {"benchmark": benchmark, "cost_metric": cost_metric,
            "cost_unit": "USD per task" if cost_metric == "cost_per_task" else "USD per 1M tokens (3:1)",
            "score_unit": unit, "points": points}
