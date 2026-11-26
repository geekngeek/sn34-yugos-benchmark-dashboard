"""Build data/models/registry.csv, aliases.csv and yugos-links.csv from every source's model names.

    .venv/bin/python -I scripts/build_model_registry.py

1. Every data/*.json file is parsed (no database) and each raw model name is split by
   importer/model_ids.parse_raw into base name, effort, mode, snapshot.
2. One model = all raw names whose base names share a strict key; groups whose names differ only by
   separators (same compact key, e.g. "HunyuanTurboS" / "Hunyuan TurboS") are joined and reported.
3. data/models/overrides.csv (raw name -> model_id, with a reason) wins over the rules.
4. Yugos models (data/yugos/models.json) are linked: strict key "exact"; a dated offer of an already linked
   model ("gpt-4o-2024-08-06") "same-model"; loose key "loose" only when exactly one model has it.
5. Model IDs: linked to Yugos -> vendor/<yugos name>; otherwise vendor/<slug of the most used name>.
"""
from __future__ import annotations

import collections
import csv
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from importer import artificial_analysis, benchlm, generic, livebench  # noqa: E402
from importer.model_ids import compact_key, loose_key, model_id, parse_raw, strict_key, vendor_slug  # noqa: E402
from importer.normalize import infer_provider  # noqa: E402

OUT = ROOT / "data" / "models"
PARSERS = {
    "LiveBench": lambda d: livebench.parse(d, include_hidden=False),
    "Artificial Analysis": lambda d: artificial_analysis.parse(d),
    "BenchLM": lambda d: benchlm.parse(d, include_systems=False),
}


def collect() -> list[dict]:
    """One row per parsed result: source, raw model name, provider."""
    rows = []
    for f in sorted((ROOT / "data").glob("*.json")):
        doc = json.loads(f.read_text(encoding="utf-8"))
        if doc.get("format") == generic.FORMAT:
            parsed = generic.parse(doc)
        elif (doc.get("source") or {}).get("name") in PARSERS:
            parsed = PARSERS[doc["source"]["name"]](doc)
        else:
            continue
        for item in parsed.items:
            for r in item.results:
                rows.append({"source": parsed.source.name, "kind": "result",
                             "raw": (r.model.aliases or [r.model.model_name])[0], "provider": r.model.provider})
            for pr in item.prices:           # priced models need IDs too, even without any score
                rows.append({"source": parsed.source.name, "kind": "price",
                             "raw": (pr.model.aliases or [pr.model.model_name])[0], "provider": pr.model.provider})
    return rows


def load_overrides() -> dict[str, dict]:
    path = OUT / "overrides.csv"
    if not path.exists():
        return {}
    return {r["raw_name"]: r for r in csv.DictReader(path.open(newline="", encoding="utf-8"))
            if r.get("raw_name") and not r["raw_name"].startswith("#")}


class Groups:
    """Union-find over model keys."""
    def __init__(self):
        self.parent: dict[str, str] = {}

    def add(self, k: str) -> None:
        self.parent.setdefault(k, k)

    def find(self, k: str) -> str:
        while self.parent[k] != k:
            self.parent[k] = self.parent[self.parent[k]]
            k = self.parent[k]
        return k

    def join(self, a: str, b: str) -> None:
        ra, rb = self.find(a), self.find(b)
        if ra != rb:
            self.parent[max(ra, rb)] = min(ra, rb)


def main() -> None:
    rows = collect()
    overrides = load_overrides()
    yugos = json.loads((ROOT / "data" / "yugos" / "models.json").read_text())["models"]

    # ---- 1. every (source, raw name): parsed config and its model key -----------------------------
    aliases: dict[tuple[str, str], dict] = {}
    for r in rows:
        k = (r["source"], r["raw"])
        if k in aliases:
            aliases[k]["results"] += r["kind"] == "result"
            aliases[k]["providers"][r["provider"]] += 1
            continue
        p = parse_raw(r["raw"])
        ov = overrides.get(r["raw"]) or overrides.get(p.base)     # a raw name, or the base name it parses to
        aliases[k] = {"source": r["source"], "raw_name": r["raw"], "base": p.base, "key": strict_key(p.base),
                      "system": p.system,
                      "override_id": (ov or {}).get("model_id", ""),
                      # override effort "-" = no effort (e.g. a separate *-Thinking model written like a setting)
                      "effort": "" if (ov or {}).get("effort") == "-" else (ov or {}).get("effort") or p.effort or "",
                      "mode": (ov or {}).get("mode") or p.mode_str or "",
                      "snapshot": p.snapshot or "", "notes": "; ".join(p.notes),
                      "override": (ov or {}).get("reason", "") if ov else "", "results": int(r["kind"] == "result"),
                      "providers": collections.Counter([r["provider"]])}

    # ---- 2. models: strict key groups, joined when only separators differ ------------------------
    uf = Groups()
    compact_first: dict[str, str] = {}
    joined: list[tuple[str, str]] = []
    for a in aliases.values():
        uf.add(a["key"])
        ck = compact_key(a["base"])
        if ck in compact_first and uf.find(compact_first[ck]) != uf.find(a["key"]):
            joined.append((compact_first[ck], a["key"]))
            uf.join(compact_first[ck], a["key"])
        compact_first.setdefault(ck, a["key"])
    groups: dict[str, dict] = {}
    for a in aliases.values():
        root = uf.find(a["key"])
        a["group"] = root
        g = groups.setdefault(root, {"names": collections.Counter(), "providers": collections.Counter(), "sources": set(),
                                     "system": False})
        g["system"] |= a["system"]
        g["names"][a["base"]] += a["results"]
        g["sources"].add(a["source"])
        g["providers"].update({prov: n for prov, n in a["providers"].items() if prov and prov != "Unknown"})

    # ---- 3. link Yugos models --------------------------------------------------------------------------
    by_strict = {}
    by_loose = collections.defaultdict(set)
    for root, g in groups.items():
        for name in g["names"]:
            by_strict.setdefault(strict_key(name), root)
            by_loose[loose_key(name)].add(root)

    links: dict[str, dict] = {}            # group -> the Yugos model that names it
    yrows = []
    for m in yugos:
        p = parse_raw(m["model"])
        sk, lk = strict_key(p.base), loose_key(p.base)
        how, target, note = "", "", ""
        if sk in by_strict:
            target = by_strict[sk]
            how = "same-model" if target in links else "exact"
            if how == "same-model":
                note = f"same model as {links[target]['model']}" + (f" (snapshot {p.snapshot})" if p.snapshot else "")
        else:
            cands = sorted(c for c in by_loose.get(lk, ()) if c not in links)
            if len(cands) == 1:
                how, target = "loose", cands[0]
            elif len(cands) > 1:
                note = "ambiguous: " + " | ".join(next(iter(groups[c]["names"])) for c in cands)
        if target and target not in links:
            links[target] = {"model": m["model"], "vendor": m["vendor"], "how": how}
        yrows.append({"yugos_model": m["model"], "vendor": m["vendor"], "link": how or "none", "group": target, "note": note})

    # ---- 4. model IDs per group --------------------------------------------------------------------------
    group_id: dict[str, str] = {}
    collisions: dict[str, str] = {}
    for root in sorted(groups):
        g = groups[root]
        display = sorted(g["names"].items(), key=lambda kv: (-kv[1], kv[0]))[0][0]
        label = g["providers"].most_common(1)[0][0] if g["providers"] else (infer_provider(display) or "Unknown")
        if g["system"]:
            label = "System"                 # several models working together: system/<names>
        if root in links:
            yv = links[root]["vendor"]
            # the model ID leaves out a Yugos name's snapshot date (command-r-08-2024 -> command-r)
            yp = parse_raw(links[root]["model"])
            mid = f"{vendor_slug(label if yv == 'Other' else yv)}/{yp.base if yp.snapshot else links[root]['model']}"
        else:
            mid = model_id(label, display)
        if mid in group_id.values():         # two different models would get one ID: keep them apart
            n = 2
            while f"{mid}-{n}" in group_id.values():
                n += 1
            collisions[f"{mid}-{n}"] = f"{mid} was taken by another model"
            mid = f"{mid}-{n}"
        group_id[root] = mid
    yugos_id = {}
    for y in yrows:
        if y["group"]:
            y["model_id"] = group_id[y["group"]]
        else:
            vend = y["vendor"] if y["vendor"] != "Other" else (infer_provider(y["yugos_model"]) or "Other")
            y["model_id"] = f"{vendor_slug(vend)}/{y['yugos_model']}"
        yugos_id.setdefault(y["model_id"], y)

    # ---- 5. overrides: move raw names onto an existing model ID (or a Yugos model without data) -----------
    for a in aliases.values():
        a["model_id"] = group_id[a["group"]]
        if a["override_id"]:
            if a["override_id"] not in set(group_id.values()) | set(yugos_id):
                raise SystemExit(f"overrides.csv: {a['raw_name']!r} -> {a['override_id']!r} is not a known model ID")
            a["model_id"] = a["override_id"]
    for mid, y in yugos_id.items():
        if y["link"] == "none" and any(a["model_id"] == mid for a in aliases.values()):
            y["link"], y["note"] = "override", "linked through overrides.csv"

    # ---- 6. registry: one row per final model ID ----------------------------------------------------------
    by_id: dict[str, list] = collections.defaultdict(list)
    for a in aliases.values():
        by_id[a["model_id"]].append(a)
    registry: dict[str, dict] = {}
    for mid, items in by_id.items():
        names = collections.Counter()
        provs = collections.Counter()
        for a in items:
            names[a["base"]] += a["results"]
            provs.update({p: n for p, n in a["providers"].items() if p and p != "Unknown"})
        display = sorted(names.items(), key=lambda kv: (-kv[1], kv[0]))[0][0]
        y = yugos_id.get(mid)
        is_system = any(a["system"] for a in items)
        registry[mid] = {"model_id": mid,
                         "vendor": "System" if is_system else provs.most_common(1)[0][0] if provs else (infer_provider(display) or "Unknown"),
                         "display_name": display, "yugos_model": y["yugos_model"] if y else "", "yugos_link": y["link"] if y else "",
                         "strict_key": strict_key(display), "loose_key": loose_key(display), "compact_key": compact_key(display),
                         "sources": " | ".join(sorted({a["source"] for a in items})), "raw_names": " | ".join(sorted(names)),
                         "collision": collisions.get(mid, "")}
    for mid, y in yugos_id.items():
        registry.setdefault(mid, {"model_id": mid, "vendor": y["vendor"], "display_name": y["yugos_model"],
                                  "yugos_model": y["yugos_model"], "yugos_link": "yugos-only",
                                  "strict_key": strict_key(y["yugos_model"]), "loose_key": loose_key(y["yugos_model"]),
                                  "compact_key": compact_key(y["yugos_model"]), "sources": "", "raw_names": "", "collision": ""})

    # ---- 5. write ------------------------------------------------------------------------------------------
    OUT.mkdir(parents=True, exist_ok=True)
    def write(name, cols, items):
        with (OUT / name).open("w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, cols, extrasaction="ignore")
            w.writeheader()
            w.writerows(items)
    write("registry.csv", ["model_id", "vendor", "display_name", "yugos_model", "yugos_link", "strict_key", "loose_key",
                           "compact_key", "sources", "raw_names", "collision"], [registry[k] for k in sorted(registry)])
    write("aliases.csv", ["source", "raw_name", "model_id", "effort", "mode", "snapshot", "notes", "base", "match",
                          "override", "results"],
          [{**a, "match": "override" if a["override_id"] else f"yugos-{links[a['group']]['how']}" if a["group"] in links else "rule"}
           for _, a in sorted(aliases.items())])
    write("yugos-links.csv", ["yugos_model", "vendor", "link", "model_id", "note"], yrows)
    write("joined-by-spelling.csv", ["kept", "joined"],
          [{"kept": " | ".join(groups[uf.find(a)]["names"]), "joined": b} for a, b in joined])

    c = collections.Counter(y["link"] for y in yrows)
    print(f"raw names {len(aliases)} (in {sum(r['kind'] == 'result' for r in rows)} results and "
          f"{sum(r['kind'] == 'price' for r in rows)} prices) -> {len(groups)} models with data; registry {len(registry)}")
    print("yugos links: " + ", ".join(f"{k} {v}" for k, v in sorted(c.items())))
    print(f"joined by spelling: {len(joined)}, raw names moved by overrides: {sum(1 for a in aliases.values() if a['override_id'])} "
          f"(rules {len(overrides)}), id collisions: {sum(1 for r in registry.values() if r['collision'])}")
    unused = sorted(set(overrides) - {a["raw_name"] for a in aliases.values()} - {a["base"] for a in aliases.values()})
    if unused:
        print("overrides with no such raw name:", unused)


if __name__ == "__main__":
    main()
