# Benchmark difficulty levels (L1–L5)

_Generated 2026-11-26 from published scores only — no models were run. Levels are a basic orientation, not a measurement of any single model._

## What the levels mean

Each level is defined by which generation of models solves about half of a benchmark (after removing the score a random guesser would get):

| Level | Name | Meaning |
|---|---|---|
| ★☆☆☆☆ L1 | Basic | even small/older models (GPT-3.5, Llama-3-8B, Mistral 7B, Gemma 2 9B) solve about half |
| ★★☆☆☆ L2 | Standard | 2024 flagships (GPT-4o, Claude 3.5 Sonnet, GPT-4 Turbo, Llama 3.1 405B) solve about half; small models don't |
| ★★★☆☆ L3 | Advanced | late-2025 frontier (GPT-5 high, Claude 4.5 Opus high, Gemini 3 Pro) solves about half; 2024 flagships don't |
| ★★★★☆ L4 | Expert | only the Nov-2026 frontier (the 10 strongest models in the data) solves about half |
| ★★★★★ L5 | Unsolved | even the Nov-2026 frontier solves less than half |

## How it was measured

- **Data:** 28,114 published scores (the dashboard database, LiveBench task scores, and 2,091 extra official scores collected by research, each with its source URL).
- **Scale:** a two-parameter IRT model fitted to all scores at once: every model gets one skill number, every benchmark one difficulty number, so benchmarks tested on different models can still be compared.
- **Checks:** it predicts held-out scores within **6.8 points** on average (a plain per-benchmark average misses by 14.7; correlation 0.93). Known orders come out right: LiveCodeBench Easy < Medium < Hard, GAIA Level 1 < 2 < 3, ARC-AGI 1 < 2 < 3, RULER 4K < … < 128K, FrontierMath Tiers 1–3 < Tier 4 < Erdős, MMLU < MMLU-Pro < GPQA < HLE, SWE-bench Verified < Pro; models line up by release generation.
- **Firm vs range:** a firm level needs ≥70% agreement over 200 bootstrap refits **and** tested models on both sides of its difficulty. Otherwise the list shows a range (2-3) or a bound (≤3 / ≥4).
- **Research corrections:** 14 benchmarks excluded (wrong scale, composite, mixed metrics), 59 guessing floors from official answer formats, categories checked against official descriptions.

## Coverage per category (sub-benchmarks in the team list with a firm level)

Numbers are list sub-benchmarks; **+N** = none in the list but N well-evidenced benchmarks in the data can fill it; **—** = nothing well-evidenced in the data.

| Category | L1 | L2 | L3 | L4 | L5 |
|---|---|---|---|---|---|
| knowledge | 1 | 10 | 5 | 6 | — |
| reasoning | 1 | 2 | 3 | 3 | — |
| math | 1 | 1 | 3 | 3 | 1 |
| coding | 3 | 2 | 6 | +1 | — |
| software_engineering | — | — | 13 | 17 | 2 |
| agentic | +1 | 3 | 12 | 5 | 1 |
| multimodal | +4 | 2 | 8 | 5 | — |
| long_context | 10 | 1 | 1 | — | 2 |
| factuality_honesty | — | — | 1 | 3 | — |
| instruction_following | +2 | +1 | 1 | — | — |
| multilingual | +1 | +3 | — | — | — |
| domain_medical | 1 | +1 | — | 1 | +1 |
| domain_finance | — | — | 1 | +1 | — |
| domain_legal | 3 | 1 | +1 | — | 1 |
| cybersecurity | — | — | +1 | 1 | — |
| other | 1 | 1 | 1 | 1 | — |

## Details per category

### knowledge

- **L1 Basic:** Biology (5.1)
- **L2 Standard:** Business (5.2); Chemistry (5.3); Computer Science (5.4); Economics (5.5); Health (5.7); History (5.8); Philosophy (5.11); Physics (5.12); Psychology (5.13); Other (5.14)
- **L3 Advanced:** GPQA Diamond (2.38); Engineering (5.6); Law (5.9); Social Sciences (26.2); Other (26.4)
- **L4 Expert:** HLE-Diamond (2.10); Humanity's Last Exam (2.55); Humanity's Last Exam (full, 2,500 questions) (4.1); Humanity's Last Exam (Text Only) (4.2); HLE-Diamond (4.4); HLE-Diamond Knowledge partition (4.6)
- **L5 Unsolved:** _gap — no benchmark in the data sits here with usable evidence_
- _Ranges/bounds:_ MMLU-Pro (2.59): ≤3; Bio/Med (4.9): ≥3; Physics (4.10): ≥3; CS/AI (4.11): ≥3; Humanities (4.12): ≥3; Chemistry (4.13): ≥3; Engineering (4.14): ≥3; Other (4.15): ≥3; Humanities (26.1): 3-4; STEM (26.3): ≥3

### reasoning

- **L1 Basic:** Spatial (1.11)
- **L2 Standard:** Theory of mind (1.9); Logic with navigation (1.12)
- **L3 Advanced:** CritPt v2 (Hard Subset) (2.8); ARC-AGI-1 (8.1); ARC-AGI-2 (8.2)
- **L4 Expert:** CritPt (2.56); ARC-AGI-3 · Standard (8.3); ARC-AGI-3 · Provider adapter (8.4)
- **L5 Unsolved:** _gap — no benchmark in the data sits here with usable evidence_
- _Ranges/bounds:_ Reasoning (1.8): 1-2; Zebra puzzles (1.10): 2-3; HLE-Diamond Reasoning partition (4.5): 3-4; GPQA Diamond (6.1): 2-3

### math

- **L1 Basic:** GSM8K (main) — test split (27.1)
- **L2 Standard:** Math (5.10)
- **L3 Advanced:** AIME 2025 (2.62); FrontierMath Tiers 1-3 (v2) (9.1); AIME 2025 (10.1)
- **L4 Expert:** FrontierMath Tier 4 (v2) (9.2); FrontierMath Tiers 1-3 (v1, old) (9.3); FrontierMath Tier 4 (v1, old) (9.4)
- **L5 Unsolved:** FrontierMath Erdős (9.5)
- _Ranges/bounds:_ MATH-500 (2.61): 1-2; Math (4.8): ≥3; AIME 2026 (10.2): ≤3

### coding

- **L1 Basic:** HumanEval (official harness, pass@k) (28.1); HumanEval in OpenAI simple-evals (zero-shot) (28.2); Easy (12.2)
- **L2 Standard:** Code editing leaderboard (legacy) (13.2); Refactoring leaderboard (13.3)
- **L3 Advanced:** LiveCodeBench (2.60); Code Generation (current leaderboard, release_v6) (12.1); Hard (12.4); Code Generation leaderboard (previous version, release_v5) (12.5); Test Output Prediction (12.9); Aider polyglot coding leaderboard (13.1)
- **L4 Expert:** _not in the list_ — candidates: Vibe Code Bench (40 models)
- **L5 Unsolved:** _gap — no benchmark in the data sits here with usable evidence_
- _Ranges/bounds:_ SciCode (2.54): 3-4; Medium (12.3): 2-3; Self-Repair (12.7): ≥3; Code Execution (12.8): ≥3

### software_engineering

- **L1 Basic:** _gap — no benchmark in the data sits here with usable evidence_
- **L2 Standard:** _gap — no benchmark in the data sits here with usable evidence_
- **L3 Advanced:** Systems Engineering (1.6); Performance Optimisation (1.7); Agent Loop (1.15); Billing & Limits (1.16); Product & UX (1.18); Terminal-Bench 2.1 (2.50); SWE-bench Verified (11.1); SWE-bench Bash Only (mini-SWE-agent) (11.2); SWE-bench Multilingual (11.4); SWE-bench Lite (11.5); SWE-bench Full (11.6); Terminal-Bench 2.1 (14.4); Terminal-Bench 2.0 (14.5)
- **L4 Expert:** Long Agentic (1.1); Finance & Compliance Apps (1.2); Operations & Commerce Apps (1.3); Long-Run Operations (1.4); Delegated Operations (1.5); Hard Fixes (1.20); Terminal-Bench 4.1 (2.6); Terminal-Bench-Science 0.1 (2.7); ITBench-AA (2.39); Terminal-Bench 4.0 (2.51); FrontierCode 1.1 (2.52); Terminal-Bench Hard (2.57); SWE-Bench Pro (Public) (11.7); SWE-Bench Pro (Private / commercial) (11.8); Terminal-Bench 4.1 (14.1); Terminal-Bench 4.0 (14.2); Terminal-Bench-Science 0.1 (14.7)
- **L5 Unsolved:** FrontierCode-AA 2.0 (2.5); Terminal-Bench 3.0 (14.3)
- _Ranges/bounds:_ Coding (1.13): 2-3; LLM API Integration (1.14): 2-3; Cloud Infrastructure (1.17): 2-3; Memory & Tools (1.19): ≤2; SWE-bench Multimodal (11.3): ≥3; Terminal-Bench 1.0 (14.6): 3-4

### agentic

- **L1 Basic:** _not in the list_ — candidates: PinchBench (10 models)
- **L2 Standard:** Design (1.37); Documents (DOCX) (1.38); Presentations (PPT) (1.40)
- **L3 Advanced:** Browser (1.21); Analysis-Driven Action (1.24); Structural Integrity (1.25); Constraint Adherence (1.26); Research (1.31); Test set (Average score) (15.1); Level 1 (15.2); Level 2 (15.3); Validation set (public dev set) (15.5); τ-bench (original) — Retail (16.2); τ²-bench — Airline (16.5); τ³-Voice — English edition (16.14)
- **L4 Expert:** APEX-Agents-AA (2.33); AA-AnalystAgent (2.34); EnterpriseOps-Gym-AA (2.36); τ³-Banking (2.49); τ³-Banking (τ-knowledge) (16.7)
- **L5 Unsolved:** FrontierPhysics (2.47)
- _Ranges/bounds:_ Data Aggregation (1.22): 3-4; Sequential Planning (1.23): 3-4; Regulatory & Compliance (1.32): 2-3; Strategy (1.35): 2-3; Science & Evidence (1.36): 2-3; PDF (1.39): 1-3; AutomationBench-AA (2.3): 3-4; τ²-Bench Telecom (2.58): ≤3; Level 3 (15.4): 3-4; τ-bench (original) — Airline (16.1): ≥3; τ²-bench — Retail (16.4): ≤3; τ²-bench — Telecom (16.6): 2-3

### multimodal

- **L1 Basic:** _not in the list_ — candidates: OCRBench v2 English: Visual Text Understanding (48 models); CountBench (16 models); AI2D_TEST (14 models); RefCOCO (avg) (10 models)
- **L2 Standard:** MMMU (Val) (19.4); Chinese: Relation Extraction (20.12)
- **L3 Advanced:** MMMU-Pro (2.40); MMMU-Pro (Overall) (19.1); MMMU-Pro Standard (10 options) (19.3); OCRBench v2 English (Average) (20.1); English: Text Referring (20.3); English: Text Spotting (20.4); English: Knowledge Reasoning (20.9); OCRBench v2 Chinese (Average) (20.10)
- **L4 Expert:** VIALS-AA (2.45); MKA (Multimodal Knowledge Agent) (2.46); FACTS Multimodal (7.7); English: Element Parsing (20.6); Chinese: Element Parsing (20.13)
- **L5 Unsolved:** _gap — no benchmark in the data sits here with usable evidence_
- _Ranges/bounds:_ English: Text Recognition (20.2): ≤3; English: Relation Extraction (20.5): ≤3; English: Mathematical Calculation (20.7): 2-3; English: Visual Text Understanding (20.8): ≤3; Chinese: Text Recognition (20.11): 2-3; Chinese: Visual Text Understanding (20.14): ≤3; Chinese: Knowledge Reasoning (20.15): ≥4

### long_context

- **L1 Basic:** Retrieval (NIAH) (21.1); Multi-hop Tracing (variable_tracking) (21.2); Aggregation (common_words_extraction, freq_words_extraction) (21.3); Question Answering (qa) (21.4); RULER @ 4K context (21.5); RULER @ 8K context (21.6); RULER @ 16K context (21.7); RULER @ 32K context (21.8); RULER @ 64K context (21.9); RULER average (4K-128K) (21.11)
- **L2 Standard:** RULER @ 128K context (21.10)
- **L3 Advanced:** AA-LCR v1.1 (2.53)
- **L4 Expert:** _gap — no benchmark in the data sits here with usable evidence_
- **L5 Unsolved:** GDP.pdf (2.4); MLCR-AA (2.42)

### factuality_honesty

- **L1 Basic:** _gap — no benchmark in the data sits here with usable evidence_
- **L2 Standard:** _gap — no benchmark in the data sits here with usable evidence_
- **L3 Advanced:** FACTS Grounding (7.4)
- **L4 Expert:** AA-Omniscience v1.1 (2.9); SimpleQA Verified (7.2); FACTS Parametric (7.5)
- **L5 Unsolved:** _gap — no benchmark in the data sits here with usable evidence_
- _Ranges/bounds:_ SimpleQA (7.1): 3-4; FACTS Search V2 (7.6): ≤3

### instruction_following

- **L1 Basic:** _not in the list_ — candidates: LiveBench 1.0 IF (293 models); IFEval (65 models)
- **L2 Standard:** _not in the list_ — candidates: IFBench (57 models)
- **L3 Advanced:** IFBench (2.41)
- **L4 Expert:** _gap — no benchmark in the data sits here with usable evidence_
- **L5 Unsolved:** _gap — no benchmark in the data sits here with usable evidence_

### multilingual

- **L1 Basic:** _not in the list_ — candidates: MGSM (13 models)
- **L2 Standard:** _not in the list_ — candidates: INCLUDE (20 models); MMMLU (20 models); MMLU-ProX (16 models)
- **L3 Advanced:** _gap — no benchmark in the data sits here with usable evidence_
- **L4 Expert:** _gap — no benchmark in the data sits here with usable evidence_
- **L5 Unsolved:** _gap — no benchmark in the data sits here with usable evidence_
- _Ranges/bounds:_ Global-MMLU-Lite (2.63): ≤3

### domain_medical

- **L1 Basic:** HealthBench Consensus (23.3)
- **L2 Standard:** _not in the list_ — candidates: MMLU-Pro Official: Health (138 models)
- **L3 Advanced:** _gap_ — only weaker evidence: MedXpertQA (MM) (8 models)
- **L4 Expert:** HealthBench (23.1)
- **L5 Unsolved:** _not in the list_ — candidates: DAYJOB Healthcare (20 models)
- _Ranges/bounds:_ HealthBench Professional (2.44): ≤4; HealthBench Hard (23.2): ≥4

### domain_finance

- **L1 Basic:** _gap — no benchmark in the data sits here with usable evidence_
- **L2 Standard:** _gap — no benchmark in the data sits here with usable evidence_
- **L3 Advanced:** Tax & Finance (1.34)
- **L4 Expert:** _not in the list_ — candidates: Finance Agent v2 (16 models)
- **L5 Unsolved:** _gap — no benchmark in the data sits here with usable evidence_

### domain_legal

- **L1 Basic:** Issue-spotting (25.1); Rule-conclusion (25.4); Interpretation (25.5)
- **L2 Standard:** Rule-recall (25.2)
- **L3 Advanced:** _not in the list_ — candidates: MMLU-Pro Official: Law (138 models)
- **L4 Expert:** _gap — no benchmark in the data sits here with usable evidence_
- **L5 Unsolved:** Harvey LAB-AA v1.1 (2.35)
- _Ranges/bounds:_ Legal (1.33): 2-3; Rhetorical-understanding (25.6): 1-2

### cybersecurity

- **L1 Basic:** _gap — no benchmark in the data sits here with usable evidence_
- **L2 Standard:** _gap — no benchmark in the data sits here with usable evidence_
- **L3 Advanced:** _not in the list_ — candidates: CyberGym (26 models)
- **L4 Expert:** CWE-Bench-AA (2.18)
- **L5 Unsolved:** _gap_ — only weaker evidence: ExploitBench Internal Port (9 models)
- _Ranges/bounds:_ DeepsecBench-AA (2.19): 4-5; CyberGym-E2E-AA (2.20): 4-5

### other

- **L1 Basic:** Table reformat (1.30)
- **L2 Standard:** Data Analysis (1.27)
- **L3 Advanced:** Consecutive events (1.28)
- **L4 Expert:** Table join (1.29)
- **L5 Unsolved:** _gap — no benchmark in the data sits here with usable evidence_

## Not levelled

87 sub-benchmarks cannot be put on this scale (Elo/vote ratings, composites of other benchmarks, honesty scores, dataset splits, or no per-model scores published). Each row's reason is in the list's Difficulty detail.

## Caveats

- Levels describe **how hard a benchmark is for today's models**, not human difficulty (ARC-AGI is easy for people).
- Agent benchmarks (SWE-bench, Terminal-Bench, GAIA, τ-bench) measure model + harness; entries can be agent systems.
- Some stored results mix versions or settings; those rows carry a 'Data caveats' line in their detail and were not picked as gap fillers.
- 'Frontier' = the 10 strongest models in the data as of 2026-11-26; as new models arrive, levels shift down over time.
