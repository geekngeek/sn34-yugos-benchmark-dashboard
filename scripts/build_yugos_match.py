#!/usr/bin/env python3
"""Yugos match scores: how well each sub-benchmark (and public dataset) can stand in for Yugos's chat, math & code and
agentic questions. Method: docs/yugos-match.md.

Stages (run in order; each writes into data/yugos-match/):
  levels   level mix (L1..L5) of every sub-benchmark from published scores in the database:
           share of questions at level <= L  ~=  score of the level-L model group (after removing the guessing floor).
           Writes levels-subbenchmarks.json (+ the mix per team difficulty level, used when a row has no anchor scores).
  batches  writes assess/input-*.json: one batch of rows per research agent (row facts + computed level mix).
  build    merges the agents' judgments (assess/out-*.json) with the computed difficulty fit into
           subbenchmarks.json and datasets.json, which the dashboard reads.

Usage: python3 -I scripts/build_yugos_match.py levels|batches|build
"""
from __future__ import annotations

import csv
import glob
import json
import os
import re
import statistics
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "yugos-match"
LIST = ROOT / "dashboard" / "public" / "benchmark-list.csv"
MAP = ROOT / "data" / "benchmark-map.json"

# --- model groups that define the levels (docs/difficulty-levels.md) ---------------------------------------------
GROUPS = {
    1: r"^(openai/gpt-3\.5(-turbo(-\d+)?)?|meta/llama-3(\.1)?-8b(-instruct(-turbo)?)?|mistral/mistral-7b(-instruct)?(-v0\.\d)?|google/gemma-2-9b(-it)?)$",
    2: r"^(openai/gpt-4o|anthropic/claude-3\.5-sonnet|openai/gpt-4-turbo(-1106|-preview-0125|-preview-1106)?|meta/llama-3\.1-405b(-instruct(-turbo)?)?)$",
    3: r"^(openai/gpt-5|anthropic/claude-opus-4\.5(-high-32k)?|google/gemini-3-pro(-11-25|-preview)?)$",
    4: r"^(openai/gpt-6(\.1|\.2)?-(astra|sol)|anthropic/claude-(fable-5(\.1|\.2)?|opus-5(\.5)?)|google/gemini-4-(argon|carbon|neon|hydrogen))$",
}
GROUP_NAMES = {1: "small/old (GPT-3.5, Llama-3-8B, Mistral 7B, Gemma 2 9B)", 2: "2024 flagships (GPT-4o, Claude 3.5 Sonnet, GPT-4 Turbo, Llama 3.1 405B)",
               3: "late-2025 frontier (GPT-5, Claude Opus 4.5, Gemini 3 Pro)", 4: "Nov-2026 frontier (GPT-6.x, Claude Fable/Opus 5.x, Gemini 4)"}

# --- the Yugos parts a candidate can stand in for (research/yugos-dataset-levels.json, live pack v0.4.0) ----------
# cdf = share of questions at level <= 1..4 (None = boundary not known for that part; buckets below say which are used)
TARGETS = {
    "chat": {"label": "Chat & QA", "buckets": [2, 3], "parts": {
        "public": {"label": "public chat (bbeh, hle, hotpotqa, simpleqa_verified, mmlu_pro)", "cdf": {2: 0.12, 3: 0.31}},
        "private": {"label": "private chat (hidden, very easy)", "cdf": {2: 0.81, 3: 0.99}}}},
    "math_code": {"label": "Math & code", "buckets": [2, 3, 4], "parts": {
        "public": {"label": "public math & code (math, arxivmath, bigcodebench, ds1000)", "cdf": {2: 0.39, 3: 0.95, 4: 0.98}},
        "private": {"label": "private math & code (hidden, mostly L3)", "cdf": {2: 0.23, 3: 0.99, 4: 1.0}}}},
    "agentic": {"label": "Agentic", "buckets": [3, 4], "parts": {
        "public": {"label": "public agentic (bfcl, single-turn function calls)", "cdf": {3: 0.91, 4: 0.98}},
        "private": {"label": "private agentic (hidden, guessed multi-step tool tasks)", "cdf": {3: 0.68, 4: 0.89}}}},
}
WEIGHTS = {"I": 0.15, "A": 0.15, "Dm": 0.15, "L": 0.05, "D": 0.15, "F": 0.10}   # task fit T multiplies


def db_rows():
    import psycopg
    from psycopg.rows import dict_row
    env = ROOT / ".env"
    if env.exists():
        for line in env.read_text().splitlines():
            if line.startswith("DATABASE_URL=") and "DATABASE_URL" not in os.environ:
                os.environ["DATABASE_URL"] = line.split("=", 1)[1].strip().strip('"')
    dsn = os.environ.get("DATABASE_URL", "postgresql://bench:bench@localhost:5432/llm_bench")
    with psycopg.connect(dsn, row_factory=dict_row) as conn:
        return conn.execute("""
            SELECT s.source_name AS source, b.benchmark_name AS name, b.benchmark_version AS version, m.canonical_key AS model,
                   r.score_unit AS unit, coalesce(r.accuracy, r.benchmark_score)::float AS score
              FROM benchmark_results r JOIN benchmarks b ON b.id = r.benchmark_id JOIN sources s ON s.id = r.source_id
              JOIN models m ON m.id = r.model_id
             WHERE r.score_unit IN ('points', 'percent', 'fraction') AND coalesce(r.accuracy, r.benchmark_score) IS NOT NULL""").fetchall()


def guess_floor(detail: str) -> float:
    m = re.search(r"guessing floor (\d+(?:\.\d+)?)% removed", detail or "")
    return float(m.group(1)) / 100 if m else 0.0


def team_level(raw: str) -> tuple[int, int] | None:
    v = (raw or "").replace(" ", "")
    if m := re.fullmatch(r"([1-5])", v):
        return int(m[1]), int(m[1])
    if m := re.fullmatch(r"([1-5])[-–]([1-5])", v):
        return int(m[1]), int(m[2])
    if m := re.fullmatch(r"(≤|<=)([1-5])", v):
        return 1, int(m[2])
    if m := re.fullmatch(r"(≥|>=)([1-5])", v):
        return int(m[2]), 5
    return None


def stage_levels() -> None:
    rows = list(csv.DictReader(LIST.open(encoding="utf-8")))
    bmap = json.load(MAP.open())["rows"]
    by_bench: dict[tuple, list] = {}
    for r in db_rows():
        by_bench.setdefault((r["source"], r["name"], r["version"]), []).append(r)
    out, calib = {}, {}
    for r in rows:
        no = r["No"].strip()
        if "." not in no:
            continue
        refs = bmap.get(no, {}).get("benchmarks", [])
        res = [x for ref in refs for x in by_bench.get((ref["source"], ref["name"], ref["version"]), [])]
        floor = guess_floor(r["Difficulty detail"])
        best: dict[str, float] = {}
        for x in res:
            s = x["score"] * (100 if x["unit"] == "fraction" or (x["score"] <= 1.0 and all(y["score"] <= 1.0 for y in res)) else 1)
            best[x["model"]] = max(best.get(x["model"], -1e9), s)
        groups = {}
        for g, rx in GROUPS.items():
            vals = [v for k, v in best.items() if re.match(rx, k)]
            if vals:
                acc = statistics.median(vals) / 100
                groups[g] = {"models": sorted(k for k in best if re.match(rx, k)), "score": round(acc, 4),
                             "cdf": round(min(1.0, max(0.0, (acc - floor) / (1 - floor))), 4)}
        measured = {g: groups[g]["cdf"] for g in groups}
        lvl = team_level(r["Difficulty"])
        out[no] = {"no": no, "name": r["Name"], "team_level": r["Difficulty"], "floor": floor, "n_models": len(best),
                   "groups": groups, "measured": measured}
        if len(measured) >= 2 and lvl and lvl[0] == lvl[1]:
            calib.setdefault(lvl[0], []).append(measured)
    # mean measured cumulative shares per firm team level (printed as a check on DEFAULT_CDF below)
    for L, cdfs in sorted(calib.items()):
        means = [round(statistics.mean([c[g] for c in cdfs if g in c]), 3) if any(g in c for c in cdfs) else None for g in (1, 2, 3, 4)]
        print(f"  team level {L}: {len(cdfs)} rows with measured shares, mean {means}  (default {[DEFAULT_CDF[L][g] for g in (1, 2, 3, 4)]})")
    for rec in out.values():
        rec.update(level_mix(rec["measured"], team_level(rec["team_level"])))
    json.dump({"groups": GROUP_NAMES, "default_cdf_by_team_level": DEFAULT_CDF, "rows": out},
              (OUT / "levels-subbenchmarks.json").open("w"), indent=1)
    from collections import Counter
    print(f"{len(out)} sub-benchmarks by level-mix source: {dict(Counter(v['level_source'] for v in out.values()))}")


# Default cumulative shares for a benchmark at a firm team level, when no model group has scores on it. Measured means
# (printed by `levels`) for levels 1-4, the missing upper groups filled by reasoning: a benchmark the small models half
# solve is nearly all solved by later generations, short of bad answer keys (~3-5%). L5 has no measured rows: by its
# definition the Nov-2026 frontier solves under half.
DEFAULT_CDF = {
    1: {1: 0.66, 2: 0.89, 3: 0.95, 4: 0.97},
    2: {1: 0.33, 2: 0.75, 3: 0.92, 4: 0.96},
    3: {1: 0.08, 2: 0.32, 3: 0.64, 4: 0.74},
    4: {1: 0.04, 2: 0.07, 3: 0.20, 4: 0.59},
    5: {1: 0.01, 2: 0.03, 3: 0.08, 4: 0.30},
}


def level_mix(measured: dict, lvl: tuple[int, int] | None) -> dict:
    """cumulative shares at levels 1-4: the team-level default, overwritten by measured group scores, kept monotone"""
    if not lvl and not measured:
        return {"cdf": None, "level_source": "none"}
    if not lvl:   # no team level: take the default shape whose shares are closest to what was measured
        near = min(DEFAULT_CDF, key=lambda L: sum(abs(DEFAULT_CDF[L][int(g)] - v) for g, v in measured.items()))
        lvl = (near, near)
        guessed_level = True
    else:
        guessed_level = False
    cdf = {g: statistics.mean(DEFAULT_CDF[L][g] for L in range(lvl[0], lvl[1] + 1)) for g in (1, 2, 3, 4)}
    cdf.update({int(g): v for g, v in measured.items()})
    run = 0.0
    for g in (1, 2, 3, 4):   # a harder level never has a lower cumulative share
        run = max(run, cdf[g])
        cdf[g] = round(min(run, 1.0), 4)
    src = ("scores" if len(measured) >= 2 else "scores+team-level" if measured else "team-level") + (" (nearest level)" if guessed_level else "")
    return {"cdf": cdf, "level_source": src}


SUB_BATCHES = [  # parents (by No) per research batch, about 25 rows each
    ("S01", ["1"], (1, 20)), ("S02", ["1"], (21, 99)), ("S03", ["2"], (1, 32)), ("S04", ["2"], (33, 99)),
    ("S05", ["3", "4"], None), ("S06", ["5", "6", "7"], None), ("S07", ["8", "9", "10", "11", "12"], None),
    ("S08", ["13", "14", "15", "16"], None), ("S09", ["17", "18", "26", "27", "28"], None),
    ("S10", ["19", "20", "21"], None), ("S11", ["22", "23", "24", "25"], None),
]


def stage_batches() -> None:
    rows = list(csv.DictReader(LIST.open(encoding="utf-8")))
    levels = json.load((OUT / "levels-subbenchmarks.json").open())["rows"]
    parents = {r["No"]: r for r in rows if "." not in r["No"]}
    (OUT / "assess").mkdir(exist_ok=True)
    cut = lambda s, n: (s or "")[:n]
    for bid, pnos, rng in SUB_BATCHES:
        items = []
        for r in rows:
            no = r["No"]
            if "." not in no or no.split(".")[0] not in pnos:
                continue
            k = int(no.split(".")[1])
            if rng and not (rng[0] <= k <= rng[1]):
                continue
            lv = levels.get(no, {})
            items.append({"no": no, "name": r["Name"], "category": r["Category"], "url": r["URL"], "focus": r["Focus"],
                          "metrics": cut(r["Metrics"], 200), "metrics_detail": cut(r["Metrics detail"], 500), "notes": cut(r["Notes"], 700),
                          "team_difficulty": r["Difficulty"], "difficulty_detail": cut(r["Difficulty detail"], 500),
                          "computed_level_cdf": lv.get("cdf"), "level_source": lv.get("level_source"),
                          "anchor_scores": {g: v["score"] for g, v in (lv.get("groups") or {}).items()}})
        par = [{"no": p, "name": parents[p]["Name"], "category": parents[p]["Category"], "url": parents[p]["URL"],
                "focus": parents[p]["Focus"], "notes": cut(parents[p]["Notes"], 1200)} for p in pnos]
        json.dump({"batch": bid, "parents": par, "rows": items}, (OUT / "assess" / f"input-{bid}.json").open("w"), indent=1, ensure_ascii=False)
        print(bid, len(items), "rows")


CATS = ("chat", "math_code", "agentic")
FACTORS = ("T", "I", "A", "Dm", "L", "F")


def buckets(cdf: dict, cuts: list[int]) -> list[float]:
    """shares of questions between the given cumulative cut levels: [<=c1, c1..c2, ..., >last]"""
    vals = [cdf[c] for c in cuts]
    return [vals[0]] + [max(0.0, vals[i] - vals[i - 1]) for i in range(1, len(vals))] + [max(0.0, 1 - vals[-1])]


def difficulty_fit(cdf: dict | None, cat: str) -> dict:
    """1 - total variation distance between the candidate's level mix and each Yugos part's, in that category's buckets"""
    t = TARGETS[cat]
    out = {}
    for part, p in t["parts"].items():
        if not cdf:
            out[part] = None
            continue
        a, b = buckets(cdf, t["buckets"]), buckets(p["cdf"], t["buckets"])
        out[part] = round(1 - sum(abs(x - y) for x, y in zip(a, b)) / 2, 3)
    return out


def cdf_from_anchors(anchors: dict | None, floor: float | None) -> dict | None:
    """dataset level mix from published group scores (share at level <= L ~= group-L score, guessing floor removed)"""
    if not anchors:
        return None
    g = float(floor or 0)
    measured = {}
    for k, v in anchors.items():
        if isinstance(v, dict) and isinstance(v.get("score"), (int, float)):
            s = float(v["score"]) / (100 if v["score"] > 1.0 else 1)
            measured[int(k)] = round(min(1.0, max(0.0, (s - g) / (1 - g))), 4)
    if not measured:
        return None
    return level_mix(measured, None)["cdf"]


def score_item(sc: dict, cdf: dict | None) -> dict:
    """final match % per category = T x weighted mean of the other factors and the difficulty fit (best Yugos part)"""
    wsum = sum(WEIGHTS.values())
    res = {}
    for cat in CATS:
        f = sc[cat]
        dfit = difficulty_fit(cdf, cat)
        best = None
        for part, d in dfit.items():
            dv = 0.5 if d is None else d    # no difficulty evidence: neutral
            rest = sum(WEIGHTS[k] * f[k] for k in ("I", "A", "Dm", "L", "F")) + WEIGHTS["D"] * dv
            val = f["T"] * rest / wsum
            if best is None or val > best[0]:
                best = (val, part, d)
        res[cat] = {"match": round(best[0], 3), "part": best[1], "D": best[2], "D_by_part": dfit,
                    **{k: f[k] for k in FACTORS}, "why": f.get("why", "")}
    return res


def load_outputs(prefix: str) -> dict:
    out = {}
    for f in sorted(glob.glob(str(OUT / "assess" / f"out-{prefix}*.json"))):
        out.update(json.load(open(f)))
    return out


def shares5(cdf: dict | None) -> list[float] | None:
    return [round(x, 3) for x in buckets(cdf, [1, 2, 3, 4])] if cdf else None


def load_overrides() -> dict:
    """data/yugos-match/overrides.csv: hand corrections (kind, id, category or *, factor, value, reason)"""
    f = OUT / "overrides.csv"
    out: dict = {}
    if f.exists():
        for r in csv.DictReader(f.open(encoding="utf-8")):
            out.setdefault((r["kind"], r["id"]), []).append(r)
    return out


OVERRIDES: dict = {}


FACT_FIELDS = {"n_questions": int}


def apply_overrides(kind: str, key: str, scores: dict) -> list[str]:
    notes = []
    for o in OVERRIDES.get((kind, key), []):
        if o["factor"] in FACT_FIELDS:   # a fact, applied to the item in common()
            continue
        for cat in (CATS if o["category"] == "*" else [o["category"]]):
            old = scores[cat][o["factor"]]
            scores[cat][o["factor"]] = float(o["value"])
            notes.append(f"{cat} {o['factor']} {old} -> {o['value']}: {o['reason']}")
    return notes


def age_fresh(year) -> float | None:
    """freshness from release year alone (used where overlap with a live set had been mixed into F)"""
    try:
        y = int(str(year)[:4])
    except (TypeError, ValueError):
        return None
    return 0.7 if y >= 2026 else 0.6 if y == 2025 else 0.45 if y == 2024 else 0.35 if y >= 2022 else 0.2


def common(a: dict, cdf, level_src, kind: str = "", key: str = "", live: bool = False) -> dict:
    scores = json.loads(json.dumps(a["scores"]))
    adjusted = []
    if kind == "dataset" and (live or (a.get("overlap") or "").strip()) and not OVERRIDES.get((kind, key)):
        f = age_fresh(a.get("release_year"))
        if f is not None:
            for cat in CATS:
                if abs(scores[cat]["F"] - f) > 1e-9:
                    adjusted.append(f"{cat} F {scores[cat]['F']} -> {f}: freshness from the release year ({a.get('release_year')}) only; overlap with a live Yugos set is flagged separately")
                    scores[cat]["F"] = f
    adjusted += apply_overrides(kind, key, scores) if kind else []
    sc = score_item(scores, cdf)
    facts = {}
    for o in OVERRIDES.get((kind, key), []):
        if o["factor"] in FACT_FIELDS:
            facts[o["factor"]] = FACT_FIELDS[o["factor"]](o["value"])
            adjusted.append(f"{o['factor']} {a.get(o['factor'])} -> {o['value']}: {o['reason']}")
    best_cat = max(CATS, key=lambda c: sc[c]["match"])
    return {"match": sc, "best": {"category": best_cat, "part": sc[best_cat]["part"], "match": sc[best_cat]["match"]},
            "levels": shares5(cdf), "level_source": level_src, "adjusted": adjusted,
            "live_overlap": live or bool((a.get("overlap") or "").strip()),
            **{k: a.get(k) for k in ("modality", "questions_public", "questions_where", "n_questions", "per_question_results",
                                      "results_where", "licence", "overlap", "summary", "confidence", "sources")}, **facts}


def stage_build() -> None:
    from datetime import datetime, timezone
    built = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    OVERRIDES.update(load_overrides())
    levels = json.load((OUT / "levels-subbenchmarks.json").open())["rows"]
    targets = {c: {"label": t["label"], "parts": {p: {"label": v["label"], "levels": shares5({**{1: 0, 2: 0, 3: 0, 4: 0}, **v["cdf"]})}
                                                   for p, v in t["parts"].items()}} for c, t in TARGETS.items()}
    # sub-benchmarks
    subs = load_outputs("S")
    rows = {}
    for no, a in subs.items():
        lv = levels.get(no, {})
        cdf, src = lv.get("cdf"), lv.get("level_source")
        if not cdf and (a.get("level_guess") or {}).get("cdf"):
            cdf, src = {int(k): float(v) for k, v in a["level_guess"]["cdf"].items()}, "assessor estimate"
        cdf = {int(k): v for k, v in cdf.items()} if cdf else None
        rows[no] = {"no": no, **common(a, cdf, src or "none", "sub", no),
                    "level_note": (a.get("level_guess") or {}).get("why") if src == "assessor estimate" else None}
    json.dump({"built_at": built, "weights": WEIGHTS, "targets": targets, "rows": rows},
              (OUT / "subbenchmarks.json").open("w"), indent=1, ensure_ascii=False)
    print(f"subbenchmarks.json: {len(rows)} rows")
    # datasets
    cands = {r["id"]: r for r in csv.DictReader((OUT / "dataset-candidates.csv").open(encoding="utf-8"))}
    facts = json.load((OUT / "dataset-facts.json").open()) if (OUT / "dataset-facts.json").exists() else {}
    outs = load_outputs("D")
    items = []
    for did, a in outs.items():
        c = cands.get(did, {})
        cdf, src = None, "none"
        if c.get("list_no") and levels.get(c["list_no"], {}).get("cdf"):
            cdf, src = {int(k): v for k, v in levels[c["list_no"]]["cdf"].items()}, f"benchmark list {c['list_no']}"
        elif (cdf := cdf_from_anchors(a.get("anchor_scores"), a.get("guess_floor"))):
            src = "published group scores"
        elif (a.get("level_guess") or {}).get("cdf"):
            cdf, src = {int(k): float(v) for k, v in a["level_guess"]["cdf"].items()}, "assessor estimate"
        hub = facts.get(did, {})
        items.append({"id": did, "name": c.get("name", did), "hf": c.get("hf") or None, "url": c.get("url"), "group": c.get("group"),
                      "yugos": c.get("yugos") or "", "list_no": c.get("list_no") or None, **common(a, cdf, src, "dataset", did, live=c.get("yugos") == "live"),
                      "anchor_scores": a.get("anchor_scores"), "level_note": (a.get("level_guess") or {}).get("why"),
                      "release_year": a.get("release_year"), "languages": a.get("languages"),
                      "hub": {k: hub.get(k) for k in ("licence", "gated", "created", "last_modified", "downloads", "rows_total")}})
    items.sort(key=lambda x: -x["best"]["match"])
    json.dump({"built_at": built, "weights": WEIGHTS, "targets": targets, "datasets": items},
              (OUT / "datasets.json").open("w"), indent=1, ensure_ascii=False)
    print(f"datasets.json: {len(items)} datasets")


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    stage = sys.argv[1] if len(sys.argv) > 1 else ""
    if stage == "build":
        stage_build()
        return 0
    if stage == "levels":
        stage_levels()
    elif stage == "batches":
        stage_batches()
    else:
        print(__doc__)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
