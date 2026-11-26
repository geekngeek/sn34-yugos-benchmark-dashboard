"""API integration tests against a throwaway database (llm_bench_test).

The test database is rebuilt from db/init/*.sql and filled with a small fixed
data set by plain SQL inserts, so the numbers below are exact. The real
llm_bench database is never touched. Skipped when PostgreSQL is not reachable.
"""
from __future__ import annotations

import os
from datetime import date
from pathlib import Path

import psycopg
import pytest
from fastapi.testclient import TestClient
from psycopg.types.json import Jsonb

from api.config import ApiSettings
from api.main import create_app

ROOT = Path(__file__).resolve().parent.parent
ADMIN_URL = os.environ.get("TEST_ADMIN_DATABASE_URL", "postgresql://bench:bench@localhost:5432/postgres")
TEST_DB = "llm_bench_test"
TEST_URL = ADMIN_URL.rsplit("/", 1)[0] + "/" + TEST_DB

# (canonical_key, provider, model_name, aliases)
MODELS = [
    ("5-gpt", "OpenAI", "GPT-5", ["GPT-5 (high)"]),
    ("4-5-claude-opus", "Anthropic", "Claude 4.5 Opus", ["Claude Opus 4.5 (Reasoning)"]),
    ("3-flash-gemini", "Google", "Gemini 3 Flash", []),
]
# (name, version, area, unit, total_tasks)
BENCHMARKS = [
    ("SWE-bench", "Verified", "coding", "percentage", 500),
    ("SWE-bench", "Lite", "coding", "percentage", 300),
    ("Artificial Analysis Intelligence Index", "v5.0", "general", "points", None),
    ("GPQA", "Diamond", "reasoning", "percentage", None),
]
# (source, benchmark, version, model, external_id, effort, score, cost_per_task, evaluation_date)
RESULTS = [
    ("SWE-bench", "SWE-bench", "Verified", "GPT-5", "f1", "high", 70.0, 0.50, date(2025, 9, 1)),
    ("SWE-bench", "SWE-bench", "Verified", "GPT-5", "f2", "high", 74.0, 0.60, date(2025, 12, 1)),
    ("SWE-bench", "SWE-bench", "Verified", "Claude 4.5 Opus", "f3", None, 79.2, 1.20, date(2025, 12, 5)),
    ("SWE-bench", "SWE-bench", "Verified", "Claude 4.5 Opus", "f4", "medium", 76.8, 0.75, date(2026, 2, 17)),
    ("SWE-bench", "SWE-bench", "Verified", "Gemini 3 Flash", "f5", "high", 75.8, 0.36, date(2026, 2, 17)),
    ("SWE-bench", "SWE-bench", "Lite", "GPT-5", "f7", None, 30.0, None, date(2025, 8, 1)),
    ("Artificial Analysis", "Artificial Analysis Intelligence Index", "v5.0", "GPT-5", "aa-gpt5-idx", "high", 68.0, None, None),
    ("Artificial Analysis", "GPQA", "Diamond", "GPT-5", "aa-gpt5-gpqa", "high", 85.0, None, None),
    ("Artificial Analysis", "Artificial Analysis Intelligence Index", "v5.0", "Claude 4.5 Opus", "aa-opus-idx", "enabled", 70.0, None, None),
    ("Artificial Analysis", "GPQA", "Diamond", "Claude 4.5 Opus", "aa-opus-gpqa", "enabled", 87.0, None, None),
    ("Artificial Analysis", "Artificial Analysis Intelligence Index", "v5.0", "Gemini 3 Flash", "aa-gem-idx", None, 60.0, None, None),
    ("Artificial Analysis", "GPQA", "Diamond", "Gemini 3 Flash", "aa-gem-gpqa", None, 80.0, None, None),
]
# (model, api_provider, input, output)
PRICES = [
    ("GPT-5", "OpenAI", 1.25, 10.0),
    ("Claude 4.5 Opus", "Anthropic", 5.0, 25.0),
    ("Gemini 3 Flash", "Google", 0.30, 2.5),
]


def load_fixtures(conn: psycopg.Connection) -> None:
    ids: dict[str, object] = {}
    for name in ("SWE-bench", "Artificial Analysis"):
        ids[name] = conn.execute("INSERT INTO sources (source_name) VALUES (%s) RETURNING id", (name,)).fetchone()[0]
    for key, provider, name, aliases in MODELS:
        ids[name] = conn.execute(
            "INSERT INTO models (canonical_key, provider, model_name, aliases) VALUES (%s, %s, %s, %s) RETURNING id",
            (key, provider, name, [name, *aliases])).fetchone()[0]
    for name, version, area, unit, tasks in BENCHMARKS:
        ids[f"{name}|{version}"] = conn.execute(
            """INSERT INTO benchmarks (benchmark_name, benchmark_version, area, default_score_unit, total_tasks)
               VALUES (%s, %s, %s, %s, %s) RETURNING id""", (name, version, area, unit, tasks)).fetchone()[0]
    units = {f"{b[0]}|{b[1]}": b[3] for b in BENCHMARKS}
    for source, bench, version, model, ext, effort, score, cost, eval_date in RESULTS:
        raw_id = None
        if ext == "f7":  # one result with a stored raw payload, for the provenance endpoint
            raw_id = conn.execute(
                """INSERT INTO raw_data (source_id, source_url, payload, content_hash)
                   VALUES (%s, 'https://test.invalid/data', %s, 'hash-f7') RETURNING id""",
                (ids[source], Jsonb({"leaderboard": "Lite", "entry": {"folder": "f7"}}))).fetchone()[0]
        conn.execute(
            """INSERT INTO benchmark_results (benchmark_id, model_id, source_id, raw_data_id, external_id,
                   reasoning_effort, benchmark_score, score_unit, cost_per_task_usd, evaluation_date)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
            (ids[f"{bench}|{version}"], ids[model], ids[source], raw_id, ext, effort, score,
             units[f"{bench}|{version}"], cost, eval_date))
    for model, provider, price_in, price_out in PRICES:
        conn.execute(
            """INSERT INTO model_pricing (model_id, api_provider, input_token_price, output_token_price,
                                          effective_from, source_id)
               VALUES (%s, %s, %s, %s, current_date, %s)""",
            (ids[model], provider, price_in, price_out, ids["Artificial Analysis"]))


@pytest.fixture(scope="session")
def client():
    try:
        admin = psycopg.connect(ADMIN_URL, autocommit=True, connect_timeout=3)
    except psycopg.OperationalError:
        pytest.skip("PostgreSQL not reachable")
    with admin:
        admin.execute(f"DROP DATABASE IF EXISTS {TEST_DB} WITH (FORCE)")
        admin.execute(f"CREATE DATABASE {TEST_DB}")
    with psycopg.connect(TEST_URL, autocommit=True) as conn:
        for f in sorted((ROOT / "db" / "init").glob("*.sql")):
            conn.execute(f.read_text())
        load_fixtures(conn)

    settings = ApiSettings(database_url=TEST_URL, cors_origins=["http://localhost:3000"],
                           pool_min=1, pool_max=2, statement_timeout_ms=5000)
    with TestClient(create_app(settings)) as c:
        yield c


def _bench(client, name, version):
    items = client.get("/api/v1/benchmarks", params={"q": name}).json()
    return next(b for b in items if b["benchmark_name"] == name and b["benchmark_version"] == version)


def _model(client, q):
    (m,) = client.get("/api/v1/models", params={"q": q}).json()
    return m


# --- tests -------------------------------------------------------------------------
def test_health_and_overview(client):
    assert client.get("/health").json() == {"status": "ok", "database": "ok"}
    o = client.get("/api/v1/overview").json()
    assert o["counts"]["models"] == 3
    assert o["counts"]["results"] == 12
    assert {s["source_name"] for s in o["sources"]} == {"SWE-bench", "Artificial Analysis"}


def test_model_detail(client):
    m = _model(client, "Opus")
    assert m["provider"] == "Anthropic" and m["benchmark_count"] == 3
    assert "Claude Opus 4.5 (Reasoning)" in m["aliases"]
    detail = client.get(f"/api/v1/models/{m['id']}").json()
    assert {r["benchmark_name"] for r in detail["best_results"]} == {
        "SWE-bench", "Artificial Analysis Intelligence Index", "GPQA"}
    (price,) = detail["current_pricing"]
    assert price["input_token_price"] == 5.0 and price["api_provider"] == "Anthropic"


def test_leaderboard_best_per_model(client):
    b = _bench(client, "SWE-bench", "Verified")
    lb = client.get(f"/api/v1/leaderboard/{b['id']}").json()
    rows = [(e["rank"], e["model_name"], e["benchmark_score"]) for e in lb["entries"]]
    assert rows == [(1, "Claude 4.5 Opus", 79.2), (2, "Gemini 3 Flash", 75.8), (3, "GPT-5", 74.0)]
    assert lb["score_unit"] == "percentage"


def test_leaderboard_latest_and_effort_groups(client):
    b = _bench(client, "SWE-bench", "Verified")
    latest = client.get(f"/api/v1/leaderboard/{b['id']}", params={"pick": "latest"}).json()
    assert {e["model_name"]: e["benchmark_score"] for e in latest["entries"]}["Claude 4.5 Opus"] == 76.8
    grouped = client.get(f"/api/v1/leaderboard/{b['id']}", params={"group_by": "model_effort"}).json()
    assert len(grouped["entries"]) == 4
    medium = client.get(f"/api/v1/leaderboard/{b['id']}", params={"reasoning_effort": "medium"}).json()
    assert [e["benchmark_score"] for e in medium["entries"]] == [76.8]


def test_results_filters_and_paging(client):
    r = client.get("/api/v1/results", params={"q": "GPT-5", "sort": "evaluation_date", "order": "asc",
                                              "limit": 2}).json()
    assert r["total"] == 5 and len(r["items"]) == 2
    assert r["items"][0]["benchmark_version"] == "Lite"
    one = r["items"][0]
    assert client.get(f"/api/v1/results/{one['id']}").json()["id"] == one["id"]
    raw = client.get(f"/api/v1/results/{one['id']}/raw").json()
    assert raw["payload"]["entry"]["folder"] == "f7"
    assert client.get("/api/v1/results", params={"sort": "nope"}).status_code == 422


def test_compare(client):
    ids = [_model(client, q)["id"] for q in ("GPT-5", "Gemini 3 Flash")]
    c = client.get("/api/v1/compare", params={"model_id": ids}).json()
    assert [m["model_name"] for m in c["models"]] == ["GPT-5", "Gemini 3 Flash"]
    rows = {(r["benchmark"]["benchmark_name"], r["benchmark"]["benchmark_version"]): r["cells"] for r in c["rows"]}
    gpt, gem = rows[("SWE-bench", "Verified")]
    assert (gpt["benchmark_score"], gpt["rank"], gpt["ranked_models"]) == (74.0, 3, 3)
    assert gem["rank"] == 2
    lite = rows[("SWE-bench", "Lite")]
    assert lite[1] is None
    shared = client.get("/api/v1/compare", params={"model_id": ids, "only_shared": True}).json()
    assert ("SWE-bench", "Lite") not in {(r["benchmark"]["benchmark_name"], r["benchmark"]["benchmark_version"])
                                          for r in shared["rows"]}
    assert client.get("/api/v1/compare", params={"model_id": ids[:1]}).status_code == 422


def test_trends_frontier(client):
    b = _bench(client, "SWE-bench", "Verified")
    t = client.get(f"/api/v1/analysis/trends/{b['id']}").json()
    assert [(p["date"], p["benchmark_score"]) for p in t["frontier"]] == [
        ("2025-09-01", 70.0), ("2025-12-01", 74.0), ("2025-12-05", 79.2)]
    gpt = next(s for s in t["series"] if s["model"]["model_name"] == "GPT-5")
    assert [p["benchmark_score"] for p in gpt["points"]] == [70.0, 74.0]


def test_cost_performance_pareto(client):
    b = _bench(client, "SWE-bench", "Verified")
    cp = client.get(f"/api/v1/analysis/cost-performance/{b['id']}").json()
    pts = [(p["model_name"], p["reasoning_effort"], p["cost"], p["is_pareto"]) for p in cp["points"]]
    assert pts == [
        ("Gemini 3 Flash", "high", 0.36, True),
        ("GPT-5", "high", 0.60, False),          # dominated by Gemini (cheaper and better)
        ("Claude 4.5 Opus", "medium", 0.75, True),
        ("Claude 4.5 Opus", None, 1.20, True),
    ]
    gpqa = _bench(client, "GPQA", "Diamond")
    blended = client.get(f"/api/v1/analysis/cost-performance/{gpqa['id']}",
                         params={"cost_metric": "blended_price"}).json()
    assert blended["points"][0]["model_name"] == "Gemini 3 Flash"
    assert blended["points"][0]["cost"] == pytest.approx((3 * 0.30 + 2.5) / 4)


def test_not_found_and_bad_ids(client):
    missing = "00000000-0000-0000-0000-000000000000"
    assert client.get(f"/api/v1/leaderboard/{missing}").status_code == 404
    assert client.get(f"/api/v1/models/{missing}").status_code == 404
    assert client.get("/api/v1/models/not-a-uuid").status_code == 422


def test_results_sorts_search_latest_and_filters(client):
    r = client.get("/api/v1/results", params={"sort": "provider", "order": "asc", "limit": 100}).json()
    providers = [i["provider"] for i in r["items"]]
    assert providers == sorted(providers, key=str.lower)
    r = client.get("/api/v1/results", params={"sort": "reasoning_effort", "order": "asc", "limit": 100}).json()
    efforts = [i["reasoning_effort"] for i in r["items"]]
    assert efforts.index("medium") < efforts.index("high") < efforts.index("enabled")
    assert efforts[-1] is None                                 # NULLS LAST
    # search also matches benchmark version and developer
    assert client.get("/api/v1/results", params={"q": "lite"}).json()["total"] == 1
    assert client.get("/api/v1/results", params={"q": "anthropic"}).json()["total"] == 4
    # latest only: GPT-5 (high) on Verified has two results -> one
    assert client.get("/api/v1/results").json()["total"] == 12
    assert client.get("/api/v1/results", params={"latest_only": True}).json()["total"] == 11
    f = client.get("/api/v1/filters").json()
    assert [s["source_name"] for s in f["sources"]] == ["Artificial Analysis", "SWE-bench"]
    assert {"coding", "general", "reasoning"} <= set(f["areas"])
    assert f["providers"] == ["Anthropic", "Google", "OpenAI"]
    assert f["reasoning_efforts"] == ["medium", "high", "enabled"]
    assert "benchmark" in f["sorts"] and "accuracy" in f["sorts"] and len(f["benchmarks"]) == 4
    assert [(m["model_name"], m["provider"], m["result_count"]) for m in f["models"]] == [
        ("Claude 4.5 Opus", "Anthropic", 4), ("Gemini 3 Flash", "Google", 3), ("GPT-5", "OpenAI", 5)]


def test_results_multi_value_filters(client):
    total = lambda **p: client.get("/api/v1/results", params=p).json()["total"]
    f = client.get("/api/v1/filters").json()
    src = {s["source_name"]: s["id"] for s in f["sources"]}
    # several values in one filter = any of them
    assert total(source_id=[src["SWE-bench"], src["Artificial Analysis"]]) == 12
    assert total(source_id=[src["SWE-bench"]]) == 6
    assert total(provider=["OpenAI", "google"]) == total(provider="OpenAI") + total(provider="Google")
    assert total(area=["coding", "reasoning"]) == total(area="coding") + total(area="reasoning")
    verified = next(b["id"] for b in f["benchmarks"] if b["benchmark_version"] == "Verified")
    lite = next(b["id"] for b in f["benchmarks"] if b["benchmark_version"] == "Lite")
    assert total(benchmark_id=[verified, lite]) == 6
    # efforts, including "not stated"
    assert total(reasoning_effort=["high", "medium"]) == total(reasoning_effort="high") + total(reasoning_effort="medium")
    assert total(reasoning_effort=["unspecified"]) == 4     # f3, f7 and Gemini's two AA rows
    assert total(reasoning_effort=["high", "unspecified"]) == total(reasoning_effort="high") + 4
    models = {m["model_name"]: m["id"] for m in f["models"]}
    assert total(model_id=[models["GPT-5"], models["Gemini 3 Flash"]]) == 8
    # filters still combine with each other (AND across filters)
    assert total(source_id=[src["SWE-bench"]], reasoning_effort=["high"]) == 3


def test_results_group_or_item(client):
    """Within source/benchmark and developer/model, groups and items combine with OR."""
    total = lambda **p: client.get("/api/v1/results", params=p).json()["total"]
    f = client.get("/api/v1/filters").json()
    src = {s["source_name"]: s["id"] for s in f["sources"]}
    gpqa = next(b["id"] for b in f["benchmarks"] if b["benchmark_name"] == "GPQA")
    models = {m["model_name"]: m["id"] for m in f["models"]}
    # all of SWE-bench (6) + GPQA from Artificial Analysis (3)
    assert total(source_id=[src["SWE-bench"]], benchmark_id=[gpqa]) == 9
    # all of Anthropic (4) + GPT-5 (5)
    assert total(provider=["Anthropic"], model_id=[models["GPT-5"]]) == 9
    # the two pairs still combine with AND: (SWE-bench or GPQA) and (Anthropic or GPT-5)
    assert total(source_id=[src["SWE-bench"]], benchmark_id=[gpqa],
                 provider=["Anthropic"], model_id=[models["GPT-5"]]) == 7


def test_rating_score(client):
    """Elo ratings get a 0-100 win chance vs the arena average: 100 / (1 + 10^((avg - R) / 400))."""
    with psycopg.connect(TEST_URL, autocommit=True) as conn:
        src = conn.execute("INSERT INTO sources (source_name) VALUES ('Arena') RETURNING id").fetchone()[0]
        bench = conn.execute("""INSERT INTO benchmarks (benchmark_name, area, default_score_unit)
                                VALUES ('Arena', 'chat', 'elo') RETURNING id""").fetchone()[0]
        models = dict(conn.execute("SELECT model_name, id FROM models").fetchall())
        for ext, model, rating in (("e1", "GPT-5", 1400), ("e2", "Gemini 3 Flash", 1200)):
            conn.execute("""INSERT INTO benchmark_results (benchmark_id, model_id, source_id, external_id,
                                benchmark_score, score_unit) VALUES (%s, %s, %s, %s, %s, 'elo')""",
                         (bench, models[model], src, ext, rating))
        try:
            rows = client.get("/api/v1/results", params={"benchmark_id": str(bench)}).json()["items"]
            # average 1300: 100 / (1 + 10^(-100/400)) = 64.01, and the mirror 35.99
            assert [(r["benchmark_score"], r["display_score"], r["scale_note"]) for r in rows] == [
                (1400, 64.01, "Elo"), (1200, 35.99, "Elo")]
            # the average is the whole arena's, even when filters leave one row
            (one,) = client.get("/api/v1/results", params={"benchmark_id": str(bench),
                                                            "model_id": str(models["Gemini 3 Flash"])}).json()["items"]
            assert one["display_score"] == 35.99
            # non-rating results have none, and sort by their own score among the ratings' 0-100 values
            top = client.get("/api/v1/results", params={"limit": 3}).json()["items"]
            assert [r["benchmark_score"] for r in top] == [87.0, 85.0, 80.0]
            assert all(r["display_score"] is None and r["scale_note"] is None for r in top)
        finally:
            conn.execute("DELETE FROM benchmark_results WHERE source_id = %s", (src,))
            conn.execute("DELETE FROM benchmarks WHERE id = %s", (bench,))
            conn.execute("DELETE FROM sources WHERE id = %s", (src,))


def test_other_scales(client):
    """Known ranges are rescaled to 0-100; counts and lower-is-better scores keep their number and sort last."""
    with psycopg.connect(TEST_URL, autocommit=True) as conn:
        src = conn.execute("INSERT INTO sources (source_name) VALUES ('Scales') RETURNING id").fetchone()[0]
        model = conn.execute("SELECT id FROM models WHERE model_name = 'GPT-5'").fetchone()[0]
        made = []
        for name, meta, score in (("PMPP-Hard", {"benchlm_key": "pmppHardAuc"}, 494.27),      # max 690
                                  ("Hijacks", {"benchlm_key": "binaryExploitationHijacks"}, 148),  # count
                                  ("WB", {"key": "wb_score"}, 59.4),                            # -100..100
                                  ("Hallucination", {"lower_is_better": True}, 99.0)):
            bench = conn.execute("INSERT INTO benchmarks (benchmark_name, default_score_unit, metadata) "
                                 "VALUES (%s, 'points', %s) RETURNING id", (name, Jsonb(meta))).fetchone()[0]
            conn.execute("""INSERT INTO benchmark_results (benchmark_id, model_id, source_id, external_id,
                                benchmark_score, score_unit) VALUES (%s, %s, %s, %s, %s, 'points')""",
                         (bench, model, src, name, score))
            made.append(bench)
        try:
            rows = client.get("/api/v1/results", params={"source_id": str(src)}).json()["items"]
            assert [(r["benchmark_name"], r["display_score"], r["scale_note"]) for r in rows] == [
                ("WB", 79.7, "WB-Score −100 to 100"),            # (59.4 + 100) / 2
                ("PMPP-Hard", 71.63, "task-hours of 690"),        # 494.27 / 690
                ("Hijacks", None, "count of hijacks"),            # not convertible: last
                ("Hallucination", None, "lower is better"),
            ]
            # the not-comparable ones never jump above real 0-100 scores in a mixed list
            top = client.get("/api/v1/results", params={"limit": 1}).json()["items"][0]
            assert top["benchmark_name"] == "GPQA"
        finally:
            conn.execute("DELETE FROM benchmark_results WHERE source_id = %s", (src,))
            conn.execute("DELETE FROM benchmarks WHERE id = ANY(%s)", (made,))
            conn.execute("DELETE FROM sources WHERE id = %s", (src,))
