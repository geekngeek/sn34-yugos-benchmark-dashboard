"""Records produced by a source parser and consumed by the DB writer."""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Any

from .normalize import canonical_key


@dataclass
class SourceInfo:
    name: str
    homepage_url: str | None = None
    description: str | None = None
    collected_at: datetime | None = None


@dataclass
class ModelRec:
    provider: str
    model_name: str
    model_version: str | None = None
    release_date: date | None = None
    aliases: list[str] = field(default_factory=list)

    @property
    def key(self) -> str:
        return canonical_key(self.model_name)


@dataclass
class BenchmarkRec:
    benchmark_name: str
    benchmark_version: str | None = None
    area: str | None = None
    sub_area: str | None = None
    default_score_unit: str | None = None
    total_tasks: int | None = None
    description: str | None = None
    homepage_url: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)   # e.g. lower_is_better, native format

    @property
    def key(self) -> tuple[str, str | None]:
        return (self.benchmark_name, self.benchmark_version)


@dataclass
class ResultRec:
    benchmark: BenchmarkRec
    model: ModelRec
    external_id: str
    benchmark_score: float | None
    score_unit: str | None = None
    reasoning_effort: str | None = None
    api_provider: str | None = None
    evaluation_method: str | None = None
    evaluation_date: date | None = None
    accuracy: float | None = None
    total_tasks: int | None = None
    time_per_task_sec: float | None = None
    ttft_sec: float | None = None
    tokens_per_sec: float | None = None
    input_tokens_per_task: float | None = None
    output_tokens_per_task: float | None = None
    reasoning_tokens_per_task: float | None = None
    cost_per_task_usd: float | None = None
    source_url: str | None = None
    published_at: datetime | None = None
    additional_metrics: dict[str, Any] = field(default_factory=dict)
    # set by the writer from the model ID resolver (importer/resolve.py)
    mode: str | None = None
    model_snapshot: str | None = None
    raw_model_name: str | None = None
    model_match: str | None = None
    config_id: Any = None               # model_configs row (model + effort + mode), set by the writer


@dataclass
class PriceRec:
    model: ModelRec
    api_provider: str
    effective_from: date
    input_token_price: float | None = None
    output_token_price: float | None = None
    cache_read_price: float | None = None
    cache_write_price: float | None = None
    source_url: str | None = None
    additional_pricing: dict[str, Any] = field(default_factory=dict)


@dataclass
class Item:
    """One source record: stored as-is in raw_data, plus what was parsed from it."""
    payload: dict[str, Any]
    source_url: str
    results: list[ResultRec] = field(default_factory=list)
    prices: list[PriceRec] = field(default_factory=list)


@dataclass
class ParsedFile:
    source: SourceInfo
    items: list[Item]
    warnings: list[str] = field(default_factory=list)
