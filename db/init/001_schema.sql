-- =====================================================================
-- LLM Benchmark Aggregator — core schema
-- Data is collected from public benchmark sites (no own evaluation).
-- Tables: sources, models, benchmarks, raw_data, model_pricing,
--         benchmark_results
-- Requires PostgreSQL 15+ (uses NULLS NOT DISTINCT).
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid()

-- ---------------------------------------------------------------------
-- updated_at helper
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------
-- sources: who published the data (Artificial Analysis, SWE-bench, ...)
-- ---------------------------------------------------------------------
CREATE TABLE sources (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_name  TEXT NOT NULL UNIQUE,          -- Data publisher
    homepage_url TEXT,
    description  TEXT,
    metadata     JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- models: one row per exact model version
-- ---------------------------------------------------------------------
CREATE TABLE models (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Source-independent identity used to match the same model across sites,
    -- e.g. "Claude Opus 4.5" / "claude-4-5-opus-20251101" -> "4-5-claude-opus".
    -- Computed by collectors (collectors/normalize.py: canonical_key).
    canonical_key TEXT NOT NULL UNIQUE,
    provider      TEXT NOT NULL,                -- Model developer
    model_name    TEXT NOT NULL,                -- e.g. "GPT-5"
    model_version TEXT,                         -- e.g. "gpt-5-2025-08-07"
    release_date  DATE,
    aliases       TEXT[] NOT NULL DEFAULT '{}', -- names used by different sources
    metadata      JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX models_provider_idx ON models (provider);
CREATE INDEX models_aliases_gin ON models USING GIN (aliases);

-- ---------------------------------------------------------------------
-- benchmarks: one row per benchmark + version
-- ---------------------------------------------------------------------
CREATE TABLE benchmarks (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    benchmark_name     TEXT NOT NULL,
    benchmark_version  TEXT,                    -- e.g. "Verified", "v2"
    area               TEXT,                    -- coding, reasoning, writing, ...
    sub_area           TEXT,                    -- more specific category
    default_score_unit TEXT,                    -- percentage, points, elo, ...
    total_tasks        INTEGER CHECK (total_tasks IS NULL OR total_tasks >= 0),
    description        TEXT,
    homepage_url       TEXT,
    metadata           JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT benchmarks_uniq UNIQUE NULLS NOT DISTINCT (benchmark_name, benchmark_version)
);
CREATE INDEX benchmarks_area_idx ON benchmarks (area, sub_area);

-- ---------------------------------------------------------------------
-- raw_data: untouched payloads as scraped / fetched (audit + re-parse)
-- ---------------------------------------------------------------------
CREATE TABLE raw_data (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id    UUID NOT NULL REFERENCES sources(id) ON DELETE RESTRICT,
    source_url   TEXT NOT NULL,                 -- exact URL fetched
    fetch_method TEXT,                          -- api, scrape, csv, manual
    payload      JSONB NOT NULL,                -- original data
    content_hash TEXT NOT NULL,                 -- sha256 of payload, for dedupe
    collected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    parsed_at    TIMESTAMPTZ,                   -- NULL = not normalized yet
    parse_error  TEXT,
    CONSTRAINT raw_data_hash_uniq UNIQUE (source_id, content_hash)
);
CREATE INDEX raw_data_unparsed_idx ON raw_data (collected_at) WHERE parsed_at IS NULL;
CREATE INDEX raw_data_payload_gin  ON raw_data USING GIN (payload jsonb_path_ops);

-- ---------------------------------------------------------------------
-- model_pricing: price history per model + hosting provider
-- Prices are USD per 1M tokens.
-- ---------------------------------------------------------------------
CREATE TABLE model_pricing (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    model_id           UUID NOT NULL REFERENCES models(id) ON DELETE CASCADE,
    api_provider       TEXT NOT NULL,           -- hosting / inference provider
    input_token_price  NUMERIC(12,6) CHECK (input_token_price  >= 0),
    output_token_price NUMERIC(12,6) CHECK (output_token_price >= 0),
    cache_read_price   NUMERIC(12,6) CHECK (cache_read_price   >= 0),
    cache_write_price  NUMERIC(12,6) CHECK (cache_write_price  >= 0),
    currency           CHAR(3) NOT NULL DEFAULT 'USD',
    effective_from     DATE NOT NULL,
    effective_to       DATE,                    -- NULL = current price
    source_id          UUID REFERENCES sources(id) ON DELETE SET NULL,
    source_url         TEXT,
    raw_data_id        UUID REFERENCES raw_data(id) ON DELETE SET NULL,
    additional_pricing JSONB NOT NULL DEFAULT '{}'::jsonb, -- tiers, batch discounts, ...
    collected_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT model_pricing_dates CHECK (effective_to IS NULL OR effective_to >= effective_from),
    CONSTRAINT model_pricing_uniq UNIQUE (model_id, api_provider, effective_from)
);
CREATE INDEX model_pricing_lookup_idx ON model_pricing (model_id, api_provider, effective_from DESC);

-- ---------------------------------------------------------------------
-- benchmark_results: one published score for (benchmark, model, setting, source)
-- ---------------------------------------------------------------------
CREATE TABLE benchmark_results (
    id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    benchmark_id              UUID NOT NULL REFERENCES benchmarks(id) ON DELETE CASCADE,
    model_id                  UUID NOT NULL REFERENCES models(id)     ON DELETE CASCADE,
    source_id                 UUID NOT NULL REFERENCES sources(id)    ON DELETE RESTRICT,
    raw_data_id               UUID REFERENCES raw_data(id)            ON DELETE SET NULL,
    -- the source's own stable id for this result (SWE-bench submission folder,
    -- AA model id + snapshot, ...). Distinguishes e.g. two agents on one model.
    external_id               TEXT NOT NULL,

    -- run conditions
    reasoning_effort          TEXT,             -- low, medium, high, max, ...
    api_provider              TEXT,             -- hosting provider used for the run
    evaluation_method         TEXT,             -- published evaluation conditions
    evaluation_date           DATE,

    -- scores
    benchmark_score           NUMERIC(12,4),
    score_unit                TEXT,             -- overrides benchmarks.default_score_unit
    accuracy                  NUMERIC(7,4),
    total_tasks               INTEGER CHECK (total_tasks IS NULL OR total_tasks >= 0),

    -- performance
    time_per_task_sec         NUMERIC(12,3) CHECK (time_per_task_sec >= 0),
    ttft_sec                  NUMERIC(10,3) CHECK (ttft_sec >= 0),
    tokens_per_sec            NUMERIC(10,2) CHECK (tokens_per_sec >= 0),
    input_tokens_per_task     NUMERIC(14,2) CHECK (input_tokens_per_task >= 0),
    output_tokens_per_task    NUMERIC(14,2) CHECK (output_tokens_per_task >= 0),
    reasoning_tokens_per_task NUMERIC(14,2) CHECK (reasoning_tokens_per_task >= 0),

    -- cost as published with the result
    cost_per_task_usd         NUMERIC(14,6) CHECK (cost_per_task_usd >= 0),

    -- provenance
    source_url                TEXT,
    published_at              TIMESTAMPTZ,
    collected_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- benchmark-specific measurements (pass@k, resolved counts, CI, ...)
    additional_metrics        JSONB NOT NULL DEFAULT '{}'::jsonb,

    -- one row per source-reported result (upsert target for collectors)
    CONSTRAINT benchmark_results_uniq UNIQUE (source_id, benchmark_id, external_id)
);
CREATE INDEX benchmark_results_bench_score_idx ON benchmark_results (benchmark_id, benchmark_score DESC);
CREATE INDEX benchmark_results_model_idx       ON benchmark_results (model_id);
CREATE INDEX benchmark_results_eval_date_idx   ON benchmark_results (evaluation_date);
CREATE INDEX benchmark_results_metrics_gin     ON benchmark_results USING GIN (additional_metrics);

-- ---------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------
CREATE TRIGGER sources_updated_at           BEFORE UPDATE ON sources           FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER models_updated_at            BEFORE UPDATE ON models            FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER benchmarks_updated_at        BEFORE UPDATE ON benchmarks        FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER model_pricing_updated_at     BEFORE UPDATE ON model_pricing     FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER benchmark_results_updated_at BEFORE UPDATE ON benchmark_results FOR EACH ROW EXECUTE FUNCTION set_updated_at();
