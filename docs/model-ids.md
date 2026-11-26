# Model IDs

One identity per model across the benchmark sources, the Yugos world card and this project.

## Three things, never mixed

| Layer | What it is | Written as | Example |
|---|---|---|---|
| **Model** | the model as its vendor ships it, wherever it is hosted | `vendor/name` | `anthropic/claude-opus-4.5` |
| **Config** | the model and how it was run: what a benchmark scores | model + effort + mode (+ snapshot) | `anthropic/claude-opus-4.5` · `high` · `thinking` |
| **Offer** | where it is bought and what it costs | provider + that provider's id | `openrouter:anthropic/claude-opus-4.5` |

A benchmark result stores the **model ID** (`models.canonical_key`) plus `reasoning_effort`, `mode`, `model_snapshot`, and the source's own name (`raw_model_name`). A Yugos model maps to a model ID through `data/models/yugos-links.csv`, and several Yugos offers can map to one model (`gpt-4o-2024-08-06` → `openai/gpt-4o`).

## How a source's name is read (`importer/model_ids.py`)

| Part of the name | Becomes | Examples |
|---|---|---|
| effort level | **effort**: `none` `minimal` `low` `medium` `high` `xhigh` `max` | `(xhigh)`, `High Effort`, `(High, Default Fallback)` |
| thinking / reasoning, no level | **effort `enabled`** | `Thinking`, `(Think)`, `(Reasoning)`, `Reasoner` |
| thinking switched off | **effort `none`** | `(Non-Thinking)`, `(no think)`, `NonThinking`, DeepSeek `(Chat)` |
| thinking **and** a level | effort = the level, **mode `thinking`** | `Thinking High Effort` (LiveBench lists it apart from `High Effort`) |
| thinking budget | effort `enabled`, **mode `thinking-32k`** | `(32k think)`, `(32k thinking tokens)` |
| run setting | **mode** | `(Search)`, `(Grounding)` → `search`; `(Codex Harness)` → `codex-harness`; `+ tool-mentor` |
| precision | **mode** | `FP8`, `(BF16)`, `NVFP4` |
| a date | **snapshot** (not part of the ID) | `-20241022`, `-2024-08-06`, `(Nov 2024)`, `(08-2024)` |
| a vendor version tag | **part of the name** | `2507`, `0324`, `(0125)`, `2411` |
| a size the name already has | note only | `Mixtral-8x22B (39B/141B)`, `(hosted 35B-A3B)` |
| two models together | a **system**: `system/…` | `DeepSeek R1 + claude-3-5-sonnet`, `GPT-4o & Claude 3 Opus` |

**Thinking is a setting, not a name**, except for models the vendor released as their own thinking model: Qwen3 `2507` / Next / VL / Omni / Max-Thinking, Kimi K2 Thinking, Seed Thinking, Olmo Think, Gemini 2.0 Flash Thinking, Sonar Reasoning, Phi-4-reasoning and the others in `SEPARATE_THINKING`. That list is explicit on purpose.

## When two names are the same model

**Same model** when the base names share the strict key: the same words in any order, the same numbers in order, with these ignored:
- dates
- a trailing `.0`
- a leading vendor word: `NVIDIA-Nemotron` = `Nemotron`, `Meta-Llama-3` = `Llama 3`, `Amazon Nova` = `Nova`
- a `v` before a number: `v1` = `1`, `DeepSeek-V3` = `DeepSeek 3`; but `GPT-4V` keeps its V

These also count as the same word:
- `exp` and `experimental`
- `+` and `plus`, so `Command R+` = `Command R Plus` ≠ `Command R`

Names that differ only by separators (`HunyuanTurboS` / `Hunyuan TurboS`) are joined and listed in `data/models/joined-by-spelling.csv`.

**Never merged automatically:** names that differ only by packaging words (`Instruct`, `-it`, `Chat`). Base and instruct can be different weights. These pairs are listed for review.

## Files (`data/models/`)

| File | Made by | What |
|---|---|---|
| `registry.csv` | build script | one row per model ID: vendor, display name, Yugos link, keys, sources, every name it was seen as |
| `aliases.csv` | build script | every (source, raw name) → model ID, effort, mode, snapshot, and how it matched |
| `yugos-links.csv` | build script | every Yugos model → model ID and link type (exact / loose / same-model / override / none) |
| `overrides.csv` | **people** | decisions the rules cannot make, each with a reason (e.g. Mistral Small 3.1 = `2503`); effort `-` clears effort |
| `joined-by-spelling.csv` | build script | groups joined because only separators differed |

## Workflow

```bash
.venv/bin/python -I scripts/build_model_registry.py          # after new data, rules or overrides
.venv/bin/python -m importer data/<file>.json --replace       # re-import (names resolve through aliases.csv)
.venv/bin/python -I scripts/check_model_matches.py            # writes docs/model-id-match-report.md
```

The importer resolves every name through `aliases.csv`. A name that isn't there yet is resolved by the same rules and reported as "unlisted" in the import summary; rebuilding the registry lists it.

`check_model_matches.py` checks every source and benchmark for:
- names missing from the alias table
- round-trip mismatches
- different names collapsed into one config on one benchmark
- the review list

With `--old-db <database>` (restored from a backup) it also compares every result with an older matching.
