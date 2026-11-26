"""Read-only connection pool and small query helpers."""
from __future__ import annotations

from typing import Any, Iterator

import psycopg
from fastapi import Request
from psycopg.rows import dict_row
from psycopg.types.numeric import FloatLoader
from psycopg_pool import ConnectionPool

from .config import ApiSettings


def create_pool(settings: ApiSettings) -> ConnectionPool:
    def configure(conn: psycopg.Connection) -> None:
        # NUMERIC -> float, so JSON gets numbers rather than Decimal strings
        conn.adapters.register_loader("numeric", FloatLoader)
        conn.execute("SET default_transaction_read_only = on")
        conn.execute(f"SET statement_timeout = {int(settings.statement_timeout_ms)}")

    return ConnectionPool(
        settings.database_url,
        min_size=settings.pool_min,
        max_size=settings.pool_max,
        kwargs={"row_factory": dict_row, "autocommit": True},
        configure=configure,
        timeout=5,
        open=False,
    )


def get_conn(request: Request) -> Iterator[psycopg.Connection]:
    with request.app.state.pool.connection() as conn:
        yield conn


def fetch_all(conn: psycopg.Connection, query: str, params: dict[str, Any] | None = None) -> list[dict]:
    return conn.execute(query, params or {}).fetchall()


def fetch_one(conn: psycopg.Connection, query: str, params: dict[str, Any] | None = None) -> dict | None:
    return conn.execute(query, params or {}).fetchone()


class Where:
    """Collects SQL conditions with named params.

    Column expressions are always literals written in this codebase; only
    values come from the request and they are passed as bound parameters.
    """

    def __init__(self) -> None:
        self.conditions: list[str] = []
        self.params: dict[str, Any] = {}

    def add(self, condition: str, **params: Any) -> "Where":
        self.conditions.append(condition)
        self.params.update(params)
        return self

    def add_if(self, value: Any, condition: str, name: str) -> "Where":
        if value is not None and value != []:
            self.add(condition, **{name: value})
        return self

    def sql(self, prefix: str = "WHERE") -> str:
        return f"{prefix} " + " AND ".join(self.conditions) if self.conditions else ""
