"""Shared SQL used by several routers."""
from __future__ import annotations

from datetime import date
from typing import Any
from uuid import UUID

from fastapi import HTTPException

from .db import Where, fetch_all, fetch_one

BENCHMARK_REF_COLS = "id, benchmark_name, benchmark_version, area, sub_area, default_score_unit"

# date used for history when a source gives no evaluation date (e.g. Artificial Analysis)
AS_OF = "COALESCE(evaluation_date, collected_at::date)"


def get_benchmark(conn, benchmark_id: UUID) -> dict:
    row = fetch_one(conn, f"SELECT {BENCHMARK_REF_COLS} FROM benchmarks WHERE id = %(id)s",
                    {"id": benchmark_id})
    if row is None:
        raise HTTPException(404, f"benchmark {benchmark_id} not found")
    return row


def result_filters(
    where: Where, *, source_id: UUID | None = None, provider: str | None = None,
    reasoning_effort: str | None = None, date_from: date | None = None,
    date_to: date | None = None,
) -> Where:
    where.add_if(source_id, "source_id = %(source_id)s", "source_id")
    where.add_if(provider, "provider ILIKE %(provider)s", "provider")
    if reasoning_effort == "unspecified":
        where.add("reasoning_effort IS NULL")
    else:
        where.add_if(reasoning_effort, "reasoning_effort = %(reasoning_effort)s", "reasoning_effort")
    where.add_if(date_from, f"{AS_OF} >= %(date_from)s", "date_from")
    where.add_if(date_to, f"{AS_OF} <= %(date_to)s", "date_to")
    return where


def ranked_results(
    conn, benchmark: dict, *, pick: str = "best", group_by: str = "model",
    score_unit: str | None = None, where: Where | None = None, limit: int | None = None,
) -> tuple[list[dict], str | None]:
    """One result per model (or model + effort), ranked by score.

    pick=best   -> highest score of each group
    pick=latest -> most recent result of each group
    Only results in one score unit are ranked (benchmark default unless given),
    so percentages are never mixed with Elo or index points.
    """
    where = where or Where()
    where.add("benchmark_id = %(benchmark_id)s", benchmark_id=benchmark["id"])
    where.add("benchmark_score IS NOT NULL")
    unit = score_unit or benchmark["default_score_unit"]
    if unit:
        where.add("score_unit = %(score_unit)s", score_unit=unit)

    group_cols = "model_id" if group_by == "model" else "model_id, reasoning_effort"
    order = ("benchmark_score DESC, evaluation_date DESC NULLS LAST, collected_at DESC"
             if pick == "best" else f"{AS_OF} DESC, collected_at DESC, benchmark_score DESC")
    params: dict[str, Any] = dict(where.params)
    limit_sql = ""
    if limit is not None:
        limit_sql = "LIMIT %(limit)s"
        params["limit"] = limit
    rows = fetch_all(conn, f"""
        WITH picked AS (
            SELECT DISTINCT ON ({group_cols}) *
              FROM v_benchmark_records
              {where.sql()}
             ORDER BY {group_cols}, {order}
        )
        SELECT RANK() OVER (ORDER BY benchmark_score DESC) AS rank,
               COUNT(*) OVER () AS ranked_models, *
          FROM picked
         ORDER BY benchmark_score DESC, model_name, reasoning_effort NULLS FIRST
         {limit_sql}
    """, params)
    return rows, unit
