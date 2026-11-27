# Yugos match rubric (for every assessor)

**Goal.** We want more training data for a Yugos router: a model that picks which LLM (and effort) answers each
question, scored on quality minus cost and time. For each candidate (a sub-benchmark of our benchmark list, or a
public dataset), judge how well its questions can **stand in for Yugos's questions** in each of the three Yugos
categories. You give factor scores; the build script computes the final match % (it is NOT you who multiplies).

Yugos sends the router **text only** (no images, audio or video). All Yugos questions are English.

## The three Yugos categories (live pack competition-v0.4.0, 1,922 questions)

| Category | Weight | Public part (we know the datasets) | Private part (hidden; what we know) |
|---|---|---|---|
| **chat** (Chat & QA) | 40%, 800 q | 400 q: **bbeh** 150 (BIG-Bench Extra Hard: 23 hard reasoning-puzzle tasks, median prompt ~620 tokens, short exact-match answer) · **hle** 90 (Humanity's Last Exam text-only: expert questions, 45% math, 76% exact answer / 24% multiple choice, LLM-judge graded) · **hotpotqa** 70 (read 10 Wikipedia paragraphs ~1,400 tokens, multi-hop short answer, answer+evidence F1) · **simpleqa_verified** 50 (one-line factual recall ~22 tokens, judge graded) · **mmlu_pro** 40 (10-option multiple choice, 14 school/university subjects) | 400 q, content unknown. **Very easy**: field median score 0.995; estimated 81% of questions at level L1–2. |
| **math_code** (Math & code) | 35%, 800 q | 400 q: **math** 80 (MATH competition problems, \boxed{} answer, all levels) · **arxivmath** 65 (research-level math from arXiv papers, closed-form answer checked by Math-Verify) · **bigcodebench** 130 (write a Python function using ~2.8 libraries — pandas, numpy, matplotlib…; hidden unit tests) · **ds1000** 125 (data-science code fill-in: pandas 29%, numpy 22%, matplotlib 16%, sklearn, scipy, torch; executed and checked) | 400 q, content unknown (math and/or code). Median score 0.94; estimated 76% at level L3. |
| **agentic** (tool use) | 25%, 322 q | 70 q: **bfcl** (Berkeley Function Calling, single-turn: pick the right function(s) and arguments from JSON schemas, AST match; ~31% of the pool expects NO call; prompt ~350 tokens with schemas) | 252 q, hidden. Hard (median 0.67; estimated 68% L1–3, 20% L4, 11% L5). **Guess (not confirmed by Yugos):** multi-step tool tasks graded on end state, like tau2-bench (a conversation, several tool calls). |

Levels: L1 even small/old models solve about half · L2 2024 flagships (GPT-4o, Claude 3.5 Sonnet) · L3 late-2025
frontier (GPT-5, Gemini 3 Pro) · L4 only the Nov-2026 frontier · L5 even that frontier solves under half.

## Factors you score (0–1, two decimals), for EACH of the 3 categories

| Key | Factor | 1.0 means | 0.5 means | ~0 means |
|---|---|---|---|---|
| **T** | **Task fit** — the skill the questions ask for (this one multiplies everything) | same skill as that category's questions | related skill, different flavour | different skill. **Required images/audio/video → T ≤ 0.05** (Yugos is text-only). Pairwise human-preference / Elo prompts with no reference answer → chat T ≤ 0.3 |
| **I** | Turn structure | same shape (chat & math_code: one text prompt → one answer; agentic: tools in the prompt; private agentic: multi-turn with tools) | close (e.g. multi-turn chat vs single-turn) | very different |
| **A** | Answer format & grading | same kind of answer and checker (chat: exact/short answer, MC letter, judge, F1; math_code: boxed or closed-form, unit tests, executed code; agentic: function-call AST, end-state checks) | partly (e.g. free-form rubric judge vs exact answer) | no checkable answer, or a very different checker |
| **Dm** | Domain & topics | topics overlap the category's mix heavily | some overlap | unrelated topics |
| **L** | Input length & shape | prompt length within ~2× of the category's typical (chat 20–1,400 tokens; math_code 35–400; agentic 350–2,000 incl. tool schemas) | 2–5× off | >5× off (e.g. 100k-token documents) |
| **F** | Freshness & overlap | released 2025–2026, unlikely memorized, no question overlap with a live Yugos public set | 2023–2024, or partly memorized | ≤2022 and heavily trained on, or it **is / contains** a live Yugos public set (say so in `overlap`) |

You do **not** score difficulty: the script computes the difficulty fit from published scores (`computed_level_cdf`:
share of questions at level ≤ 1..4). If `computed_level_cdf` is null, give `level_guess` instead (see schema) with a
reason, only when the facts support it; otherwise leave it null.

For a category where T ≤ 0.10, the other five factors barely matter: give quick values and the reason "different
skill: …". Spend your effort where T is high.

## Calibration (use these to keep scores consistent)

| Candidate | chat T/I/A/Dm/L/F | math_code T/I/A/Dm/L/F | agentic T/I/A/Dm/L/F | → final chat / math / agentic |
|---|---|---|---|---|
| SimpleQA original (4,326 fact questions, judge; 944 overlap simpleqa_verified) | 1 / 1 / 1 / 1 / 1 / .5 | .05 / 1 / .2 / .1 / 1 / .5 | .05 / .1 / .1 / .1 / .5 / .5 | 90% / 2% / 1% |
| LiveCodeBench Medium (383 contest problems 2023–25, hidden tests) | .1 / 1 / .1 / .2 / .8 / .7 | .9 / 1 / .9 / .6 / .9 / .7 | .05 / .1 / .1 / .1 / .5 / .7 | 5% / 75% / 1% |
| BFCL multi-turn base (200 multi-turn tool tasks) | .05 / .2 / .1 / .1 / .8 / .7 | .05 / .2 / .1 / .1 / .8 / .7 | .9 / .8 / .8 / .8 / .9 / .7 | 2% / 2% / 75% |
| tau2 airline (50 customer-service tasks, simulated user) | .05 / .2 / .1 / .2 / .3 / .6 | .05 / .2 / .1 / .1 / .3 / .6 | .9 / .9 / .8 / .7 / .7 / .6 | 2% / 1% / 70% |
| ARC-Challenge (2,590 grade-school science MC, 2018) | .8 / 1 / .9 / .6 / .9 / .3 | .2 / 1 / .2 / .2 / .9 / .3 | .05 / .1 / .1 / .1 / .5 / .3 | 62% / 10% / 1% |
| MBPP (974 short Python tasks, 2021) | .1 / 1 / .1 / .2 / .6 / .3 | .9 / 1 / .9 / .5 / .6 / .3 | .05 / .1 / .1 / .1 / .5 / .3 | 5% / 59% / 1% |

Final % = T × weighted mean(I .15, A .15, Dm .15, L .05, Difficulty .15, F .10) — computed by the script.

## Facts you also record

- `modality`: "text" | "image" | "audio" | "video" | "mixed".
- `questions_public`: "yes" | "partial" | "no" | "unknown" — can we download the questions (with answers) to use as data?
  `questions_where`: URL or dataset id if yes/partial.
- `n_questions`: integer only if a fact you saw states it (row facts or a page you opened); else null.
- `per_question_results`: "yes" | "no" | "unknown" — are per-model, per-question outcomes public (very valuable for
  router training)? `results_where`: URL if yes.
- `licence`: as stated on the data's page, else null.
- `overlap`: text if the candidate shares questions with a live Yugos set (bbeh, hle, hotpotqa, simpleqa_verified,
  mmlu_pro, math, arxivmath, bigcodebench, ds1000, bfcl), else "".
- `confidence`: "high" | "medium" | "low" in your factor scores.

**Never guess facts.** Use the row facts given to you, and open pages (WebFetch) when the row facts don't say what the
questions look like (format, size, availability). If you can't find a fact, put null / "unknown" and say so.

## Output schema (one JSON object, keys = the row's `no` or the dataset's `id`)

```json
{
  "5.1": {
    "scores": {
      "chat":      {"T": 0.8, "I": 1.0, "A": 0.9, "Dm": 0.6, "L": 0.9, "F": 0.4, "why": "one sentence"},
      "math_code": {"T": 0.2, "I": 1.0, "A": 0.2, "Dm": 0.2, "L": 0.9, "F": 0.4, "why": "one sentence"},
      "agentic":   {"T": 0.05, "I": 0.1, "A": 0.1, "Dm": 0.1, "L": 0.5, "F": 0.4, "why": "different skill: no tools"}
    },
    "best_part": "chat:private",
    "level_guess": null,
    "modality": "text", "questions_public": "yes", "questions_where": "https://huggingface.co/datasets/TIGER-Lab/MMLU-Pro",
    "n_questions": null, "per_question_results": "unknown", "results_where": null, "licence": null,
    "overlap": "", "summary": "One or two plain sentences: what the questions are and how they could help the router.",
    "confidence": "medium", "sources": ["urls you opened"]
  }
}
```
`best_part` = which Yugos part it stands in for best: "chat:public", "chat:private", "math_code:public",
"math_code:private", "agentic:public", "agentic:private", or "none".
`level_guess` (only when computed_level_cdf is null): {"cdf": {"1": 0.1, "2": 0.3, "3": 0.6, "4": 0.8}, "why": "…"}.

## Extra rules for DATASETS (assess/input-D*.json)

A dataset row gives: `id`, `name`, Hugging Face id `hf` (may be empty), `url`, `group` (our first guess of its
category, or "router" for data sets of per-question model outcomes), `yugos` ("live" = it IS one of Yugos's live
public sets; "catalog" = in Yugos's catalog of supported benchmarks, not in the live pack), `list_no` (row of our
benchmark list with the same questions; its level mix is used), and `hub` (facts from the Hugging Face API: licence,
gated, created, rows per split).

Research each dataset properly: open its card / paper / repo (WebFetch) to learn what one question looks like
(prompt, answer, grading), how many questions, release year, licence, and whether per-model per-question results are
public. Then score the factors exactly as for sub-benchmarks.

**Difficulty evidence.** If `list_no` is empty, look for published scores of the four model groups on this dataset
(model cards, papers, official leaderboards) and record them in `anchor_scores` — the script turns them into the level
mix (share at level ≤ L ≈ score of group L, after removing the guessing floor you give in `guess_floor`):
```json
"anchor_scores": {"1": {"model": "Llama 3.1 8B Instruct", "score": 0.834, "source": "https://..."},
                  "2": {"model": "GPT-4o", "score": 0.96, "source": "https://..."},
                  "3": null, "4": null},
"guess_floor": 0.25
```
Groups: 1 small/old (GPT-3.5, Llama-3/3.1-8B, Mistral 7B, Gemma 2 9B) · 2 2024 flagships (GPT-4o, Claude 3.5 Sonnet,
GPT-4 Turbo, Llama 3.1 405B) · 3 late-2025 frontier (GPT-5, Claude Opus 4.5, Gemini 3 Pro) · 4 Nov-2026 frontier
(GPT-6.x, Claude Fable/Opus 5.x, Gemini 4). Scores are 0–1. Only numbers you saw on a page, with its URL. If no group
score can be found, give `level_guess` with a reason (or null).

Router data sets (group "router") are scored on how well their **questions** match each category (they usually mix
several source benchmarks: weigh by their mix) — and their `per_question_results` is the main point: say which models
and how many.

**`yugos` = "live"**: it is a live Yugos public set. Score it honestly (it will match its own category very well), set
`overlap` to "is the live Yugos <name> set: only the questions outside the live sample can be used, and never for
testing", and F ≤ 0.3.

Extra dataset fields: `anchor_scores`, `guess_floor`, `languages` (as seen), `release_year`.
