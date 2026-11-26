"""Write a ParsedFile into the database.

The whole file is imported in one transaction (all or nothing). Re-importing
the same file changes nothing: every write is an upsert that skips rows whose
values are already identical.
"""
from __future__ import annotations

import hashlib
import json
import logging
from collections import Counter
from dataclasses import dataclass, field
from uuid import UUID

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from .records import BenchmarkRec, ModelRec, ParsedFile, PriceRec, ResultRec

log = logging.getLogger(__name__)

RESULT_COLS = (
    "reasoning_effort", "api_provider", "evaluation_method", "evaluation_date",
    "benchmark_score", "score_unit", "accuracy", "total_tasks",
    "time_per_task_sec", "ttft_sec", "tokens_per_sec",
    "input_tokens_per_task", "output_tokens_per_task", "reasoning_tokens_per_task",
    "cost_per_task_usd", "source_url", "published_at", "additional_metrics",
)
PRICE_COLS = ("input_token_price", "output_token_price", "cache_read_price", "cache_write_price")
_NON_NEGATIVE = ("time_per_task_sec", "ttft_sec", "tokens_per_sec", "input_tokens_per_task",
                 "output_tokens_per_task", "reasoning_tokens_per_task", "cost_per_task_usd")


@dataclass
class Stats:
    source: str
    items: int = 0
    raw_new: int = 0
    results: Counter = field(default_factory=Counter)
    prices: Counter = field(default_factory=Counter)
    invalid: list[str] = field(default_factory=list)
    deleted: Counter = field(default_factory=Counter)
    warnings: list[str] = field(default_factory=list)

    def summary(self) -> str:
        fmt = lambda c: ", ".join(f"{k} {v}" for k, v in sorted(c.items())) or "none"
        lines = [f"[{self.source}] {self.items} records, {self.raw_new} new raw records",
                 f"  results: {fmt(self.results)}",
                 f"  prices:  {fmt(self.prices)}"]
        if self.deleted:
            lines.append(f"  replaced (deleted first): {fmt(self.deleted)}")
        if self.invalid:
            lines.append(f"  skipped {len(self.invalid)} invalid results, e.g. {self.invalid[0]}")
        for w in self.warnings[:5]:
            lines.append(f"  warning: {w}")
        if len(self.warnings) > 5:
            lines.append(f"  ... {len(self.warnings) - 5} more warnings")
        return "\n".join(lines)


def connect(dsn: str) -> psycopg.Connection:
    return psycopg.connect(dsn, row_factory=dict_row, autocommit=True)


def validate(r: ResultRec) -> str | None:
    if not r.external_id:
        return "missing external_id"
    if r.benchmark_score is None:
        return "no score"
    unit = r.score_unit or r.benchmark.default_score_unit
    if unit in ("percentage", "points") and not 0 <= r.benchmark_score <= 100:
        return f"score {r.benchmark_score} outside 0-100"
    for f in _NON_NEGATIVE:
        v = getattr(r, f)
        if v is not None and v < 0:
            return f"negative {f}"
    return None


class Writer:
    def __init__(self, conn: psycopg.Connection, stats: Stats):
        self.conn, self.stats = conn, stats
        self._models: dict[str, UUID] = {}
        self._benchmarks: dict[tuple, UUID] = {}
        self._priced_models: set[UUID] = set()

    # -- source / raw -------------------------------------------------------------
    def source(self, name, homepage_url, description) -> UUID:
        row = self.conn.execute(
            """INSERT INTO sources (source_name, homepage_url, description) VALUES (%s, %s, %s)
               ON CONFLICT (source_name) DO UPDATE SET homepage_url = EXCLUDED.homepage_url,
                   description = EXCLUDED.description
               WHERE (sources.homepage_url, sources.description)
                     IS DISTINCT FROM (EXCLUDED.homepage_url, EXCLUDED.description)
               RETURNING id""", (name, homepage_url, description)).fetchone()
        return row["id"] if row else self.conn.execute(
            "SELECT id FROM sources WHERE source_name = %s", (name,)).fetchone()["id"]

    def delete_source_data(self, source_id: UUID) -> None:
        for table in ("benchmark_results", "model_pricing", "raw_data"):
            n = self.conn.execute(f"DELETE FROM {table} WHERE source_id = %s", (source_id,)).rowcount
            self.stats.deleted[table] += n
        self.delete_orphans()

    def delete_orphans(self) -> None:
        self.stats.deleted["models"] += self.conn.execute(
            """DELETE FROM models m WHERE NOT EXISTS (SELECT 1 FROM benchmark_results r WHERE r.model_id = m.id)
                 AND NOT EXISTS (SELECT 1 FROM model_pricing p WHERE p.model_id = m.id)""").rowcount
        self.stats.deleted["benchmarks"] += self.conn.execute(
            """DELETE FROM benchmarks b WHERE NOT EXISTS
                 (SELECT 1 FROM benchmark_results r WHERE r.benchmark_id = b.id)""").rowcount
        self._models.clear()
        self._benchmarks.clear()

    def raw(self, source_id: UUID, source_url: str, payload: dict) -> UUID:
        h = hashlib.sha256(json.dumps(payload, sort_keys=True, separators=(",", ":"),
                                      ensure_ascii=False).encode()).hexdigest()
        row = self.conn.execute(
            """INSERT INTO raw_data (source_id, source_url, fetch_method, payload, content_hash, parsed_at)
               VALUES (%s, %s, 'json-import', %s, %s, now())
               ON CONFLICT (source_id, content_hash) DO NOTHING RETURNING id""",
            (source_id, source_url, Jsonb(payload), h)).fetchone()
        if row:
            self.stats.raw_new += 1
            return row["id"]
        return self.conn.execute("SELECT id FROM raw_data WHERE source_id = %s AND content_hash = %s",
                                 (source_id, h)).fetchone()["id"]

    # -- models / benchmarks ------------------------------------------------------------
    def model(self, m: ModelRec) -> UUID:
        key = m.key
        if key in self._models:
            mid = self._models[key]
            if m.aliases:
                self.conn.execute(
                    """UPDATE models SET aliases = ARRAY(SELECT DISTINCT a FROM unnest(aliases || %s::text[]) a ORDER BY a)
                       WHERE id = %s AND NOT aliases @> %s::text[]""", (m.aliases, mid, m.aliases))
            return mid
        aliases = sorted({a for a in [m.model_name, *m.aliases] if a})
        row = self.conn.execute(
            """INSERT INTO models AS t (canonical_key, provider, model_name, model_version, release_date, aliases)
               VALUES (%s, %s, %s, %s, %s, %s)
               ON CONFLICT (canonical_key) DO UPDATE SET
                   provider      = CASE WHEN t.provider = 'Unknown' THEN EXCLUDED.provider ELSE t.provider END,
                   model_version = COALESCE(t.model_version, EXCLUDED.model_version),
                   release_date  = COALESCE(t.release_date, EXCLUDED.release_date),
                   aliases       = ARRAY(SELECT DISTINCT a FROM unnest(t.aliases || EXCLUDED.aliases) a ORDER BY a)
               WHERE (t.provider = 'Unknown' AND EXCLUDED.provider <> 'Unknown')
                  OR (t.model_version IS NULL AND EXCLUDED.model_version IS NOT NULL)
                  OR (t.release_date IS NULL AND EXCLUDED.release_date IS NOT NULL)
                  OR NOT t.aliases @> EXCLUDED.aliases
               RETURNING id""",
            (key, m.provider, m.model_name, m.model_version, m.release_date, aliases)).fetchone()
        mid = row["id"] if row else self.conn.execute(
            "SELECT id FROM models WHERE canonical_key = %s", (key,)).fetchone()["id"]
        self._models[key] = mid
        return mid

    def benchmark(self, b: BenchmarkRec) -> UUID:
        if b.key in self._benchmarks:
            return self._benchmarks[b.key]
        cols = ("area", "sub_area", "default_score_unit", "total_tasks", "description", "homepage_url")
        row = self.conn.execute(
            f"""INSERT INTO benchmarks AS t (benchmark_name, benchmark_version, {", ".join(cols)})
                VALUES (%s, %s, {", ".join(["%s"] * len(cols))})
                ON CONFLICT ON CONSTRAINT benchmarks_uniq DO UPDATE SET
                    {", ".join(f"{c} = COALESCE(EXCLUDED.{c}, t.{c})" for c in cols)}
                WHERE {" OR ".join(f"(EXCLUDED.{c} IS NOT NULL AND EXCLUDED.{c} IS DISTINCT FROM t.{c})" for c in cols)}
                RETURNING id""",
            (b.benchmark_name, b.benchmark_version, *(getattr(b, c) for c in cols))).fetchone()
        bid = row["id"] if row else self.conn.execute(
            """SELECT id FROM benchmarks WHERE benchmark_name = %s
               AND benchmark_version IS NOT DISTINCT FROM %s""", b.key).fetchone()["id"]
        if b.metadata:
            self.conn.execute(
                "UPDATE benchmarks SET metadata = metadata || %s WHERE id = %s AND NOT metadata @> %s",
                (Jsonb(b.metadata), bid, Jsonb(b.metadata)))
        self._benchmarks[b.key] = bid
        return bid

    # -- results ------------------------------------------------------------------------
    def result(self, r: ResultRec, source_id: UUID, raw_id: UUID, collected_at) -> None:
        problem = validate(r)
        if problem:
            self.stats.invalid.append(f"{r.external_id} / {r.benchmark.benchmark_name} "
                                      f"{r.benchmark.benchmark_version or ''}: {problem}")
            return
        values = [getattr(r, c) for c in RESULT_COLS]
        values[RESULT_COLS.index("additional_metrics")] = Jsonb(r.additional_metrics)
        changed = " OR ".join(f"t.{c} IS DISTINCT FROM EXCLUDED.{c}" for c in RESULT_COLS)
        row = self.conn.execute(
            f"""INSERT INTO benchmark_results AS t
                    (benchmark_id, model_id, source_id, raw_data_id, external_id, collected_at, {", ".join(RESULT_COLS)})
                VALUES (%s, %s, %s, %s, %s, COALESCE(%s, now()), {", ".join(["%s"] * len(RESULT_COLS))})
                ON CONFLICT ON CONSTRAINT benchmark_results_uniq DO UPDATE SET
                    model_id = EXCLUDED.model_id, raw_data_id = EXCLUDED.raw_data_id,
                    {", ".join(f"{c} = EXCLUDED.{c}" for c in RESULT_COLS)}
                WHERE t.model_id IS DISTINCT FROM EXCLUDED.model_id OR {changed}
                RETURNING (xmax = 0) AS inserted""",
            (self.benchmark(r.benchmark), self.model(r.model), source_id, raw_id, r.external_id,
             collected_at, *values)).fetchone()
        self.stats.results["unchanged" if row is None else "inserted" if row["inserted"] else "updated"] += 1

    # -- prices -------------------------------------------------------------------------
    def price(self, p: PriceRec, source_id: UUID, raw_id: UUID) -> None:
        if all(getattr(p, c) is None for c in PRICE_COLS):
            return
        mid = self.model(p.model)
        prices = [getattr(p, c) for c in PRICE_COLS]
        # skip when the price in force on that date is already identical
        prev = self.conn.execute(
            f"""SELECT id, effective_from, {", ".join(PRICE_COLS)} FROM model_pricing
                WHERE model_id = %s AND api_provider = %s AND effective_from <= %s
                ORDER BY effective_from DESC LIMIT 1""", (mid, p.api_provider, p.effective_from)).fetchone()
        same = prev is not None and all(
            (prev[c] is None and v is None) or (prev[c] is not None and v is not None and abs(float(prev[c]) - v) < 1e-9)
            for c, v in zip(PRICE_COLS, prices))
        if same:
            self.stats.prices["unchanged"] += 1
            return
        row = self.conn.execute(
            f"""INSERT INTO model_pricing AS t (model_id, api_provider, effective_from, {", ".join(PRICE_COLS)},
                    source_id, source_url, raw_data_id, additional_pricing)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT ON CONSTRAINT model_pricing_uniq DO UPDATE SET
                    {", ".join(f"{c} = EXCLUDED.{c}" for c in PRICE_COLS)},
                    source_id = EXCLUDED.source_id, source_url = EXCLUDED.source_url,
                    raw_data_id = EXCLUDED.raw_data_id, additional_pricing = EXCLUDED.additional_pricing
                RETURNING (xmax = 0) AS inserted""",
            (mid, p.api_provider, p.effective_from, *prices, source_id, p.source_url, raw_id,
             Jsonb(p.additional_pricing))).fetchone()
        self.stats.prices["inserted" if row["inserted"] else "updated"] += 1
        self._priced_models.add(mid)

    def close_price_periods(self) -> None:
        """effective_to = day before the next price of the same model + provider."""
        if not self._priced_models:
            return
        self.conn.execute(
            """UPDATE model_pricing p SET effective_to = n.next_from - 1
               FROM (SELECT id, LEAD(effective_from) OVER (PARTITION BY model_id, api_provider
                                                           ORDER BY effective_from) AS next_from
                       FROM model_pricing WHERE model_id = ANY(%s)) n
               WHERE p.id = n.id AND p.effective_to IS DISTINCT FROM n.next_from - 1""",
            (list(self._priced_models),))


def write(conn: psycopg.Connection, parsed: ParsedFile, *, replace: bool = False,
          dry_run: bool = False) -> Stats:
    stats = Stats(parsed.source.name, items=len(parsed.items), warnings=list(parsed.warnings))
    with conn.transaction() as tx:
        w = Writer(conn, stats)
        src = parsed.source
        source_id = w.source(src.name, src.homepage_url, src.description)
        if replace:
            w.delete_source_data(source_id)
        for item in parsed.items:
            raw_id = w.raw(source_id, item.source_url, item.payload)
            for r in item.results:
                w.result(r, source_id, raw_id, src.collected_at)
            for p in item.prices:
                w.price(p, source_id, raw_id)
        w.close_price_periods()
        if dry_run:
            raise psycopg.Rollback(tx)  # caught by the block: nothing is committed
    return stats
