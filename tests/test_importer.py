"""Importer tests against a throwaway database (llm_bench_import_test).

Small hand-written JSON documents in the same format as data/*.json.
The real llm_bench database is never touched. Skipped when PostgreSQL is down.
"""
from __future__ import annotations

import copy
import json
import os
from pathlib import Path

import psycopg
import pytest

from importer import artificial_analysis, benchlm, generic, livebench
from importer.__main__ import main
from importer.normalize import canonical_key, split_effort
from importer.writer import connect, write

ROOT = Path(__file__).resolve().parent.parent
ADMIN_URL = os.environ.get("TEST_ADMIN_DATABASE_URL", "postgresql://bench:bench@localhost:5432/postgres")
TEST_DB = "llm_bench_import_test"
TEST_URL = ADMIN_URL.rsplit("/", 1)[0] + "/" + TEST_DB


def lb_model(key, display, org, overall, cats, *, effort=None, shown=True, cost=None):
    m = {"rank": None, "model_key": key, "display_name": display, "organization": org,
         "shown_on_site": shown, "in_default_view": shown, "overall": overall,
         "category_scores": cats, "task_scores": {}, "reasoner": True}
    if effort:
        m["effort"] = effort
    if cost:
        m["cost"] = cost
    return m


LB_DOC = {
    "source": {"name": "LiveBench", "site": "https://livebench.ai", "collected_at": "2026-11-25T16:00:00+00:00",
               "description": "test"},
    "releases": [
        {"release_id": "20261106", "release_date": "2026-11-06", "generation": "2.0",
         "page_url": "https://livebench.ai/", "overall_method": "weighted mean",
         "overall_weights": {"Coding": 1.5, "Reasoning": 1.0},
         "categories": [{"name": "Coding", "columns": ["coding"], "subcategories": [{"name": "Bug fixes", "tasks": 24}]},
                        {"name": "Reasoning", "columns": ["reasoning"], "subcategories": []}],
         "models": [
             lb_model("claude-fable-5.2", "Claude Fable 5.2 (xhigh)", "Anthropic", 84.9,
                      {"Coding": 79.2, "Reasoning": 88.8}, effort="xhigh",
                      cost={"cost_per_task_usd": 2.5, "tasks_costed": 24,
                            "by_column": {"coding": {"total_cost_usd": 60.0, "tasks": 24, "avg_output_tokens": 1000}}}),
             lb_model("gpt-6.2-astra", "GPT-6.2 Astra", "OpenAI", 80.0, {"Coding": 82.0, "Reasoning": None}, effort="max"),
             lb_model("mystery-model", "mystery-model", None, 50.0, {"Coding": 50.0}, shown=False),
         ]},
        {"release_id": "2026-06-25", "release_date": "2026-06-25", "generation": "1.0",
         "page_url": "https://livebench.ai/#/release/2026-06-25", "overall_method": "mean",
         "overall_weights": {"Mathematics": 1.0},
         "categories": [{"name": "Mathematics", "columns": ["AMPS_Hard", "olympiad"]}],
         "models": [
             {**lb_model("claude-fable-5-2-max-effort", "Claude Fable 5.2 Max Effort", "Anthropic", 83.0,
                         {"Mathematics": 90.0}), "task_scores": {"AMPS_Hard": 95.0, "olympiad": 85.0}},
         ]},
    ],
}

AA_DOC = {
    "source": {"name": "Artificial Analysis", "site": "https://artificialanalysis.ai/",
               "attribution": "Data: Artificial Analysis", "api_endpoint": "https://example.invalid/free",
               "intelligence_index_version": 5, "collected_at": "2026-11-25T16:26:00+00:00"},
    "models": [
        {"intelligence_index_rank": 1, "id": "aa-1", "slug": "claude-fable-5-2", "name": "Claude Fable 5.2 (Max)",
         "base_name": "Claude Fable 5.2", "reasoning_effort": "max", "variant_label": "Max",
         "creator": {"id": "c1", "name": "Anthropic"}, "release_date": "2026-09-01",
         "intelligence_index": 64.8, "capability_indices": {"legal": 70.1, "economics": None},
         "intelligence_index_cost_usd": {"total": 900.0, "per_task": 0.5},
         "pricing_usd_per_1m_tokens": {"input": 8.0, "output": 40.0, "blended_3_to_1_computed": 16.0},
         "performance": {"output_tokens_per_second": 60.0, "time_to_first_token_seconds": 2.0}},
        {"intelligence_index_rank": 2, "id": "aa-2", "slug": "claude-fable-5-2-high", "name": "Claude Fable 5.2 (High)",
         "base_name": "Claude Fable 5.2", "reasoning_effort": "high", "variant_label": "High",
         "creator": {"id": "c1", "name": "Anthropic"}, "release_date": "2026-09-01",
         "intelligence_index": 61.9, "capability_indices": {},
         "pricing_usd_per_1m_tokens": {"input": 8.0, "output": 40.0}, "performance": None},
        {"intelligence_index_rank": None, "id": "aa-3", "slug": "old-model", "name": "Old Model",
         "base_name": "Old Model", "reasoning_effort": None, "creator": {"id": "c2", "name": "Z AI"},
         "release_date": None, "intelligence_index": None, "capability_indices": {},
         "pricing_usd_per_1m_tokens": {"input": 0.1, "output": 0.2}, "performance": None},
        {"intelligence_index_rank": None, "id": "aa-4", "slug": "empty", "name": "Empty", "base_name": "Empty",
         "creator": {"id": "c3", "name": "X"}, "intelligence_index": None, "capability_indices": {},
         "pricing_usd_per_1m_tokens": None, "performance": None},
    ],
}


@pytest.fixture()
def conn():
    try:
        admin = psycopg.connect(ADMIN_URL, autocommit=True, connect_timeout=3)
    except psycopg.OperationalError:
        pytest.skip("PostgreSQL not reachable")
    with admin:
        admin.execute(f"DROP DATABASE IF EXISTS {TEST_DB} WITH (FORCE)")
        admin.execute(f"CREATE DATABASE {TEST_DB}")
    with psycopg.connect(TEST_URL, autocommit=True) as c:
        for f in sorted((ROOT / "db" / "init").glob("*.sql")):
            c.execute(f.read_text())
    c = connect(TEST_URL)
    yield c
    c.close()


def count(conn, table):
    return conn.execute(f"SELECT COUNT(*) AS n FROM {table}").fetchone()["n"]


def test_name_normalization():
    assert split_effort("Claude 5.5 Opus Thinking xHigh Effort") == ("Claude 5.5 Opus", "xhigh")
    assert split_effort("Claude Fable 5.2 (xhigh)") == ("Claude Fable 5.2", "xhigh")
    assert split_effort("Gemini 3.7 Flash High") == ("Gemini 3.7 Flash", "high")
    assert split_effort("Qwen3.8 Max") == ("Qwen3.8 Max", None)
    assert split_effort("Mistral Medium") == ("Mistral Medium", None)
    assert split_effort("Gemini 2.5 Flash (Sep '25)") == ("Gemini 2.5 Flash (Sep '25)", None)
    assert canonical_key("Claude 5.5 Opus") == canonical_key("Claude Opus 5.5")
    assert canonical_key("Claude 4.5 Opus") == canonical_key("claude-opus-4-5-20251101")
    assert canonical_key("Qwen3.8 Max") == canonical_key("Qwen 3.8 Max") == canonical_key("qwen3-8-max")
    assert canonical_key("GPT 4o") == canonical_key("gpt-4o")
    assert canonical_key("Mistral Large 4") == canonical_key("mistral-large-4-0")
    assert canonical_key("GPT 5.2") == canonical_key("gpt-5.2-2025-12-11")
    # different versions must never merge
    keys = [canonical_key(n) for n in ("GPT-5", "GPT-5.5", "GPT-5.4", "GPT-4.5", "Claude 5 Opus", "Claude 5.5 Opus")]
    assert len(set(keys)) == len(keys)


def test_livebench_import_and_reimport(conn):
    stats = write(conn, livebench.parse(LB_DOC))
    assert stats.results == {"inserted": 7}           # 3 + 2 + 2; hidden row and null Reasoning skipped
    rows = conn.execute("""SELECT benchmark_version, model_name, reasoning_effort, benchmark_score,
                                  evaluation_date::text AS d, cost_per_task_usd, total_tasks, additional_metrics
                             FROM v_benchmark_records ORDER BY benchmark_version, model_name, d""").fetchall()
    versions = {r["benchmark_version"] for r in rows}
    assert versions == {"2.0 Overall", "2.0 Coding", "2.0 Reasoning", "1.0 Overall", "1.0 Mathematics"}
    coding = next(r for r in rows if r["benchmark_version"] == "2.0 Coding" and r["model_name"] == "Claude Fable 5.2")
    assert coding["reasoning_effort"] == "xhigh" and coding["d"] == "2026-11-06"
    assert coding["cost_per_task_usd"] == pytest.approx(2.5) and coding["total_tasks"] == 24
    math = next(r for r in rows if r["benchmark_version"] == "1.0 Mathematics")
    assert math["reasoning_effort"] == "max" and math["additional_metrics"]["task_scores"]["olympiad"] == 85.0
    # 2.0 "Claude Fable 5.2 (xhigh)" and 1.0 "Claude Fable 5.2 Max Effort" are one model
    assert count(conn, "models") == 2
    again = write(conn, livebench.parse(LB_DOC))
    assert again.results == {"unchanged": 7} and again.raw_new == 0


def test_cross_source_and_price_history(conn):
    write(conn, livebench.parse(LB_DOC))
    stats = write(conn, artificial_analysis.parse(AA_DOC))
    assert stats.results == {"inserted": 3} and stats.prices == {"inserted": 2}
    # AA "Claude Fable 5.2" joined the LiveBench model; "Empty" (no data) was not created
    m = conn.execute("SELECT aliases FROM models WHERE model_name = 'Claude Fable 5.2'").fetchone()
    assert {"Claude Fable 5.2 (Max)", "claude-fable-5.2", "Claude Fable 5.2 Max Effort"} <= set(m["aliases"])
    assert count(conn, "models") == 3
    assert conn.execute("SELECT provider FROM models WHERE model_name = 'Old Model'").fetchone()["provider"] == "Z.ai"
    idx = conn.execute("""SELECT benchmark_version, reasoning_effort, tokens_per_sec, cost_per_task_usd, input_token_price
                            FROM v_benchmark_records WHERE benchmark_name = 'Artificial Analysis Intelligence Index'
                           ORDER BY benchmark_score DESC""").fetchall()
    assert idx[0] == {"benchmark_version": "v5", "reasoning_effort": "max", "tokens_per_sec": 60.0,
                      "cost_per_task_usd": 0.5, "input_token_price": 8.0}

    # a later collection: one score and one price changed
    later = copy.deepcopy(AA_DOC)
    later["source"]["collected_at"] = "2026-12-10T10:00:00+00:00"
    later["models"][0]["intelligence_index"] = 66.0
    later["models"][0]["pricing_usd_per_1m_tokens"]["input"] = 6.0
    stats = write(conn, artificial_analysis.parse(later))
    assert stats.results["inserted"] == 1 and stats.results["unchanged"] == 2      # new snapshot only for 66.0
    assert stats.prices == {"inserted": 1, "unchanged": 1}
    hist = conn.execute("""SELECT effective_from::text AS f, effective_to::text AS t, input_token_price AS p
                             FROM model_pricing p JOIN models m ON m.id = p.model_id
                            WHERE m.model_name = 'Claude Fable 5.2' ORDER BY effective_from""").fetchall()
    assert hist == [{"f": "2026-11-25", "t": "2026-12-09", "p": 8.0}, {"f": "2026-12-10", "t": None, "p": 6.0}]


def test_dry_run_writes_nothing(conn):
    stats = write(conn, livebench.parse(LB_DOC), dry_run=True)
    assert stats.results == {"inserted": 7}
    assert count(conn, "benchmark_results") == 0 and count(conn, "sources") == 0 and count(conn, "models") == 0


def test_replace_removes_old_rows(conn):
    write(conn, livebench.parse(LB_DOC))
    smaller = copy.deepcopy(LB_DOC)
    smaller["releases"] = smaller["releases"][:1]
    smaller["releases"][0]["models"] = smaller["releases"][0]["models"][:1]
    stats = write(conn, livebench.parse(smaller), replace=True)
    assert stats.deleted["benchmark_results"] == 7 and stats.results == {"inserted": 3}
    assert count(conn, "benchmark_results") == 3
    assert count(conn, "models") == 1 and count(conn, "benchmarks") == 3    # orphans removed


def test_invalid_scores_are_skipped(conn):
    bad = copy.deepcopy(LB_DOC)
    bad["releases"][0]["models"][1]["category_scores"]["Coding"] = 120.0
    stats = write(conn, livebench.parse(bad))
    assert len(stats.invalid) == 1 and "outside 0-100" in stats.invalid[0]
    assert stats.results == {"inserted": 6}


def test_cli(conn, tmp_path, capsys):
    f = tmp_path / "lb.json"
    f.write_text(json.dumps(LB_DOC))
    assert main([str(f), "--database-url", TEST_URL]) == 0
    assert "inserted 7" in capsys.readouterr().out
    unknown = tmp_path / "x.json"
    unknown.write_text(json.dumps({"source": {"name": "Something"}}))
    assert main([str(unknown), "--database-url", TEST_URL]) == 2


BLM_DOC = {
    "source": {"name": "BenchLM", "site": "https://benchlm.ai/", "attribution": "Data from BenchLM.ai, CC BY-NC 4.0",
               "collected_at": "2026-11-25T18:32:00+00:00",
               "files": [{"file": "pricing.json", "source_last_updated": "November 23, 2026"}]},
    "leaderboard": {"ranking_mode": "bench-align-v5"},
    "benchmarks": [
        {"key": "swePro", "name": "SWE-bench Pro", "category": "coding", "format": "Accuracy", "lower_is_better": False},
        {"key": "aaBriefcaseElo", "name": "AA-Briefcase", "category": "agentic", "format": "Elo",
         "upstream_publisher": "Artificial Analysis"},
        {"key": "voxPopuliWer", "name": "VoxPopuli", "category": "multilingual", "format": "Word error rate",
         "lower_is_better": True},
        {"key": "gdpvalAa", "name": "GDPval-AA", "category": "agentic", "format": "Elo"},
        {"key": "gdpvalAaNormalized", "name": "GDPval-AA", "category": "agentic", "format": "Normalized",
         "upstream_publisher": "Artificial Analysis"},
        {"key": "swePro", "name": "SWE-bench Pro", "category": "agentic"},   # listed under two categories
    ],
    "models": [
        {"key": "claude-fable-5-2", "name": "Claude Fable 5.2", "creator": "Anthropic", "release_date": "2026-11-09",
         "family": {"variantType": "base"},
         "overall": {"score": 93.3, "rank": 1, "ranking_eligible": True, "evidence_status": "supported"},
         "category_scores": {"coding": 88.0, "agentic": None}, "category_ranks": {"coding": 1},
         "speed": {"tokens_per_second": 70, "time_to_first_token_seconds": 3.1, "upstream_source": "Artificial Analysis"},
         "pricing_usd_per_1m_tokens": {"input": 8.0, "output": 40.0, "cached_input": 0.8},
         "scores": [
             {"benchmark_key": "swePro", "category": "coding", "value": 93.0},
             {"benchmark_key": "swePro", "category": "agentic", "value": 93.0},
             {"benchmark_key": "aaBriefcaseElo", "category": "agentic", "value": 1785},
             {"benchmark_key": "voxPopuliWer", "category": "multilingual", "value": 4.2},
             {"benchmark_key": "gdpvalAa", "category": "agentic", "value": 1831},
             {"benchmark_key": "gdpvalAaNormalized", "category": "agentic", "value": 61.0,
              "source": {"publisher": "Vals AI", "label": "Vals AI: GDPval"}},
         ]},
        {"key": "gpt-4-judgebench", "name": "GPT-4 (JudgeBench)", "creator": "OpenAI",
         "family": {"variantType": "benchmark-system"}, "overall": {"score": 40.0},
         "scores": [{"benchmark_key": "swePro", "category": "coding", "value": 10.0}]},
    ],
}


def test_benchlm_import(conn):
    write(conn, livebench.parse(LB_DOC))
    stats = write(conn, benchlm.parse(BLM_DOC))
    assert stats.results == {"inserted": 7}      # overall + coding composite + 5 source benchmarks
    assert stats.prices == {"inserted": 1}
    assert any("benchmark/decision-system" in w for w in stats.warnings)
    rows = {(r["benchmark_name"], r["benchmark_version"]): r for r in conn.execute(
        """SELECT v.benchmark_name, v.benchmark_version, v.score_unit, v.benchmark_score, v.tokens_per_sec,
                  v.input_token_price, v.model_name, v.additional_metrics, b.metadata
             FROM v_benchmark_records v JOIN benchmarks b ON b.id = v.benchmark_id
            WHERE v.source_name = 'BenchLM'""").fetchall()}
    assert set(rows) == {("BenchLM Overall", "bench-align-v5"), ("BenchLM Coding", "bench-align-v5"),
                         ("SWE-bench Pro", None), ("AA-Briefcase", None), ("VoxPopuli", None),
                         ("GDPval-AA", "gdpvalAa"), ("GDPval-AA", "Artificial Analysis")}
    overall = rows[("BenchLM Overall", "bench-align-v5")]
    assert float(overall["benchmark_score"]) == 93.3 and float(overall["tokens_per_sec"]) == 70
    assert float(overall["input_token_price"]) == 8.0 and overall["additional_metrics"]["speed_source"] == "Artificial Analysis"
    assert rows[("AA-Briefcase", None)]["score_unit"] == "elo"
    assert rows[("AA-Briefcase", None)]["metadata"]["upstream_publisher"] == "Artificial Analysis"
    assert rows[("VoxPopuli", None)]["metadata"]["lower_is_better"] is True
    accs = {r["benchmark_name"]: r["a"] for r in conn.execute(
        "SELECT benchmark_name, accuracy::float AS a FROM v_benchmark_records WHERE source_name = 'BenchLM'")}
    assert accs["SWE-bench Pro"] == 93.0 and accs["AA-Briefcase"] is None   # "Accuracy" format vs Elo
    assert rows[("GDPval-AA", "Artificial Analysis")]["additional_metrics"]["source"]["publisher"] == "Vals AI"
    # BenchLM's "Claude Fable 5.2" joins the LiveBench model; the JudgeBench system entry is not imported
    assert count(conn, "models") == 2
    assert write(conn, benchlm.parse(BLM_DOC)).results == {"unchanged": 7}
    with_systems = benchlm.parse(BLM_DOC, include_systems=True)
    assert sum(len(i.results) for i in with_systems.items) == 9


GENERIC_DOC = {
    "format": "benchmark-results/v1",
    "source": {"name": "MMLU-Pro (TIGER-Lab)", "site": "https://example.invalid/mmlu-pro",
               "license": "Apache-2.0", "attribution": "TIGER-Lab", "collected_at": "2026-11-25T19:00:00+00:00"},
    "benchmarks": [
        {"key": "overall", "name": "MMLU-Pro", "version": "Official leaderboard", "area": "knowledge", "unit": "points"},
        {"key": "math", "name": "MMLU-Pro", "version": "Official: Math", "area": "knowledge", "unit": "points",
         "metric": "accuracy"},
    ],
    "results": [
        {"benchmark": "overall", "model": "Claude-4.6-Opus(Thinking)", "developer": "Anthropic",
         "developer_inferred": True, "score": 89.1, "external_id": "Claude-4.6-Opus(Thinking)|TIGER-Lab@89.1",
         "evaluation_method": "run by TIGER-Lab", "extra": {"data_source": "TIGER-Lab"}},
        {"benchmark": "math", "model": "Claude-4.6-Opus(Thinking)", "developer": "Anthropic",
         "score": 95.0, "external_id": "Claude-4.6-Opus(Thinking)|TIGER-Lab:Math@95.0"},
        {"benchmark": "overall", "model": "Granite-3.1-8B", "score": 40.0, "evaluation_date": "2025-01-02"},
        {"benchmark": "nope", "model": "X", "score": 1.0},
    ],
}


def test_generic_format_import(conn, tmp_path, capsys):
    parsed = generic.parse(GENERIC_DOC)
    assert parsed.warnings == ["result for unknown benchmark key 'nope' skipped"]
    stats = write(conn, parsed)
    assert stats.results == {"inserted": 3}
    rows = {r["model_name"]: r for r in conn.execute(
        """SELECT model_name, provider, reasoning_effort, benchmark_version, benchmark_score::float AS s,
                  evaluation_date::text AS d, additional_metrics FROM v_benchmark_records
            WHERE benchmark_version = 'Official leaderboard'""").fetchall()}
    claude = rows["Claude-4.6-Opus"]
    assert claude["provider"] == "Anthropic" and claude["reasoning_effort"] == "enabled" and claude["s"] == 89.1
    assert claude["additional_metrics"]["developer_inferred"] is True
    acc = {r["benchmark_version"]: r["a"] for r in conn.execute(
        "SELECT benchmark_version, accuracy::float AS a FROM v_benchmark_records WHERE model_name = 'Claude-4.6-Opus'")}
    assert acc == {"Official leaderboard": None, "Official: Math": 95.0}   # only metric=accuracy fills it
    granite = rows["Granite-3.1-8B"]
    assert granite["provider"] == "IBM" and granite["d"] == "2025-01-02"   # developer inferred by the importer
    assert write(conn, generic.parse(GENERIC_DOC)).results == {"unchanged": 3}
    # the CLI recognises the format field
    f = tmp_path / "g.json"
    f.write_text(json.dumps(GENERIC_DOC))
    assert main([str(f), "--database-url", TEST_URL, "--dry-run"]) == 0
    assert "unchanged 3" in capsys.readouterr().out
