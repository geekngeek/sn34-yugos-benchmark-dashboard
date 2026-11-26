"""Build data/router-benchmarks/benchmarks.json: the router-benchmark research (one entry per benchmark).

    python3 -I scripts/build_router_benchmarks.py /root/subnet_analysis/research

Inputs (made by the router-benchmark research in /root/subnet_analysis/research):
- router_benchmarks_complete_2026-11-26.md: overview table (4 groups A-D, 32 rows).
- router_benchmark_NN_<slug>_2026-11-26.md: one deep-dive file per benchmark (NN = row number).
- router_benchmark_00_index_2026-11-26.md: one-line key finding per benchmark.
- data/router-benchmarks/model_pools.json (in this repo, curated by hand from the write-ups' "Models"
  sections): the exact model names per benchmark and the pool size, shown as model tags.
- router_benchmark_public_fields_2026-11-26.md: which per-question fields are public
  (Prompt, Model, Answer, Score, Cost, Tokens, Effort: Yes / Partial / No / ?) and the licence.

Nothing is fetched here. Re-run after the research files change.
"""
from __future__ import annotations

import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "data" / "router-benchmarks" / "benchmarks.json"
POOLS = OUT.with_name("model_pools.json")
DATE = "2026-11-26"

GROUPS = {
    "A": "Router benchmark (stored answers)",
    "B": "Live arena / audit",
    "C": "Single-model per-question data",
    "D": "Agentic (tau2) and effort",
}

LINK = re.compile(r"\[([^\]]+)\]\(([^)]+)\)")


def cells(line: str) -> list[str]:
    return [c.strip() for c in line.strip().strip("|").split("|")]


def plain(md: str) -> str:
    """markdown cell -> plain text (links keep their label, bold markers dropped)"""
    return LINK.sub(r"\1", md).replace("**", "").strip()


def links(md: str) -> list[dict]:
    return [{"label": m.group(1), "url": m.group(2)} for m in LINK.finditer(md) if m.group(2).startswith("http")]


def usefulness(text: str) -> str:
    t = text.lower()
    if t.startswith("no"):
        return "No"
    if t.startswith("high"):
        return "High"
    if t.startswith("medium"):
        return "Medium"
    if t.startswith("low–medium") or t.startswith("low-medium"):
        return "Low–Medium"
    if t.startswith("low"):
        return "Low"
    return "?"


def newest(text: str) -> str:
    t = text.lower()
    if t.startswith("yes"):
        return "Yes"
    if t.startswith("partly"):
        return "Partly"
    if t.startswith("no"):
        return "No"
    return "Unknown"


def parse_overview(path: Path) -> list[dict]:
    rows: list[dict] = []
    group = None
    header: list[str] = []
    for line in path.read_text().splitlines():
        m = re.match(r"^## ([A-D])\.", line)
        if m:
            group, header = m.group(1), []
            continue
        if not group or not line.startswith("|"):
            continue
        c = cells(line)
        if not header:
            header = [h.lower() for h in c]
            continue
        if set(line.replace("|", "").strip()) <= {"-", " ", ":"}:
            continue
        rec = dict(zip(header, c))
        num = int(rec.get("#", "0") or 0)
        name_md = rec.get("benchmark") or rec.get("source") or ""
        link_md = rec.get("link", "")
        rows.append({
            "num": num,
            "group": group,
            "group_label": GROUPS[group],
            "name": plain(name_md),
            "creators": plain(rec.get("creators / year") or rec.get("creators") or ""),
            "scale": plain(rec.get("scale", "")),
            "models": plain(rec.get("model pool", "")),
            "focus": plain(rec.get("focus / type") or rec.get("what is stored") or ""),
            "newest_raw": plain(rec.get("newest models?", "")),
            "newest": newest(plain(rec.get("newest models?", ""))),
            "yugos_raw": plain(rec.get("useful for yugos?", "")),
            "yugos": usefulness(plain(rec.get("useful for yugos?", ""))),
            "links": links(link_md) + links(name_md),
            "link_text": plain(link_md),
        })
    return rows


def parse_index(path: Path) -> dict[int, str]:
    out: dict[int, str] = {}
    for line in path.read_text().splitlines():
        m = re.match(r"^- \[(\d\d) [^\]]+\]\([^)]+\) — (.+)$", line)
        if m:
            out[int(m.group(1))] = plain(m.group(2))
    return out


PUBLIC_FIELDS = ["Prompt", "Model", "Answer", "Score", "Cost", "Tokens", "Effort"]
NOTE = re.compile(r"^\s*(Yes|Partial|No|\?)\s*(?:\((.*)\))?\s*$", re.S)


def parse_public(path: Path) -> dict[int, dict]:
    """row number -> {"name", "fields": {field: {"status", "note"}}, "licence"}"""
    out: dict[int, dict] = {}
    if not path.exists():
        return out
    header: list[str] = []
    for line in path.read_text().splitlines():
        if not line.startswith("|"):
            header = []
            continue
        c = cells(line)
        if not header:
            header = c
            continue
        if set(line.replace("|", "").strip()) <= {"-", " ", ":"}:
            continue
        rec = dict(zip(header, c))
        if not rec.get("#", "").isdigit():
            continue
        fields = {}
        for f in PUBLIC_FIELDS:
            raw = plain(rec.get(f, "?")) or "?"
            m = NOTE.match(raw)
            # "No (price table only)" -> status No, note "price table only"; anything odd keeps its text as the note
            fields[f] = {"status": m.group(1), "note": (m.group(2) or "").strip()} if m else {"status": "?", "note": raw}
        out[int(rec["#"])] = {"name": plain(rec.get("Benchmark", "")), "fields": fields,
                              "licence": plain(rec.get("Licence", "")) or "?"}
    return out


def main(research: str) -> None:
    root = Path(research)
    rows = parse_overview(root / f"router_benchmarks_complete_{DATE}.md")
    findings = parse_index(root / f"router_benchmark_00_index_{DATE}.md")
    pools = json.loads(POOLS.read_text())["pools"] if POOLS.exists() else {}
    public = parse_public(root / f"router_benchmark_public_fields_{DATE}.md")
    files = {int(p.name[17:19]): p for p in root.glob(f"router_benchmark_[0-9][0-9]_*_{DATE}.md") if p.name[17:19] != "00"}

    for r in rows:
        f = files.get(r["num"])
        r["finding"] = findings.get(r["num"], "")
        r["file"] = f.name if f else None
        r["detail_md"] = f.read_text() if f else ""
        r["pool"] = pools.get(str(r["num"]))
        pub = public.get(r["num"])
        r["public"] = pub["fields"] if pub else None
        r["licence"] = pub["licence"] if pub else None
        if pub and pub["name"].split()[0].lower()[:5] not in r["name"].lower():
            print(f"warning: public-fields row {r['num']} is {pub['name']!r}, overview row is {r['name']!r}")

    missing = [r["num"] for r in rows if not r["file"]]
    doc = {
        "built_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "research_date": DATE,
        "source_dir": str(root),
        "groups": GROUPS,
        "benchmarks": sorted(rows, key=lambda r: r["num"]),
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    tmp = OUT.with_suffix(".tmp")
    tmp.write_text(json.dumps(doc, ensure_ascii=False, indent=1))
    tmp.replace(OUT)
    no_public = [r["num"] for r in rows if not r["public"]]
    no_pool = [r["num"] for r in rows if not r["pool"]]
    print(f"wrote {OUT}: {len(rows)} benchmarks" + (f"; no detail file for {missing}" if missing else "")
          + (f"; no public-fields row for {no_public}" if no_public else "")
          + (f"; no model pool for {no_pool}" if no_pool else ""))


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
