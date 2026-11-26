"""Response models (they also drive the OpenAPI docs at /docs)."""
from __future__ import annotations

from datetime import date, datetime
from typing import Any, Generic, Literal, TypeVar
from uuid import UUID

from pydantic import BaseModel

T = TypeVar("T")


class Page(BaseModel, Generic[T]):
    items: list[T]
    total: int
    limit: int
    offset: int


# --- catalog -------------------------------------------------------------------
class Source(BaseModel):
    id: UUID
    source_name: str
    homepage_url: str | None
    description: str | None
    result_count: int
    last_collected_at: datetime | None


class BenchmarkRef(BaseModel):
    id: UUID
    benchmark_name: str
    benchmark_version: str | None
    area: str | None
    sub_area: str | None
    default_score_unit: str | None


class Benchmark(BenchmarkRef):
    total_tasks: int | None
    homepage_url: str | None
    description: str | None
    result_count: int
    model_count: int
    sources: list[str]
    latest_evaluation_date: date | None


class ModelRef(BaseModel):
    id: UUID
    provider: str
    model_name: str


class ModelConfig(BaseModel):
    """A model as it was run on some benchmarks: model ID + effort + mode (GET /configs)."""
    config: str                         # "<model ID>~<effort>~<mode>", empty trailing parts dropped
    model_key: str
    model_name: str
    provider: str
    reasoning_effort: str | None
    mode: str | None
    results: int
    best_score: float | None            # its best score on the 0-100 scale (sort_score)
    latest: date | None
    effort_rank: int | None = None      # place on the effort ladder within the model (none 0 … max 6)
    yugos_providers: list[str] = []     # world-card providers Yugos can route this configuration to


class ChartPoint(BaseModel):
    """One configuration's latest result on one benchmark from one source (GET /chart-points)."""
    config: str
    model_key: str
    model_name: str
    provider: str
    reasoning_effort: str | None
    mode: str | None
    effort_rank: int | None
    benchmark_name: str
    benchmark_version: str | None
    source_name: str
    quality: float | None               # the 0-100 score when converted, else the published score
    sort_score: float | None            # comparable 0-100 score (NULL when it cannot be compared)
    accuracy: float | None
    cost_per_task: float | None
    time_per_task: float | None
    ttft: float | None
    tokens_per_sec: float | None
    output_tokens: float | None
    output_price: float | None          # USD per 1M output tokens
    input_price: float | None
    date: date | None
    yugos_providers: list[str] = []


class ModelConfigInfo(BaseModel):
    """One configuration of a model on the effort ladder (GET /model-configs)."""
    config: str
    model_key: str
    model_name: str
    provider: str
    reasoning_effort: str | None        # NULL = Default (not stated)
    mode: str | None
    effort_rank: int | None
    effort_label: str
    results: int
    yugos_offers: int
    yugos_providers: list[str]


class Model(ModelRef):
    canonical_key: str                  # the project model ID, "vendor/name" (data/models/registry.csv)
    model_version: str | None
    release_date: date | None
    aliases: list[str]
    result_count: int
    benchmark_count: int


class Pricing(BaseModel):
    api_provider: str
    input_token_price: float | None
    output_token_price: float | None
    cache_read_price: float | None
    cache_write_price: float | None
    currency: str
    effective_from: date
    effective_to: date | None
    source_name: str | None
    source_url: str | None
    additional_pricing: dict[str, Any]


# --- results ---------------------------------------------------------------------
class Result(BaseModel):
    """One row of v_benchmark_records — the full field list of the record spec."""
    id: UUID
    benchmark_id: UUID
    model_id: UUID
    source_id: UUID
    benchmark_name: str
    benchmark_version: str | None
    area: str | None
    sub_area: str | None
    provider: str
    model_name: str
    model_version: str | None
    reasoning_effort: str | None
    benchmark_score: float | None
    score_unit: str | None
    display_score: float | None = None  # the score on a 0-100 scale when it was converted (api/scales.py)
    scale_note: str | None = None       # what the original number is: "Elo", "task-hours of 690", ...
    accuracy: float | None
    total_tasks: int | None
    time_per_task_sec: float | None
    ttft_sec: float | None
    tokens_per_sec: float | None
    input_tokens_per_task: float | None
    output_tokens_per_task: float | None
    reasoning_tokens_per_task: float | None
    cost_per_task_usd: float | None
    input_token_price: float | None
    output_token_price: float | None
    cache_read_price: float | None
    cache_write_price: float | None
    api_provider: str | None
    evaluation_method: str | None
    evaluation_date: date | None
    source_name: str
    source_url: str | None
    published_at: datetime | None
    collected_at: datetime
    updated_at: datetime
    additional_metrics: dict[str, Any]
    # model ID and run configuration (data/models/, importer/model_ids.py)
    model_key: str | None = None        # project model ID, e.g. "anthropic/claude-opus-4.5"
    mode: str | None = None             # search | codex-harness | fp8 | … ("+"-joined)
    model_snapshot: str | None = None   # dated snapshot as the source wrote it
    raw_model_name: str | None = None   # the source's own name for the model
    model_match: str | None = None      # how that name was matched: rule | yugos-exact | yugos-loose | override
    config_key: str | None = None       # model + effort + mode ("<model ID>~<effort>~<mode>")
    effort_rank: int | None = None      # place on the effort ladder within the model


class RawPayload(BaseModel):
    raw_data_id: UUID
    source_url: str
    fetch_method: str | None
    collected_at: datetime
    parsed_at: datetime | None
    payload: dict[str, Any]


class ModelDetail(Model):
    current_pricing: list[Pricing]
    best_results: list[Result]


# --- analysis ----------------------------------------------------------------------
Pick = Literal["best", "latest"]
GroupBy = Literal["model", "model_effort"]


class LeaderboardEntry(BaseModel):
    rank: int
    result_id: UUID
    model_id: UUID
    model_name: str
    provider: str
    reasoning_effort: str | None
    benchmark_score: float
    score_unit: str | None
    accuracy: float | None
    cost_per_task_usd: float | None
    input_token_price: float | None
    output_token_price: float | None
    tokens_per_sec: float | None
    evaluation_date: date | None
    evaluation_method: str | None
    source_name: str
    additional_metrics: dict[str, Any]


class Leaderboard(BaseModel):
    benchmark: BenchmarkRef
    pick: Pick
    group_by: GroupBy
    score_unit: str | None
    entries: list[LeaderboardEntry]


class CompareCell(BaseModel):
    result_id: UUID
    benchmark_score: float
    score_unit: str | None
    reasoning_effort: str | None
    rank: int            # rank among all models on this benchmark (best per model)
    ranked_models: int
    evaluation_date: date | None
    source_name: str


class CompareRow(BaseModel):
    benchmark: BenchmarkRef
    cells: list[CompareCell | None]   # aligned with Comparison.models


class Comparison(BaseModel):
    models: list[ModelRef]
    rows: list[CompareRow]


class TrendPoint(BaseModel):
    date: date
    benchmark_score: float
    result_id: UUID
    model_id: UUID
    model_name: str
    reasoning_effort: str | None
    source_name: str


class TrendSeries(BaseModel):
    model: ModelRef
    points: list[TrendPoint]


class BenchmarkTrend(BaseModel):
    benchmark: BenchmarkRef
    score_unit: str | None
    frontier: list[TrendPoint]   # each point = new state-of-the-art score
    series: list[TrendSeries]


class CostPoint(BaseModel):
    result_id: UUID
    model_id: UUID
    model_name: str
    provider: str
    reasoning_effort: str | None
    benchmark_score: float
    cost: float
    is_pareto: bool              # no other point is both cheaper and better


class CostPerformance(BaseModel):
    benchmark: BenchmarkRef
    cost_metric: Literal["cost_per_task", "blended_price"]
    cost_unit: str
    score_unit: str | None
    points: list[CostPoint]


class FilterSource(BaseModel):
    id: UUID
    source_name: str
    result_count: int


class FilterBenchmark(BaseModel):
    id: UUID
    benchmark_name: str
    benchmark_version: str | None
    area: str | None
    sources: list[str]
    result_count: int


class FilterModel(BaseModel):
    id: UUID
    model_name: str
    provider: str
    result_count: int


class FilterOptions(BaseModel):
    sources: list[FilterSource]
    benchmarks: list[FilterBenchmark]
    models: list[FilterModel]
    areas: list[str]
    providers: list[str]
    reasoning_efforts: list[str]
    sorts: list[str]


class Overview(BaseModel):
    counts: dict[str, int]
    results_by_area: dict[str, int]
    sources: list[Source]
