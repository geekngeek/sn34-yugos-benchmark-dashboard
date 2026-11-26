from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent


def load_dotenv(path: Path) -> None:
    """Minimal .env loader: KEY=VALUE lines; existing env vars win."""
    if not path.is_file():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


@dataclass(frozen=True)
class ApiSettings:
    database_url: str
    cors_origins: list[str]
    pool_min: int
    pool_max: int
    statement_timeout_ms: int

    @classmethod
    def from_env(cls) -> "ApiSettings":
        load_dotenv(PROJECT_ROOT / ".env")
        return cls(
            database_url=os.environ.get(
                "DATABASE_URL", "postgresql://bench:bench@localhost:5432/llm_bench"),
            cors_origins=[o.strip() for o in os.environ.get(
                "CORS_ORIGINS", "http://localhost:23533").split(",") if o.strip()],
            pool_min=int(os.environ.get("DB_POOL_MIN", "1")),
            pool_max=int(os.environ.get("DB_POOL_MAX", "10")),
            statement_timeout_ms=int(os.environ.get("DB_STATEMENT_TIMEOUT_MS", "10000")),
        )
