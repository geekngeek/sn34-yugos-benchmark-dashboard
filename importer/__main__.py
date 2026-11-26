"""Import benchmark JSON files into the database.

    python -m importer data/livebench.json data/artificial_analysis.json data/benchlm.json
    python -m importer data/livebench.json --dry-run      # report only, writes nothing
    python -m importer data/livebench.json --replace      # delete that source's data first

The file format is detected from its "format" field ("benchmark-results/v1", e.g.
data/hle.json, data/mmlu_pro.json, data/gpqa.json) or else its "source.name".
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

from api.config import PROJECT_ROOT, load_dotenv

from . import artificial_analysis, benchlm, generic, livebench
from .writer import connect, write

PARSERS = {
    "LiveBench": lambda doc, args: livebench.parse(doc, include_hidden=args.include_hidden),
    "Artificial Analysis": lambda doc, args: artificial_analysis.parse(doc),
    "BenchLM": lambda doc, args: benchlm.parse(doc, include_systems=args.include_benchmark_systems),
}


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m importer", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("files", nargs="+", type=Path, help="JSON files to import")
    ap.add_argument("--dry-run", action="store_true", help="run the import, then roll it back")
    ap.add_argument("--replace", action="store_true",
                    help="delete the source's existing results, prices and raw records first")
    ap.add_argument("--include-hidden", action="store_true",
                    help="LiveBench: also import rows the site hides (not in its model catalog)")
    ap.add_argument("--include-benchmark-systems", action="store_true",
                    help="BenchLM: also import benchmark/decision-system entries (e.g. 'GPT-4 (JudgeBench)')")
    ap.add_argument("--database-url", help="defaults to DATABASE_URL from the environment or .env")
    args = ap.parse_args(argv)

    load_dotenv(PROJECT_ROOT / ".env")
    dsn = args.database_url or os.environ.get("DATABASE_URL", "postgresql://bench:bench@localhost:5432/llm_bench")

    parsed_files = []
    for path in args.files:
        try:
            doc = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            print(f"{path}: cannot read JSON ({exc})", file=sys.stderr)
            return 2
        if doc.get("format") == generic.FORMAT:
            parsed_files.append((path, generic.parse(doc)))
            continue
        name = (doc.get("source") or {}).get("name")
        if name not in PARSERS:
            print(f"{path}: unknown format (source.name = {name!r}); supported: {', '.join(PARSERS)}",
                  file=sys.stderr)
            return 2
        parsed_files.append((path, PARSERS[name](doc, args)))

    with connect(dsn) as conn:
        for path, parsed in parsed_files:
            stats = write(conn, parsed, replace=args.replace, dry_run=args.dry_run)
            print(f"{path}{' (dry run, rolled back)' if args.dry_run else ''}")
            print(stats.summary())
    return 0


if __name__ == "__main__":
    sys.exit(main())
