# Sub-benchmarks: data and difficulty (2026-11-27)

The team asked to fetch as much data as possible for the sub-benchmarks without results, and to give them difficulty levels.
Five research agents checked each one's official sources (page, data file, paper) and their licence or terms; numbers were only copied, never guessed.

## Result

| | Sub-benchmarks |
|---|---|
| Had results before | 101 of 307 |
| Linked to data already in the database (under another name) | 43 |
| New data fetched (15 files, see README) | 92 |
| Split out of data we already had (SWE-bench Bash Only, 4 MMLU groups) | 5 |
| **Have results now** | **241 of 307** |
| Still without data (below, with the reason) | 66 |

## Still without data, and why

### Terms do not allow reuse (38)

| No | Sub-benchmark | Detail |
|---|---|---|
| 2.6 | Terminal-Bench 4.1 | published only on the artificialanalysis.ai website (API does not include it): the AA API has this field (terminalbench_v4_1) only on the Pro tier; our key is free tier (GET /api/v2/language/models -> 403 'requires a Pro subscription'). The official tbench.ai 4.1 board is already in the DB (source 'Terminal-Bench', version 4.1) but is a different setting (agent+model submissions; earlier research: only 2-3 of 41 values match AA), so not linked. |
| 2.7 | Terminal-Bench-Science 0.1 | published only on the artificialanalysis.ai website (API does not include it): the AA API has this field (terminalbench_science) only on the Pro tier; our key is free tier (GET /api/v2/language/models -> 403 'requires a Pro subscription'). BenchLM 'Terminal-Bench-Science 0.1' is the official terminal-bench-science.ai board, different runs (0-1 of 12 values match AA). |
| 2.21 | Artificial Analysis Coding Agent Index v2.1 | published only on the artificialanalysis.ai website (API does not include it): GET /api/v2/language/agents/coding is Pro-only (403 for our key). BenchLM 'AA Coding Agents' has 0 scores. |
| 2.22 | Artificial Analysis Search Index | published only on the artificialanalysis.ai website (API does not include it): no API endpoint for the Search API index at any tier (OpenAPI spec checked). |
| 2.24 | AA-Paperclip | published only on the artificialanalysis.ai website (API does not include it): only inside GET /api/v2/language/decision, which is Pro-only (403 for our key). |
| 2.25 | EvalSafe-O*NET-AA | published only on the artificialanalysis.ai website (API does not include it): only inside GET /api/v2/language/decision, which is Pro-only (403 for our key). |
| 2.26 | AA-Omniscience-Decision v1.1 | published only on the artificialanalysis.ai website (API does not include it): only inside the Pro-only Decision endpoint (403). DB rows 'AA-Omniscience-Decision accuracy / non-hallucination rate' are Decision Index v1.0 metrics, not the v1.1 Decision Score. |
| 2.27 | HLE-MultiChoice v1.1 | published only on the artificialanalysis.ai website (API does not include it): only inside the Pro-only Decision endpoint (403). DB row 'HLE-MultiChoice (Decision Index)' is v1.0 accuracy on 513 questions, not v1.1 (509 questions, Decision Score). |
| 2.28 | AA-Symmetry v1.1 | published only on the artificialanalysis.ai website (API does not include it): only inside the Pro-only Decision endpoint (403); nothing comparable in the DB. |
| 2.29 | When2Call | published only on the artificialanalysis.ai website (API does not include it): AA's Decision Score run is only inside the Pro-only Decision endpoint (403). DB 'When2Call (Decision Index)' is Decision Index v1.0 accuracy (different metric); NVIDIA's own When2Call results use a different scoring, so not the same setting. |
| 2.30 | Artificial Analysis Progress Index v1 | published only on the artificialanalysis.ai website (API does not include it): no field in the API at any tier (OpenAPI spec checked). |
| 2.32 | AA-3D | published only on the artificialanalysis.ai website (API does not include it): no field in the API at any tier (OpenAPI spec checked); nothing in the DB. |
| 2.37 | AA-PersonalityBench | published only on the artificialanalysis.ai website (API does not include it): no field in the API at any tier (OpenAPI spec checked); BenchLM 'AA-PersonalityBench' has 0 scores. |
| 2.43 | Code2Video-AA | published only on the artificialanalysis.ai website (API does not include it): no field in the API at any tier. BenchLM 'Code2Video' is HeyGen's own board (0 of 11 values match AA's Elo), so not the same setting. |
| 2.45 | VIALS-AA | published only on the artificialanalysis.ai website (API does not include it): the AA API has this field (vials_aa) only on the Pro tier; our key is free tier (GET /api/v2/language/models -> 403 'requires a Pro subscription'). Handshake AI's own VIALS results would be a different run/setting; nothing in the DB. |
| 2.47 | FrontierPhysics | published only on the artificialanalysis.ai website (API does not include it): no field in the API at any tier. BenchLM 'FrontierPhysics' is BenchFlow's own results (arXiv 2611.06910), 0 of 17 values match AA's implementation, so not the same setting. |
| 2.48 | GDPval-AA v2.1 | published only on the artificialanalysis.ai website (API does not include it): the AA API has this field (gdpval_aa_elo / gdpval_aa_normalized) only on the Pro tier; our key is free tier (GET /api/v2/language/models -> 403 'requires a Pro subscription'). DB has BenchLM 'GDPval-AA' (version 'Artificial Analysis', normalized 0-100, 132 results) but its index version could not be verified as v2.1, and BenchLM 'GDPval-AA' (version 'gdpvalAa', Elo) mixes model-maker reports (9 of 86 match AA). OpenAI's own GDPval is a different grading setup. |
| 2.52 | FrontierCode 1.1 | published only on the artificialanalysis.ai website (API does not include it): the AA API has this field (frontiercode_v1_1) only on the Pro tier; our key is free tier (GET /api/v2/language/models -> 403 'requires a Pro subscription'). BenchLM 'FrontierCode 1.1 Main/Extended' are Cognition's own results (0 of 4 match AA's implementation). |
| 2.58 | τ²-Bench Telecom | published only on the artificialanalysis.ai website (API does not include it): the AA API has this field (tau2_telecom) only on the Pro tier; our key is free tier (GET /api/v2/language/models -> 403 'requires a Pro subscription'). DB 'τ²-bench' Telecom (Sierra) mixes tau2-bench versions 0.1.3 and 1.0.1 and different submitters/setups; BenchLM 'τ²-bench results' is a mixed ledger (34 of 49 match AA). Not the same setting. |
| 11.7 | SWE-Bench Pro (Public) | labs.scale.com leaderboard is Scale AI's website with no open license for its data; the team already excluded Scale's live leaderboards (see notes in data/swebench_pro.json: 'its site terms don't cover reuse'). Earlier decision: MASK not in the DB from Scale. |
| 11.8 | SWE-Bench Pro (Private / commercial) | labs.scale.com leaderboard is Scale AI's website with no open license for its data; the team already excluded Scale's live leaderboards (see notes in data/swebench_pro.json: 'its site terms don't cover reuse'). Earlier decision: MASK not in the DB from Scale. |
| 15.1 | Test set (Average score) | the scores come from the HF dataset gaia-benchmark/results_public, which declares no license (cardData has no license field); the Apache-2.0 tag belongs to the leaderboard Space's code, and the GAIA question set itself is gated with a no-reshare agreement. Matches the team decision 'GAIA only via BenchLM'. |
| 15.2 | Level 1 | the scores come from the HF dataset gaia-benchmark/results_public, which declares no license (cardData has no license field); the Apache-2.0 tag belongs to the leaderboard Space's code, and the GAIA question set itself is gated with a no-reshare agreement. Matches the team decision 'GAIA only via BenchLM'. |
| 15.3 | Level 2 | the scores come from the HF dataset gaia-benchmark/results_public, which declares no license (cardData has no license field); the Apache-2.0 tag belongs to the leaderboard Space's code, and the GAIA question set itself is gated with a no-reshare agreement. Matches the team decision 'GAIA only via BenchLM'. |
| 15.4 | Level 3 | the scores come from the HF dataset gaia-benchmark/results_public, which declares no license (cardData has no license field); the Apache-2.0 tag belongs to the leaderboard Space's code, and the GAIA question set itself is gated with a no-reshare agreement. Matches the team decision 'GAIA only via BenchLM'. |
| 15.5 | Validation set (public dev set) | the scores come from the HF dataset gaia-benchmark/results_public, which declares no license (cardData has no license field); the Apache-2.0 tag belongs to the leaderboard Space's code, and the GAIA question set itself is gated with a no-reshare agreement. Matches the team decision 'GAIA only via BenchLM'. |
| 19.2 | MMMU-Pro Vision | the leaderboard numbers live only in https://mmmu-benchmark.github.io/leaderboard_data.json, whose repo (github.com/MMMU-Benchmark/mmmu-benchmark.github.io) has no license (GitHub API license = null); the Apache-2.0 HF dataset MMMU/MMMU_Pro covers the questions, not the scores. Matches the team decision 'MMMU-Pro only via BenchLM'. (Paper tables in arXiv:2409.02813 / 2311.16502 are a possible later option; not fetched.) |
| 19.3 | MMMU-Pro Standard (10 options) | the leaderboard numbers live only in https://mmmu-benchmark.github.io/leaderboard_data.json, whose repo (github.com/MMMU-Benchmark/mmmu-benchmark.github.io) has no license (GitHub API license = null); the Apache-2.0 HF dataset MMMU/MMMU_Pro covers the questions, not the scores. Matches the team decision 'MMMU-Pro only via BenchLM'. (Paper tables in arXiv:2409.02813 / 2311.16502 are a possible later option; not fetched.) |
| 19.5 | MMMU (Test) | the leaderboard numbers live only in https://mmmu-benchmark.github.io/leaderboard_data.json, whose repo (github.com/MMMU-Benchmark/mmmu-benchmark.github.io) has no license (GitHub API license = null); the Apache-2.0 HF dataset MMMU/MMMU_Pro covers the questions, not the scores. Matches the team decision 'MMMU-Pro only via BenchLM'. (Paper tables in arXiv:2409.02813 / 2311.16502 are a possible later option; not fetched.) |
| 21.12 | OpenAI-MRCR 2-needle | the only published per-model numbers (2-needle at 128k and 1M, 8 and 3 OpenAI models) are in OpenAI's GPT-4.1 blog post on openai.com, whose Terms of Use (openai.com/policies/terms-of-use, covering its websites) forbid 'automatically or programmatically extracting data'. The dataset card (huggingface.co/datasets/openai/mrcr, MIT) publishes no results and no leaderboard exists. |
| 22.1 | Honesty Score | labs.scale.com leaderboard is Scale AI's website with no open license for its data; the team already excluded Scale's live leaderboards (see notes in data/swebench_pro.json: 'its site terms don't cover reuse'). Earlier decision: MASK not in the DB from Scale. (The paper's Table 3 has P(lie) on the 1,500 public examples - a different split from the leaderboard's 500 private; it is kept in extra of the MASK Accuracy file.) |
| 23.4 | Emergency referrals | the only per-model theme numbers are in the chart data embedded in openai.com/index/healthbench (OpenAI Terms of Use forbid programmatically extracting data from its websites); the CC BY paper (arXiv 2505.08775, Figure 5) shows theme scores as bars without numeric labels, and Table 8 only gives per-criterion consensus scores, not theme totals. |
| 23.5 | Responding under uncertainty | the only per-model theme numbers are in the chart data embedded in openai.com/index/healthbench (OpenAI Terms of Use forbid programmatically extracting data from its websites); the CC BY paper (arXiv 2505.08775, Figure 5) shows theme scores as bars without numeric labels, and Table 8 only gives per-criterion consensus scores, not theme totals. |
| 23.6 | Health data tasks | the only per-model theme numbers are in the chart data embedded in openai.com/index/healthbench (OpenAI Terms of Use forbid programmatically extracting data from its websites); the CC BY paper (arXiv 2505.08775, Figure 5) shows theme scores as bars without numeric labels, and Table 8 only gives per-criterion consensus scores, not theme totals. |
| 23.7 | Global health | the only per-model theme numbers are in the chart data embedded in openai.com/index/healthbench (OpenAI Terms of Use forbid programmatically extracting data from its websites); the CC BY paper (arXiv 2505.08775, Figure 5) shows theme scores as bars without numeric labels, and Table 8 only gives per-criterion consensus scores, not theme totals. |
| 23.8 | Expertise-tailored communication | the only per-model theme numbers are in the chart data embedded in openai.com/index/healthbench (OpenAI Terms of Use forbid programmatically extracting data from its websites); the CC BY paper (arXiv 2505.08775, Figure 5) shows theme scores as bars without numeric labels, and Table 8 only gives per-criterion consensus scores, not theme totals. |
| 23.9 | Context seeking | the only per-model theme numbers are in the chart data embedded in openai.com/index/healthbench (OpenAI Terms of Use forbid programmatically extracting data from its websites); the CC BY paper (arXiv 2505.08775, Figure 5) shows theme scores as bars without numeric labels, and Table 8 only gives per-criterion consensus scores, not theme totals. |
| 23.10 | Response depth | the only per-model theme numbers are in the chart data embedded in openai.com/index/healthbench (OpenAI Terms of Use forbid programmatically extracting data from its websites); the CC BY paper (arXiv 2505.08775, Figure 5) shows theme scores as bars without numeric labels, and Table 8 only gives per-criterion consensus scores, not theme totals. |

### No per-model scores published (17)

| No | Sub-benchmark | Detail |
|---|---|---|
| 4.3 | HLE-Rolling | the HF dataset card (cais/hle-rolling, gated) has no results, lastexam.ai only links the dataset/change log and its model data has only hle and hle_diamond fields; Scale SEAL pages only announce it. |
| 6.4 | Biology | the GPQA paper gives a single per-domain figure in prose (GPT-4 few-shot CoT, biology 58.1%, subset not named); no table, no other models. |
| 6.5 | Physics | the GPQA paper gives a single per-domain figure in prose (GPT-4 few-shot CoT, physics 37.0%, subset not named); no table, no other models. |
| 6.6 | Chemistry | the GPQA paper gives a single per-domain figure in prose (GPT-4 few-shot CoT, chemistry 31.8%, subset not named); no table, no other models. |
| 14.6 | Terminal-Bench 1.0 | the current tbench.ai leaderboard has no 1.0 board and the Apache-2.0 repo harbor-framework/terminal-bench-1 contains no results. The only remaining numbers are a web.archive.org copy (a mirror, not allowed) and an unused legacy data.ts in harbor-framework/terminal-bench-website, a repo with no license. |
| 14.8 | Terminal-Bench Challenges | repo with 3 challenge tasks and their verification metrics, no results or leaderboard. |
| 21.13 | OpenAI-MRCR 4-needle | 4-needle results appear only as a chart (no numbers as text) in OpenAI's GPT-4.1 post; the dataset card has no results. (openai.com's terms would also forbid automated extraction.) |
| 21.14 | OpenAI-MRCR 8-needle | 8-needle results for this dataset version appear only as a chart in OpenAI's GPT-4.1 post; later OpenAI posts report MRCR v2 8-needle per context bin (a different data version). Dataset card has no results; openai.com terms forbid automated extraction. |
| 22.3 | Known Facts | archetype is only a config of the cais/MASK dataset (prompts/ground truth); Scale's leaderboard shows only the overall Honesty Score and the paper (arXiv:2503.03750) gives archetype results only aggregated across models (Fig. 8, Fig. 13). |
| 22.4 | Situation-Provided Facts | archetype is only a config of the cais/MASK dataset (prompts/ground truth); Scale's leaderboard shows only the overall Honesty Score and the paper (arXiv:2503.03750) gives archetype results only aggregated across models (Fig. 8, Fig. 13). |
| 22.5 | Doubling Down | archetype is only a config of the cais/MASK dataset (prompts/ground truth); Scale's leaderboard shows only the overall Honesty Score and the paper (arXiv:2503.03750) gives archetype results only aggregated across models (Fig. 8, Fig. 13). |
| 22.6 | Fabricated Statistics | archetype is only a config of the cais/MASK dataset (prompts/ground truth); Scale's leaderboard shows only the overall Honesty Score and the paper (arXiv:2503.03750) gives archetype results only aggregated across models (Fig. 8, Fig. 13). |
| 22.7 | Continuations | archetype is only a config of the cais/MASK dataset (prompts/ground truth); Scale's leaderboard shows only the overall Honesty Score and the paper (arXiv:2503.03750) gives archetype results only aggregated across models (Fig. 8, Fig. 13). |
| 22.8 | Disinformation Generation | archetype is only a config of the cais/MASK dataset (prompts/ground truth); Scale's leaderboard shows only the overall Honesty Score and the paper (arXiv:2503.03750) gives archetype results only aggregated across models (Fig. 8, Fig. 13). |
| 24.1 | Domain-relevant questions | per-question-type results exist only as a chart (FinanceBench paper arXiv:2311.11944, Figure 4) with no numbers; computing them from per-question labels in the repo would be our own calculation (and the repo has no license; the paper is CC BY-NC-ND). |
| 24.2 | Novel-generated questions | per-question-type results exist only as a chart (FinanceBench paper arXiv:2311.11944, Figure 4) with no numbers; computing them from per-question labels in the repo would be our own calculation (and the repo has no license; the paper is CC BY-NC-ND). |
| 24.3 | Metrics-generated questions | per-question-type results exist only as a chart (FinanceBench paper arXiv:2311.11944, Figure 4) with no numbers; computing them from per-question labels in the repo would be our own calculation (and the repo has no license; the paper is CC BY-NC-ND). |

### Not a scored benchmark (7)

| No | Sub-benchmark | Detail |
|---|---|---|
| 9.6 | FrontierMath: Open Problems | the page lists open math problems and whether they were solved (with prose attributions); no per-model scores. |
| 12.6 | Release versions (release_v1 ... release_v6, release_latest) | dataset slices (problem counts and date ranges) described in the GitHub README; no per-version results table. The two scored releases are covered as 12.1 (v6) and 12.5 (v5). |
| 16.3 | τ²-bench — Overall | composite of other benchmarks already in the DB - Leaderboard.jsx computes Overall in the browser as the unweighted mean of the Retail/Airline/Telecom pass^1 values (only when all three exist); those per-domain results are already in the DB as τ²-bench Retail/Airline/Telecom (tau2-bench (Sierra)). No Overall value is stored in the submission files. |
| 16.14 | τ³-Voice — English edition | composite of other benchmarks already in the DB - the English voice board is the voice_submissions set whose per-domain pass^1 values are already in the DB as τ²-bench Airline/Retail/Telecom/Banking_Knowledge (voice) (tau2-bench (Sierra)); its Overall is computed in Leaderboard.jsx as the mean of retail, airline and telecom and is not stored. |
| 27.2 | GSM8K (main) — train split | training data; no scores are reported on it. |
| 27.3 | GSM8K Socratic (train_socratic / test_socratic) | alternative solution format of the same questions; README says it was not used in any experiment, no scores. |
| 27.4 | Example model solutions (6B/175B finetuning & verification) | raw example outputs from 4 paper settings, no scores. |

### Could not verify (4)

| No | Sub-benchmark | Detail |
|---|---|---|
| 7.3 | FACTS Benchmark Suite (average) | tried a plain HTTP GET of Kaggle's leaderboard JSON (https://www.kaggle.com/api/v1/benchmarks/google/facts/leaderboard) -> HTTP 404; WebFetch returns only a model-written summary of a truncated response, so exact numbers for every row could not be copied. Kaggle's Terms of Use page (https://www.kaggle.com/terms) is JS-rendered and its text could not be read, so reuse permission was not confirmed either. (An alternative is the FACTS paper table on arXiv, but that is an older snapshot, not the live board.) |
| 7.4 | FACTS Grounding | tried a plain HTTP GET of Kaggle's leaderboard JSON (https://www.kaggle.com/api/v1/benchmarks/google/facts-grounding/leaderboard) -> HTTP 404; WebFetch returns only a model-written summary of a truncated response, so exact numbers for every row could not be copied. Kaggle's Terms of Use page (https://www.kaggle.com/terms) is JS-rendered and its text could not be read, so reuse permission was not confirmed either. (An alternative is the FACTS paper table on arXiv, but that is an older snapshot, not the live board.) |
| 7.5 | FACTS Parametric | tried a plain HTTP GET of Kaggle's leaderboard JSON (https://www.kaggle.com/api/v1/benchmarks/google/facts-parametric/leaderboard) -> HTTP 404; WebFetch returns only a model-written summary of a truncated response, so exact numbers for every row could not be copied. Kaggle's Terms of Use page (https://www.kaggle.com/terms) is JS-rendered and its text could not be read, so reuse permission was not confirmed either. (An alternative is the FACTS paper table on arXiv, but that is an older snapshot, not the live board.) |
| 7.6 | FACTS Search V2 | tried a plain HTTP GET of Kaggle's leaderboard JSON (https://www.kaggle.com/api/v1/benchmarks/google/facts-search/leaderboard) -> HTTP 404; WebFetch returns only a model-written summary of a truncated response, so exact numbers for every row could not be copied. Kaggle's Terms of Use page (https://www.kaggle.com/terms) is JS-rendered and its text could not be read, so reuse permission was not confirmed either. (An alternative is the FACTS paper table on arXiv, but that is an older snapshot, not the live board.) |

## Difficulty

Levels use the same method as `docs/difficulty-levels.md` (2PL IRT fit over all published scores, anchored to model generations, 200 bootstrap refits).
The fit was rerun with all new data added. **No existing level moved (0 of 422 benchmarks).**

- **14 had no level** ("Not placed"). With the new data the fit was retried for the 11 of them that now have scores. None could be placed honestly:
  - 4.7, 6.2, 6.3, 16.8, 16.12, 16.13, 16.15, 25.3: too few models (3–8, of which 2–5 have scores elsewhere); the scale needs at least 6 connected models.
  - 16.9–16.11 (τ³-Voice Retail/Airline/Telecom): the fit returned levels, but their 18 models are voice models scored only on voice boards, not connected to the text models that define the levels, so those levels would be arbitrary and were not used.
  - 16.3, 19.2, 19.5: no data (see above).
  The reason is now written in each row's Difficulty detail.
- **87 are "n/a"** for structural reasons that more data does not change: Elo/vote ratings (LMArena, WB-Elo, AA Elo boards), composite indexes (AA indexes, BenchLM overall/categories), not a capability (Openness, MASK honesty/accuracy), or splits nobody scores.

## Please review

- **Licences to confirm:** LiveBench sub-category files and the WildBench Hugging Face Space state no licence of their own (the projects' repos are Apache-2.0; no terms forbid reuse; our existing LiveBench import has the same basis).
- **Computed, not copied:** LiveCodeBench release_v6/v5 scores are calculated from the official per-problem files exactly as the leaderboard page does (its time window, averaging, rounding).
- **HealthBench overall** values come from the labels printed on the paper's Figure 5 (plus Table 7 for 5 models).
- **Artificial Analysis:** our API key is free tier; per-evaluation scores are Pro-only, and the website's terms forbid scraping. A Pro key would fill most of the 19 AA failures.
- **`data/artificial-analysis/`** holds data collected from AA's website (declined earlier, never imported). It may be worth deleting.
- **Kaggle FACTS (7.3–7.6):** Kaggle's leaderboard API did not answer a plain request; a browser-like retry was not attempted.
- **Thin links:** a few AA sub-benchmarks link to BenchLM rows with very few results (Decision Index 1, CritPt v2 Hard 1, FrontierCode 2.0 3).
