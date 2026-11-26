# Step 1 — Benchmark database (PostgreSQL + JSONB)

```
sources ─┐
models ──┼─< benchmark_results >── benchmarks
         │         │
         │      raw_data (JSONB payload as fetched)
         └─< model_pricing (price history per model + api_provider)
```

- `db/init/001_schema.sql` — tables, constraints, indexes, `updated_at` triggers
- `db/init/002_views.sql` — `v_benchmark_records` (flat view with every field of the
  record spec) and `v_latest_results` (newest result per benchmark/model/effort)
- `db/samples/sample_data.sql` — made-up placeholder rows for local dev

## Run

```bash
docker compose up -d
docker compose exec -T db psql -U bench -d llm_bench < db/samples/sample_data.sql
docker compose exec db psql -U bench -d llm_bench -c "SELECT * FROM v_benchmark_records"
```

Init scripts run only on an empty volume; after schema changes: `docker compose down -v && docker compose up -d`.

## Python setup

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
cp .env.example .env
```

There are no data collectors: the database starts empty, and nothing in this
project fetches benchmark data from outside.

## Importing benchmark JSON

`importer/` loads the JSON files in `data/` into the database. It only reads local
files; nothing is fetched from the network.

```bash
.venv/bin/python -m importer data/livebench.json data/artificial_analysis.json data/benchlm.json \
    data/hle.json data/mmlu_pro.json data/gpqa.json data/epoch_ai.json data/openai_simple_evals.json \
    data/aider_polyglot.json data/terminal_bench.json data/tau2_bench.json data/lmarena.json \
    data/wildbench.json data/ocrbench_v2.json data/ruler.json data/swebench.json data/swebench_pro.json \
    data/matharena_aime.json data/mmlu_original.json
.venv/bin/python -m importer data/livebench.json --dry-run   # full import, then rolled back
.venv/bin/python -m importer data/livebench.json --replace   # delete that source's rows first
```

| File | Benchmarks created | Notes |
|---|---|---|
| `data/livebench.json` | `LiveBench` with versions `2.0 Overall`, `2.0 Coding`, … `1.0 Mathematics` … | one result per release × model × category; `evaluation_date` = release date, so releases form the history. Rows the site hides are skipped unless `--include-hidden`. Cost/time/tokens per category from the file; task and subcategory scores in `additional_metrics`. |
| `data/benchlm.json` | every source benchmark BenchLM publishes scores for (533), plus `BenchLM Overall` and `BenchLM <category>` versioned by ranking mode (`bench-align-v5`) | license **CC BY-NC 4.0** (non-commercial, attribution "Data from BenchLM.ai"). No evaluation dates: `external_id` = `<model>:<benchmark>@<value>`. Units: 0–100 → `points`, Elo/ratings → `elo`, other native scales → `score`; `benchmarks.metadata` keeps BenchLM's `format`, `lower_is_better` and `upstream_publisher` (Artificial Analysis, Vals AI). Speed on the Overall row is Artificial Analysis data. Benchmark/decision-system entries (e.g. "GPT-4 (JudgeBench)") are skipped unless `--include-benchmark-systems`. |
| `data/hle.json` | `Humanity's Last Exam` / `Official (lastexam.ai)` | the official results table on lastexam.ai (10 models; judge o3-mini). Calibration error kept in `additional_metrics`. Dataset MIT. |
| `data/mmlu_pro.json` | `MMLU-Pro` / `Official leaderboard` + `Official: <subject>` (14) | TIGER-Lab's leaderboard `results.csv` (Apache-2.0): 262 entries, 140 with subject scores; 0–1 converted to 0–100; `data_source` = TIGER-Lab run or self-reported. |
| `data/gpqa.json` | `GPQA` / `2023 baselines (564 questions)` | accuracy of the GPQA paper's 13 baseline runs (MIT), computed from the repo's run files; a 2023 pre-release question set, **not** GPQA Diamond. No question text stored. |
| `data/epoch_ai.json` | `FrontierMath` / `Tiers 1-3 v2`, `Tier 4 v2`, `Erdős`, plus the two superseded 2025 sets; `SimpleQA Verified` / `Epoch AI` | Epoch AI's own runs from `benchmark_data.zip`, **CC BY 4.0** (credit Epoch AI). Best score across scorers (0–100); mean score, stderr, log viewer link and thinking budget in `additional_metrics`; inference host (Together, Fireworks) in `api_provider`. Epoch's `*_external.csv` files are excluded: they keep their publishers' licensing (e.g. ARC-AGI). |
| `data/openai_simple_evals.json` | `SimpleQA`, `MMLU`, `HumanEval` / `OpenAI simple-evals` | columns of OpenAI's simple-evals results table (MIT). Not updated since July 2025. |
| `data/aider_polyglot.json` | `Aider Polyglot` / `Official leaderboard` | aider's `polyglot_leaderboard.yml` (Apache-2.0): pass rate in 2 attempts, cost, seconds per case. |
| `data/terminal_bench.json` | `Terminal-Bench` / `4.0`, `4.1` | official submissions in harbor-framework/terminal-bench (Apache-2.0): accuracy, 95% CI, pass@k, cost, tokens, agent. |
| `data/tau2_bench.json` | `τ²-bench` / `<Domain>` and `<Domain> (voice)` | official leaderboard submissions in sierra-research/tau2-bench (MIT): pass^1 per domain. |
| `data/lmarena.json` | `LMArena` / `Text`, `WebDev`, `Vision`, `Agent`, `Document`, `Search` | lmarena-ai/leaderboard-dataset latest snapshot, overall category (**CC BY 4.0**); unit `elo`. |
| `data/wildbench.json` | `WildBench` / `WB-Score` (score, −100..100), `WB-Elo` | allenai/WildBench leaderboard data (Apache-2.0); last updated 2024. |
| `data/ocrbench_v2.json` | `OCRBench v2` / `English (average)`, `Chinese (average)` + per-skill versions | OCRBench v2 leaderboard Space CSVs (MIT). |
| `data/ruler.json` | `RULER` / `Average (4K-128K)` + per-length | results table in NVIDIA/RULER (Apache-2.0). |
| `data/swebench.json` | `SWE-bench` / `Verified (official)`, `Lite`, `Test`, `Multilingual`, `Multimodal` | swebench.com `leaderboards.json` (**CC BY-NC 4.0**); entries without a single model skipped. |
| `data/swebench_pro.json` | `SWE-bench Pro` / `Scale open-source runs` | resolve rate computed from the 9 runs in scaleapi/SWE-bench_Pro-os (MIT); runs cover different instance counts. |
| `data/matharena_aime.json` | `AIME` / `2025 (MathArena)`, `2026 (MathArena)` | accuracy per model config from MathArena's output datasets (**CC BY-NC-SA 4.0**); configs missing problems are excluded. |
| `data/mmlu_original.json` | `MMLU` / `Original leaderboard` | table in hendrycks/test (MIT); historical (to 2023). |
| `data/artificial_analysis.json` | `Artificial Analysis Intelligence Index v5` + six capability indices | no evaluation dates: `external_id` = `<AA id>@<score>`, so a new row appears only when a score changes. Model-level prices go to `model_pricing` dated by collection date (history kept; `effective_to` set automatically). Attribution required when shown. |

- `hle.json`, `mmlu_pro.json` and `gpqa.json` use a generic format, `"format": "benchmark-results/v1"`
  (source, benchmarks, flat results; see `importer/generic.py`), which any simple benchmark can reuse.
  Developers missing from a source are inferred from the model name and flagged `developer_inferred`.
- `accuracy` is filled only where the publisher reports its score as accuracy (share answered correctly):
  generic files mark those benchmarks with `"metric": "accuracy"` (HLE, MMLU-Pro, GPQA, Epoch AI,
  Terminal-Bench, MathArena, MMLU, SimpleQA/MMLU in simple-evals); BenchLM benchmarks whose `format`
  says "accuracy". Resolve rates, pass rates, Elo and index points leave it empty.
- Not imported for licensing reasons (no licensed results source): LiveCodeBench, MMMU-Pro, GAIA,
  MASK, HealthBench, FinanceBench, LegalBench, GSM8K, ARC-AGI (ARC Prize terms), FACTS (Kaggle),
  Artificial Analysis website data (only the official API is used).
- One transaction per file: a file is imported completely or not at all.
- Re-importing an unchanged file changes nothing (every write is an upsert that skips identical rows).
- Each source record is stored in `raw_data` (JSONB) and linked from its results.
- Models are matched across sources by `canonical_key`: words in any order, version numbers in
  order, effort and date stamps removed (so GPT-5, GPT-5.4 and GPT-5.5 stay separate): "Claude Fable 5.2 (xhigh)", "Claude Fable 5.2 Max Effort" and AA's "Claude Fable 5.2 (Max)"
  are one model with different `reasoning_effort` values.
- Results with scores outside 0–100 or negative cost/time are skipped and reported.
- `--replace` also removes models and benchmarks left without any results or prices.


Read-only API over the database (`api/`). The pool sets `default_transaction_read_only`,
so the API can never write.

```bash
.venv/bin/uvicorn api.main:app --reload --port 8010    # docs: http://localhost:8010/docs
```

Settings (env or `.env`): `DATABASE_URL`, `CORS_ORIGINS` (default `http://localhost:23533`
for the Next.js dashboard), `DB_POOL_MIN`/`DB_POOL_MAX`, `DB_STATEMENT_TIMEOUT_MS`.

| Endpoint | Purpose |
|---|---|
| `GET /health` | API + DB status (503 when the DB is down) |
| `GET /api/v1/overview` | totals, results per area, sources with last collection time |
| `GET /api/v1/sources` | data publishers |
| `GET /api/v1/benchmarks?area=&q=&source_id=` | benchmarks with result/model counts |
| `GET /api/v1/models?provider=&q=&benchmark_id=` | models (q also searches aliases) |
| `GET /api/v1/models/{id}` | model + current prices + best result on each benchmark |
| `GET /api/v1/models/{id}/pricing` | full price history |
| `GET /api/v1/results?...` | flat records (all spec fields), filters + sort + paging |
| `GET /api/v1/results/{id}` / `.../raw` | one record / the original payload it came from |
| `GET /api/v1/leaderboard/{benchmark_id}` | ranking; `pick=best\|latest`, `group_by=model\|model_effort`, filters |
| `GET /api/v1/compare?model_id=..&model_id=..` | 2–10 models side by side, with each model's rank per benchmark |
| `GET /api/v1/analysis/trends/{benchmark_id}` | state-of-the-art frontier over time + per-model history |
| `GET /api/v1/analysis/cost-performance/{benchmark_id}` | score vs. cost (`cost_per_task` or `blended_price`), Pareto points flagged |

Rules the analysis endpoints follow:
- Rankings only use results in the benchmark's own score unit (no mixing % with Elo/points).
- History uses `evaluation_date`, or the collection date when a result has none.
- Cost 0 is treated as "not reported" in cost-performance.

## Next.js dashboard

`dashboard/` (Next.js 16, App Router) is one page: a table of every benchmark result,
server-rendered from the API (`API_URL`, default `http://localhost:8010`).

```bash
cd dashboard
npm install
npm run dev        # http://localhost:23533 (the API must be running)
```

- **Search** model, developer or benchmark name (applies after a short pause while typing).
- **Filters** (multi-select dropdowns with search and checkboxes):
  - **Source / Benchmark**: benchmarks grouped by source; a source heading selects the whole
    source, single benchmarks can be added ("all of LiveBench + SWE-bench Verified").
  - **Developer / Model**: models grouped by developer, same behaviour.
  - **Area** and **Reasoning effort** ("other", "no reasoning" and "not stated" listed last).
  Within a group/item pair any choice matches; different filters must all match.
  Large groups (over 30) start collapsed; searching opens the groups with matches.
- **Sort** by clicking any column header; click again to reverse.
- **Paging** with 25/50/100/200 rows per page.
- All state is in the URL, so any view can be bookmarked or shared; the filter form also
  works without JavaScript.

API additions used by the page: `GET /api/v1/filters` (filter choices) and, on
`GET /api/v1/results`, repeatable `source_id`/`benchmark_id`/`area`/`provider`/`reasoning_effort`
parameters, `latest_only` plus more `sort` keys (`provider`, `benchmark`, `area`,
`reasoning_effort`, `tokens_per_sec`, `source_name`, `date`).

## Tests

```bash
.venv/bin/python -m pytest -q tests
```

`tests/test_api.py` rebuilds a separate `llm_bench_test` database from `db/init/*.sql`,
inserts a small fixed data set with SQL, and checks exact API output.
The real `llm_bench` database is never touched.
It is skipped when PostgreSQL is not running.

## Yugos models page (`/yugos-models`)

Every model the Yugos router may route to (the live world card), one row per model: price per 1M tokens, cheapest provider, parent/successor, release date, efforts, card expiry, a reference link, and a free-text note.

- **Data:** `data/yugos/models.json`, built from the Yugos research folder (no fetching):
  ```bash
  python3 -I scripts/build_yugos_models.py \
      /root/cic/sn34-yugos/research/llm-lineage/models.csv \
      /root/cic/sn34-yugos/research/data/world-card-2026-11-26.json
  ```
- **Notes and watch list:** saved by the dashboard in `data/yugos/user-state.json` (via `POST /api/yugos-models`). The watch list stores the models left *out*, so models added in a rebuild start out watched.
- **Selection = filter:** selected models have red names. "Show selected" (default) hides the rest; "Show all" shows everything. The choice is remembered per browser.
- **View and Group by:** two separate settings. View is Table or Tree; Group by (None / Vendor / Product line) works in both. In Tree view a family is grouped by its newest model.
- **Tree view:** each newest model (nothing names it as parent) at the top, its parents nested newest → oldest. A parent cheaper than that newest model (input or output) gets a green "cheaper · in −x% · out −y%" tag; the newest model at the top gets an amber "cheaper child" tag when any of its parents is cheaper.
- **Edit selection:** ticks per row, shift-click ranges, per-group ticks, "Only newest in each line", "Keep only shown rows" (narrow with filters, then keep), Undo, then Save.

## Router benchmarks page (`/router-benchmarks`)

Every known LLM-router benchmark and router-relevant data source (32), one row each: type (A stored router benchmark, B live arena / audit, C single-model per-question data, D agentic tau2 and effort), creators, scale, model pool, what is stored, whether it has the newest models (GPT-6 / Claude 5.x / Gemini 4 era), how useful it is for the Yugos router, the key finding and links. Click a row (or press Enter) to open the full write-up for that benchmark.

- **Data:** `data/router-benchmarks/benchmarks.json`, built from the router-benchmark research files (no fetching):
  ```bash
  python3 -I scripts/build_router_benchmarks.py /root/subnet_analysis/research
  ```
  It reads `router_benchmarks_complete_2026-11-26.md` (overview table), `router_benchmark_00_index_2026-11-26.md` (key findings) and `router_benchmark_NN_*_2026-11-26.md` (one write-up per benchmark). Re-run after the research changes.
- **Filters:** search (also searches the full write-ups), type, "For Yugos" (High / Medium / Low–Medium / Low / No) and "Newest models" (Yes / Partly / Unknown / No) chips. Sorting by #, name, type, newest models or usefulness.
- Code: `app/router-benchmarks/` (page + `router-benchmarks.css`, classes `rb-`), `components/RouterBenchmarksTable.tsx` (table + small markdown renderer), `lib/routerBenchmarks.ts` (reads the JSON).

## Movable and resizable columns (every table)

Drag a column header onto another to move it, or drag the grip on a header's right edge to resize it (double-click the grip to reset that width). Columns always fit the table's box and follow it when the window or the Benchmark list's details pane changes size: short columns (numbers, dates, icons) keep a fixed px width; text columns share the rest in proportion to their saved weights, and resizing one trades width with its neighbour. No column goes below its minimum; if the box is too narrow the table scrolls sideways. Each table's layout is saved on the server in `data/ui-layout.json` (`POST /api/ui-layout`), shared by everyone, and read by the page on load. **Reset columns** next to a table puts it back to the defaults.

- Shared code: `dashboard/lib/columnLayout.tsx` (hook), `dashboard/lib/uiLayout.ts` (storage), `dashboard/app/columns.css` (styles).
- Tables: Results (`components/ResultsTable.tsx`, id `results`), Benchmark list tree (`components/BenchmarkTree.tsx`, id `benchmark-list`), Yugos models (`components/YugosModelsTable.tsx`, id `yugos-models`), Router benchmarks (`components/RouterBenchmarksTable.tsx`, id `router-benchmarks`). The Benchmark list's Parameters matrix has no movable columns.

## Benchmark list filters

Under the toolbar: **Sub-benchmark category** (keeps sub-benchmarks whose own category is any of the chosen ones, shown open under their benchmark; benchmarks with none are hidden) and **Reports (all of)** (keeps benchmarks that report every chosen parameter, e.g. Cost + Time). "Shown on the site only" counts a parameter only when the benchmark's own page shows it, not just its data file or paper. Filters apply to the benchmark rows; a benchmark that passes keeps its sub-benchmarks. They work in both the Tree and Parameters views.

## Links keep the view (URL query)

Every page writes its view state into the address bar (in place, no reload or extra history entries), so a link or reload shows exactly the same thing. Defaults are left out.

- **Results** `/`: `q`, `source_id`, `benchmark_id`, `provider`, `model_id`, `area`, `reasoning_effort`, `sort`, `order`, `limit`, `page`.
- **Benchmark list** `/benchmarks`: `q`, `yugos=1`, `notes=1`, `cat` (repeatable), `param` (repeatable), `site=1`, `view=params`, and `expand=all` on load.
- **Yugos models** `/yugos-models`: `q`, `vendor`, `newest=1`, `noutil=1`, `notes=1`, `show=all`, `view=table`, `group=none|line`, `sort`, `dir=asc|desc`.
- **Router benchmarks** `/router-benchmarks`: `q`, `group=A|B|C|D`, `use` (repeatable), `new` (repeatable), `sort=name|group|newest|yugos`, `dir=desc`, `open=<#>`.

Shared helper: `dashboard/lib/urlState.ts` (`useQuerySync`, `qOne` / `qMany` / `qFlag`).

## Model IDs

Every model has one ID across benchmarks, the Yugos world card and this project: `vendor/name` (e.g. `anthropic/claude-opus-4.5`). How it was run is kept apart: effort, mode (`search`, `thinking`, `fp8`, …) and dated snapshot are fields on each result, not part of the ID. Rules: `importer/model_ids.py`. Decisions: `data/models/` (`overrides.csv` is the hand-edited one). Full description: [docs/model-ids.md](docs/model-ids.md). Latest per-benchmark match check: [docs/model-id-match-report.md](docs/model-id-match-report.md).

```bash
.venv/bin/python -I scripts/build_model_registry.py   # rebuild data/models/ after new data or rule changes
.venv/bin/python -I scripts/check_model_matches.py    # check every source's matches
```

## Benchmark details pages (`/benchmarks/<No>`)

A benchmark's name in the Benchmark list (tree and Parameters views) opens its details page:
- **Benchmark** (`/benchmarks/5`): every field from the list, its sub-benchmarks (each linked, with how many results the database has), and its overall table. Chips switch the table to any database benchmark of the same family (`?b=`).
- **Sub-benchmark** (`/benchmarks/5.1`): every field and its own results table.

Sort and page are in the URL. Both tables have movable and resizable columns. List rows link to database benchmarks through `data/benchmark-map.json`:

```bash
.venv/bin/python -I scripts/build_benchmark_map.py   # after the list or the data changes; report: docs/benchmark-map-report.md
```

- A sub-benchmark is linked only when every word of its name is in the database benchmark's name, and the database name has no other meaningful words.
- `data/benchmark-map-overrides.csv` holds the links made by hand, each with a reason.
- Sub-benchmarks the source publishes only inside another score have no table.

### Choosing which models a table shows

Like Artificial Analysis, each benchmark details page has a **"N of M models"** picker above its table.

**What's in it:**
- search, and filters for developer, effort level, reasoning and "In Yugos"
- the selected models first, then every model with its effort variants
- **Clear**, **Select all**, **Reset (to default)**, **Save** and **Load**

**How it behaves:**
- The selection applies to the page's tables and is kept in the URL: `?models=<model ID>~<effort>~<mode>,…`, or `all` / `none`.
- The default is the models selected on the Yugos models page that have results there, otherwise the 30 best.
- Saved selections are shared, in `data/model-selections.json`. API: `GET /api/v1/configs?benchmark_id=…` and `GET /api/v1/results?configs=…`.

## Effort levels: configurations

A model is run at different efforts. Each is a **configuration**: `model_configs` (model + effort + mode, key `<model ID>~<effort>~<mode>`). Every result points at one (`benchmark_results.config_id`).
- `effort_levels` orders efforts within a model: none 0, minimal 1, low 2, medium 3, high 4, xhigh 5, max 6. Ranks are not compared across vendors.
- No stated effort is the **Default** configuration. "enabled" means reasoning on, level not stated, and has no rank.
- `yugos_offers` holds every Yugos world-card listing for each effort it accepts. Load it with `.venv/bin/python -I scripts/import_yugos_offers.py`.
- Views: `v_model_configs`. API: `GET /api/v1/model-configs?model_key=…`.

## Trade-off chart (benchmark details pages)

Like Artificial Analysis: every configuration is a point, and the efforts of one model are joined low → max.
- **Y axis** defaults to quality. **X axis** defaults to price per task; when a benchmark has none, the first available of time per task, time to first token, output tokens, output price per 1M tokens (current price when the result is older), speed, then date.
- Both axes and log scale are selectable and kept in the URL (`?x=`, `?y=`, `?logx=`, `?logy=`).
- A filled dot means Yugos can route that configuration; a hollow dot means it can't.
- The chart follows the page's model selection. API: `GET /api/v1/chart-points`.
- **Colours:** by developer by default, like Artificial Analysis. Each lab keeps a fixed colour; Google, Anthropic and OpenAI get the three colours every reader can tell apart, and developers outside the 8 colour slots are grey "Other". Other "Colour by" options: Yugos availability, effort level (one-hue ladder), one colour (`?color=`).
- **Colour key** above the chart: hover an entry to highlight it, click to grey it out (`?grey=`).
- **Full screen** (⛶): wheel or pinch zooms around the pointer, drag pans, Shift+wheel scrolls sideways, double-click or "Reset view" fits everything, Esc leaves. Zooming recalculates axes and labels.
- **Custom developer colours:** click a developer's colour dot in the key to pick a colour; "+ Add colour for…" gives a developer from "Other" its own colour and key entry; ↺ restores one developer's default, "Reset colours" restores all. Saved on the server (`data/chart-colors.json`, `POST /api/chart-colors`), so every page and visitor gets them.
