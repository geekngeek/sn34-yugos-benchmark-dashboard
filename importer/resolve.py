"""Resolve a source's model name to the project model ID and run configuration.

Uses data/models/aliases.csv (every known raw name, built by scripts/build_model_registry.py, including
overrides.csv decisions) and data/models/registry.csv (display name and vendor per model ID).
A name not in the alias table is resolved with the same rules (importer/model_ids.py): to the model
whose names share its strict key, or else to a new ID. Those are counted as "unlisted" so the next
registry build (and review) picks them up.
"""
from __future__ import annotations

import csv
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from .model_ids import model_id, parse_raw, strict_key
from .normalize import infer_provider

DATA = Path(__file__).resolve().parent.parent / "data" / "models"


@dataclass(frozen=True)
class Resolved:
    model_id: str
    display_name: str
    vendor: str
    effort: str | None
    mode: str | None
    snapshot: str | None
    match: str          # rule | yugos-exact | yugos-loose | yugos-same-model | override | unlisted


class Resolver:
    def __init__(self, data_dir: Path = DATA):
        self.by_source: dict[tuple[str, str], dict] = {}
        self.by_raw: dict[str, dict] = {}
        self.by_key: dict[str, str] = {}
        self.registry: dict[str, dict] = {}
        reg = data_dir / "registry.csv"
        ali = data_dir / "aliases.csv"
        if reg.exists():
            self.registry = {r["model_id"]: r for r in csv.DictReader(reg.open(newline="", encoding="utf-8"))}
        if ali.exists():
            for r in csv.DictReader(ali.open(newline="", encoding="utf-8")):
                self.by_source[(r["source"], r["raw_name"])] = r
                self.by_raw.setdefault(r["raw_name"], r)
                if r["match"] != "override":
                    self.by_key.setdefault(strict_key(r["base"]), r["model_id"])

    def resolve(self, source: str, raw: str, provider: str | None) -> Resolved:
        a = self.by_source.get((source, raw)) or self.by_raw.get(raw)
        if a:
            reg = self.registry.get(a["model_id"], {})
            return Resolved(a["model_id"], reg.get("display_name") or a["base"], reg.get("vendor") or provider or "Unknown",
                            a["effort"] or None, a["mode"] or None, a["snapshot"] or None, a["match"])
        p = parse_raw(raw)
        mid = self.by_key.get(strict_key(p.base))
        if mid:
            reg = self.registry.get(mid, {})
            return Resolved(mid, reg.get("display_name") or p.base, reg.get("vendor") or provider or "Unknown",
                            p.effort, p.mode_str, p.snapshot, "unlisted")
        vendor = "System" if p.system else provider if provider and provider != "Unknown" else (infer_provider(p.base) or "Unknown")
        return Resolved(model_id(vendor, p.base), p.base, vendor, p.effort, p.mode_str, p.snapshot, "unlisted")


@lru_cache(maxsize=1)
def default_resolver() -> Resolver:
    return Resolver()
