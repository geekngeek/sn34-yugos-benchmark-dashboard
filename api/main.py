"""FastAPI app: read-only API over the benchmark database.

    .venv/bin/uvicorn api.main:app --reload --port 8000
    open http://localhost:8000/docs
"""
from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from psycopg import OperationalError
from psycopg_pool import PoolTimeout

from .config import ApiSettings
from .db import create_pool
from .routers import analysis, catalog, results


@asynccontextmanager
async def lifespan(app: FastAPI):
    pool = create_pool(app.state.settings)
    pool.open(wait=False)          # start even if the DB is not up yet; /health reports it
    app.state.pool = pool
    try:
        yield
    finally:
        pool.close()


def create_app(settings: ApiSettings | None = None) -> FastAPI:
    app = FastAPI(
        title="LLM Benchmark Aggregator API",
        version="0.1.0",
        description=("Published LLM benchmark results collected from public sources. "
                     "Data from Artificial Analysis requires attribution to "
                     "https://artificialanalysis.ai/."),
        lifespan=lifespan,
    )
    app.state.settings = settings or ApiSettings.from_env()
    app.add_middleware(CORSMiddleware, allow_origins=app.state.settings.cors_origins,
                       allow_methods=["GET"], allow_headers=["*"])

    @app.exception_handler(PoolTimeout)
    @app.exception_handler(OperationalError)
    async def db_unavailable(_: Request, exc: Exception):
        return JSONResponse({"detail": "database unavailable"}, status_code=503)

    @app.get("/health", tags=["meta"])
    def health(request: Request):
        try:
            with request.app.state.pool.connection(timeout=2) as conn:
                conn.execute("SELECT 1")
            return {"status": "ok", "database": "ok"}
        except Exception:
            return JSONResponse({"status": "degraded", "database": "unavailable"}, status_code=503)

    for module in (catalog, results, analysis):
        app.include_router(module.router, prefix="/api/v1")
    return app


app = create_app()
