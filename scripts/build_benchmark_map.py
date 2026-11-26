"""Link the Benchmark list (dashboard/public/benchmark-list.csv) to benchmarks in the database.

    .venv/bin/python -I scripts/build_benchmark_map.py

Writes data/benchmark-map.json, which the benchmark details page (/benchmarks/<No>) reads, and
docs/benchmark-map-report.md.

- Every parent row (No 1..28) has an explicit list of the database benchmarks that belong to it (PARENTS
  below: its official source and BenchLM's copies under that name) and one "overall" benchmark whose
  results are the parent page's main table.
- A sub row (No 2.1, 2.2, …) is linked to a candidate of its parent only when EVERY word of its name is
  in that benchmark's name, and the benchmark's name has no OTHER words than the source's own name, the
  parent's name and filler ("SimpleQA" does not take "SimpleQA Verified"). Per source the closest such name
  wins; a tie links nothing (listed as ambiguous). data/benchmark-map-overrides.csv (No -> benchmark) wins.
Names are stored (not database ids, which change when the database is rebuilt).
"""
from __future__ import annotations

import csv
import json
import os
import re
import sys
from pathlib import Path

import psycopg
from psycopg.rows import dict_row

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from api.config import load_dotenv  # noqa: E402

LIST = ROOT / "dashboard" / "public" / "benchmark-list.csv"
OUT = ROOT / "data" / "benchmark-map.json"
OVERRIDES = ROOT / "data" / "benchmark-map-overrides.csv"
REPORT = ROOT / "docs" / "benchmark-map-report.md"

BL = "BenchLM"
# parent No -> (sources whose benchmarks all belong, {source: name regex}, overall (source, name, version))
PARENTS: dict[str, dict] = {
    "1":  {"src": {"LiveBench": r"^LiveBench\|2\.0 "}, "overall": ("LiveBench", "LiveBench", "2.0 Overall")},
    "2":  {"src": {"Artificial Analysis": r".", BL: r"^(AA[ -]|Artificial Analysis)"}, "noise": {"aa"},
           "overall": ("Artificial Analysis", "Artificial Analysis Intelligence Index", "v5")},
    "3":  {"src": {BL: r"^BenchLM "}, "overall": (BL, "BenchLM Overall", "bench-align-v5")},
    "4":  {"src": {"Humanity's Last Exam (official)": r".", BL: r"^(HLE|Humanity's Last Exam|AA-HLE)"},
           "overall": ("Humanity's Last Exam (official)", "Humanity's Last Exam", "Official (lastexam.ai)")},
    "5":  {"src": {"MMLU-Pro (TIGER-Lab)": r".", BL: r"^(MMLU-Pro|AA MMLU-Pro)"},
           "overall": ("MMLU-Pro (TIGER-Lab)", "MMLU-Pro", "Official leaderboard")},
    "6":  {"src": {"GPQA (official repository)": r".", BL: r"^(GPQA|AA-GPQA)"}, "overall": (BL, "GPQA", None)},
    "7":  {"src": {"OpenAI simple-evals": r"^SimpleQA\|", "Epoch AI": r"^SimpleQA", BL: r"^(SimpleQA|FACTS)"},
           "overall": ("OpenAI simple-evals", "SimpleQA", "OpenAI simple-evals")},
    "8":  {"src": {BL: r"^ARC-AGI"}, "overall": (BL, "ARC-AGI-2", None)},
    "9":  {"src": {"Epoch AI": r"^FrontierMath", BL: r"^FrontierMath"},
           "overall": ("Epoch AI", "FrontierMath", "Tiers 1-3 v2")},
    "10": {"src": {"MathArena (ETH Zurich)": r".", BL: r"^(AIME|AA AIME)"},
           "overall": ("MathArena (ETH Zurich)", "AIME", "2026 (MathArena)")},
    "11": {"src": {"SWE-bench (official)": r".", "SWE-bench Pro (Scale AI open source)": r".",
                   BL: r"^(SWE-bench|SWE Multilingual|SWE Multimodal)"},
           "overall": ("SWE-bench (official)", "SWE-bench", "Verified (official)")},
    "12": {"src": {BL: r"^(LiveCodeBench|AA LiveCodeBench)"}, "overall": (BL, "LiveCodeBench", None)},
    "13": {"src": {"Aider": r"."}, "overall": ("Aider", "Aider Polyglot", "Official leaderboard")},
    "14": {"src": {"Terminal-Bench": r".", BL: r"(?i)^(AA )?terminal-?bench"},
           "overall": ("Terminal-Bench", "Terminal-Bench", "4.1")},
    "15": {"src": {BL: r"^GAIA"}, "overall": (BL, "GAIA", None)},
    "16": {"src": {"tau2-bench (Sierra)": r".", BL: r"^(τ|AA Tau)"}, "overall": None},
    "17": {"src": {"LMArena": r"."}, "overall": ("LMArena", "LMArena", "Text")},
    "18": {"src": {"WildBench (AI2)": r"."}, "overall": ("WildBench (AI2)", "WildBench", "WB-Elo")},
    "19": {"src": {BL: r"^(MMMU|AA-MMMU)"}, "overall": (BL, "MMMU-Pro", None)},
    "20": {"src": {"OCRBench v2": r".", BL: r"^OCRBench"}, "overall": None},
    "21": {"src": {"RULER (NVIDIA)": r".", BL: r"^(MRCR|RULER)"},
           "overall": ("RULER (NVIDIA)", "RULER", "Average (4K-128K)")},
    "22": {"src": {}, "overall": None},
    "23": {"src": {BL: r"^HealthBench"}, "overall": None},
    "24": {"src": {}, "overall": None},
    "25": {"src": {}, "overall": None},
    "26": {"src": {"MMLU (Hendrycks et al.)": r".", "OpenAI simple-evals": r"^MMLU\|", BL: r"^(MMLU|MMLU-Redux|MMMLU)$"},
           "overall": ("MMLU (Hendrycks et al.)", "MMLU", "Original leaderboard")},
    "27": {"src": {BL: r"^GSM8K"}, "overall": (BL, "GSM8K", None)},
    "28": {"src": {"OpenAI simple-evals": r"^HumanEval\|", BL: r"^HumanEval"},
           "overall": ("OpenAI simple-evals", "HumanEval", "OpenAI simple-evals")},
}

FILLER = {"the", "of", "and", "a", "on", "in", "for", "with", "set", "score", "scores", "official", "leaderboard",
          "results", "benchmark", "bench"}


def words(text: str) -> set[str]:
    t = text.lower().replace("&", " and ").replace("’", "'")
    t = re.sub(r"(?<=[a-z])(?=\d)|(?<=\d)(?=[a-z])", " ", t)          # "v5" -> "v 5", "4k" -> "4 k"
    return {w for w in re.split(r"[^a-z0-9.]+", t) if w and w not in FILLER and w != "."}


def main() -> int:
    load_dotenv(ROOT / ".env")
    dsn = os.environ.get("DATABASE_URL", "postgresql://bench:bench@localhost:5432/llm_bench")
    with psycopg.connect(dsn, row_factory=dict_row) as conn:
        db = conn.execute("""
            SELECT s.source_name AS source, b.benchmark_name AS name, b.benchmark_version AS version,
                   count(*)::int AS results
              FROM benchmark_results r JOIN benchmarks b ON b.id = r.benchmark_id JOIN sources s ON s.id = r.source_id
             GROUP BY 1, 2, 3""").fetchall()
    rows = list(csv.DictReader(LIST.open(newline="", encoding="utf-8")))
    overrides = {}
    if OVERRIDES.exists():
        for o in csv.DictReader(OVERRIDES.open(newline="", encoding="utf-8")):
            overrides.setdefault(o["no"], []).append({"source": o["source"], "name": o["benchmark_name"],
                                                     "version": o["benchmark_version"] or None, "method": "override"})

    def ref(b: dict, method: str) -> dict:
        return {"source": b["source"], "name": b["name"], "version": b["version"], "results": b["results"], "method": method}

    out: dict[str, dict] = {}
    report_parent, report_sub = [], []
    for r in rows:
        no = r["No"].strip()
        parent_no = no.split(".")[0]
        cfg = PARENTS.get(parent_no, {"src": {}, "overall": None})
        cands = [b for b in db if b["source"] in cfg["src"]
                 and re.search(cfg["src"][b["source"]], f"{b['name']}|{b['version'] or ''}")]
        if "." not in no:                                   # parent row
            ov = cfg["overall"]
            overall = next((b for b in db if ov and (b["source"], b["name"], b["version"]) == ov), None)
            if ov and not overall:
                raise SystemExit(f"row {no}: overall benchmark {ov} not in the database")
            out[no] = {"no": no, "kind": "parent", "name": r["Name"],
                       "overall": ref(overall, "chosen") if overall else None,
                       "benchmarks": [ref(b, "family") for b in sorted(cands, key=lambda b: (b["source"], b["name"], b["version"] or ""))]}
            report_parent.append([no, r["Name"], len(cands), f"{ov[1]} {ov[2] or ''} ({ov[0]})" if ov else "—"])
            continue
        # sub row: every word of its name must be in the benchmark's name; closest per source wins
        if no in overrides:
            found = []
            for o in overrides[no]:
                b = next((b for b in db if (b["source"], b["name"], b["version"]) == (o["source"], o["name"], o["version"])), None)
                if not b:
                    raise SystemExit(f"benchmark-map-overrides.csv: {o} not in the database")
                found.append(ref(b, "override"))
            out[no] = {"no": no, "kind": "sub", "parent": parent_no, "name": r["Name"], "benchmarks": found}
            report_sub.append([no, r["Name"], "override", "; ".join(f"{f['name']} {f['version'] or ''}" for f in found)])
            continue
        want = words(r["Name"])
        parent_words = words(next((x["Name"] for x in rows if x["No"].strip() == parent_no), ""))
        per_source: dict[str, list] = {}
        for b in cands:
            have = words(f"{b['name']} {b['version'] or ''}")
            extra = have - want - words(b["source"]) - parent_words - cfg.get("noise", set())
            if want and want <= have and not extra:
                per_source.setdefault(b["source"], []).append((len(have - want), b))
        found, ambiguous = [], []
        for src, lst in per_source.items():
            lst.sort(key=lambda x: x[0])
            if len(lst) > 1 and lst[0][0] == lst[1][0]:
                ambiguous.append(f"{src}: " + " | ".join(f"{b['name']} {b['version'] or ''}".strip() for _, b in lst if _ == lst[0][0]))
            else:
                found.append(ref(lst[0][1], "name"))
        out[no] = {"no": no, "kind": "sub", "parent": parent_no, "name": r["Name"], "benchmarks": found}
        report_sub.append([no, r["Name"], "name" if found else ("ambiguous" if ambiguous else "none"),
                           "; ".join(f"{f['name']} {f['version'] or ''} ({f['source']})".replace("  ", " ") for f in found) or " ; ".join(ambiguous)])

    OUT.write_text(json.dumps({"format": "benchmark-map/v1", "rows": out}, indent=1, ensure_ascii=False), encoding="utf-8")
    esc = lambda v: str(v).replace("|", "\\|")
    table = lambda head, rs: "\n".join(["| " + " | ".join(head) + " |", "|" + "---|" * len(head)] +
                                       ["| " + " | ".join(esc(c) for c in x) + " |" for x in rs])
    linked = sum(1 for x in report_sub if x[2] in ("name", "override"))
    REPORT.write_text("\n".join([
        "# Benchmark list ↔ database", "", "Generated by `scripts/build_benchmark_map.py`.", "",
        "## Benchmarks", "", table(["No", "name", "database benchmarks", "overall table"], report_parent), "",
        f"## Sub-benchmarks: {linked} of {len(report_sub)} linked", "",
        "Linked only when every word of the sub-benchmark's name is in the database benchmark's name. "
        "\"none\" usually means the source publishes that number only inside another score (no separate row).", "",
        table(["No", "name", "how", "database benchmark"], report_sub), ""]), encoding="utf-8")
    import collections
    c = collections.Counter(x[2] for x in report_sub)
    print(f"parents {len(report_parent)}, subs {len(report_sub)}: " + ", ".join(f"{k} {v}" for k, v in sorted(c.items())))
    print(f"wrote {OUT.relative_to(ROOT)} and {REPORT.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
