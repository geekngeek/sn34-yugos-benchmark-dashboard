# Yugos match: which public data can stand in for Yugos's questions

_Built 2026-11-27. Data: `data/yugos-match/`. Build: `python3 -I scripts/build_yugos_match.py levels|batches|build`._

Yugos (Bittensor SN34) asks 1,922 questions per run: 45% from 10 public datasets, 55% hidden. To train a router we
need many more questions that **behave like Yugos's**. Every sub-benchmark in the Benchmark list (307) and every
dataset on the Datasets tab gets **three match scores**, one per Yugos category: chat & QA, math & code, agentic.

## The score

**match = task fit × weighted mean of six factors**

| Factor | Weight | What is compared |
|---|---|---|
| Task fit | × (gate) | Does it ask for the same skill? Required images, audio or video → near 0 (Yugos sends text only). |
| Turns | 15% | One prompt, tool schemas, or a multi-turn conversation with tools. |
| Answer | 15% | Answer format and grading: letter, short answer, judge, F1, unit tests, end state. |
| Domain | 15% | Topics, libraries or tool domains compared with the category's mix. |
| Difficulty | 15% | Level mix (L1–L5) compared with the Yugos part it stands in for (computed, see below). |
| Fresh | 10% | Release date and memorization risk. **Not overlap** (see below). |
| Length | 5% | Prompt length compared with the category's typical prompts. |

Task fit multiplies because a set that asks for a different skill teaches the router the wrong mapping, however well
the rest fits.

Each category has two parts: the **public** part (the datasets we know) and the **private** part (hidden; we know
only its scores). The score is computed against both and the better one is shown ("stands in for the private part").

## Difficulty fit (computed, not judged)

- A level mix is the share of questions at levels L1–L5 (the same levels as the Benchmark list).
- From published scores: **share of questions at level ≤ L ≈ the score of the level-L model group** (guessing floor
  removed). Groups: 1 small/old (GPT-3.5, Llama 3/3.1 8B, Mistral 7B, Gemma 2 9B) · 2 2024 flagships (GPT-4o,
  Claude 3.5 Sonnet, GPT-4 Turbo, Llama 3.1 405B) · 3 late-2025 frontier (GPT-5, Claude Opus 4.5, Gemini 3 Pro) ·
  4 Nov-2026 frontier (GPT-6.x, Claude Fable/Opus 5.x, Gemini 4).
- Sub-benchmarks use their results in our database (`data/benchmark-map.json`). Groups without scores take the
  default mix of the row's team difficulty level (`DEFAULT_CDF` in the script, calibrated on rows that have both).
- Datasets use the Benchmark list row with the same questions, else published group scores found by the research
  (each with its source URL, shown in the details), else a stated estimate.
- Yugos's own mixes come from `research/yugos-dataset-levels.json` (IRT fit over 135 live runs).
- Difficulty fit = 1 − the share of questions that would have to change level (total variation distance), in the
  category's buckets: chat L1–2 / L3 / L4–5; math & code L1–2 / L3 / L4 / L5; agentic L1–3 / L4 / L5.
- No difficulty evidence → 0.5 (neutral), shown as "n/a".

## Overlap with live Yugos sets

Some candidates contain the very questions Yugos asks (MMLU-Pro, HLE, SimpleQA Verified, MATH-500, …). Those match
perfectly, so overlap is **not** subtracted from the score; it is a flag (◆ in the tables, a yellow note in the
details, and the "No live-set overlap" filter). Using such data: drop the overlapping questions or at least never
test on them, since the router would have seen the answers.

## How the factor scores were made

- 11 research agents scored the 307 sub-benchmarks and 11 scored ~160 datasets, all with the same rubric
  (`data/yugos-match/RUBRIC.md`, with 6 calibration examples).
- They opened the official pages, cards and papers, and recorded facts only when seen:
  - can the questions be downloaded,
  - how many are there,
  - are per-model, per-question results public,
  - licence,
  - sources.
- Their raw outputs: `data/yugos-match/assess/out-*.json`.
- Hand corrections: `data/yugos-match/overrides.csv`, each with a reason, listed under "Adjusted by hand" in the
  details. So far these set freshness to age only on rows that overlap a live set, and correct one fact (arxivmath has
  287 questions across the 8 months Yugos pins). Datasets that overlap a live set get freshness from their release year
  in the build, with the same note.

## Limits

- **The private parts are guesses.** For example, the private agentic set being multi-step tool use is guess G3 in
  the step-1 explainer. A candidate's private-part match is only as good as that guess.
- **Factor scores are reasoned judgments.** They are not measurements. Use the score to rank, not as a probability
  to trust to the decimal.
- **Sub-benchmarks with no question data** (leaderboards with hidden test sets) can match well but cannot supply
  training questions. Check "Questions downloadable".
