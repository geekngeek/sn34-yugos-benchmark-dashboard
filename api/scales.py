"""Putting scores from different scales on one 0-100 scale for the results table.

Most results already are 0-100 (percent or points). The exceptions are converted here:

* head-to-head ratings (score_unit "elo"): the chance, 0-100, of beating an average model
  of the same arena (benchmark + source + sub-area):  100 / (1 + 10^((R_avg - R) / 400))
* benchmarks with a known other range, listed in SCALES below (by the benchmark's
  metadata key: "benchlm_key" from BenchLM, "key" from the generic importer)
* "lower is better" benchmarks and benchmarks with no upper limit (counts) cannot be put
  on a "higher is better, 0-100" scale: they keep their own number, get a note, and sort
  after the comparable scores.

Every converted result keeps its original value in benchmark_score.
"""
from __future__ import annotations

# metadata key -> (kind, value, note)
#   max       score / value * 100            (value = the scale's maximum)
#   fraction  score * 100                    (0-1 scale)
#   centered  (score + value) / (2 * value) * 100   (-value..value scale)
#   raw       not convertible (no upper limit); shown as published
SCALES: dict[str, tuple[str, float | None, str]] = {
    "pmppHardAuc": ("max", 690, "task-hours of 690"),
    "benchCadVision2Code": ("fraction", None, "voxel IoU 0–1"),
    "benchCadVision2CodeWithTools": ("fraction", None, "voxel IoU 0–1"),
    "aaOmniscienceIndex": ("centered", 100, "index −100 to 100"),
    "wb_score": ("centered", 100, "WB-Score −100 to 100"),
    "binaryExploitationHijacks": ("raw", None, "count of hijacks"),
    "aceCyberRangeSolved": ("raw", None, "challenges solved"),
    "cyScenarioBenchScenariosSolved": ("raw", None, "scenarios solved"),
    "intelligencePerWatt": ("raw", None, "intelligence per joule"),
    "stemProfessorBench": ("raw", None, "own score scale"),
}


def scored(table: str) -> tuple[str, dict]:
    """`table` as a subquery with three extra columns, plus its query parameters:

    display_score  the 0-100 number shown in the Score column (NULL: show benchmark_score)
    scale_note     what the original number is ("Elo", "task-hours of 690", "lower is better")
    sort_score     the value the Score column sorts by; NULL (sorted last) when not comparable
    """
    keys = list(SCALES)
    params = {"scale_keys": keys, "scale_kinds": [SCALES[k][0] for k in keys],
              "scale_values": [SCALES[k][1] for k in keys], "scale_notes": [SCALES[k][2] for k in keys]}
    sql = f"""(
        SELECT t.*, x.display_score,
               CASE WHEN x.lower_better THEN concat_ws(', ', x.note, 'lower is better') ELSE x.note END
                   AS scale_note,
               CASE WHEN x.lower_better OR x.kind = 'raw' THEN NULL
                    ELSE COALESCE(x.display_score, t.benchmark_score) END AS sort_score
          FROM {table} t
          JOIN benchmarks b ON b.id = t.benchmark_id
          LEFT JOIN UNNEST(%(scale_keys)s::text[], %(scale_kinds)s::text[],
                           %(scale_values)s::float8[], %(scale_notes)s::text[]) AS s(key, kind, value, note)
                 ON s.key = COALESCE(b.metadata->>'benchlm_key', b.metadata->>'key')
          LEFT JOIN (SELECT benchmark_id, source_id, sub_area, AVG(benchmark_score) AS r_avg
                       FROM v_benchmark_records WHERE score_unit = 'elo' AND benchmark_score IS NOT NULL
                      GROUP BY 1, 2, 3) a
                 ON t.score_unit = 'elo' AND a.benchmark_id = t.benchmark_id
                AND a.source_id = t.source_id AND a.sub_area IS NOT DISTINCT FROM t.sub_area
          CROSS JOIN LATERAL (
              SELECT s.kind,
                     CASE WHEN t.score_unit = 'elo' THEN 'Elo' ELSE s.note END AS note,
                     COALESCE((b.metadata->>'lower_is_better')::boolean, false) AS lower_better,
                     ROUND((CASE
                         WHEN t.score_unit = 'elo' THEN 100 / (1 + POWER(10, (a.r_avg - t.benchmark_score) / 400))
                         WHEN s.kind = 'max' THEN t.benchmark_score / s.value * 100
                         WHEN s.kind = 'fraction' THEN t.benchmark_score * 100
                         WHEN s.kind = 'centered' THEN (t.benchmark_score + s.value) / (2 * s.value) * 100
                     END)::numeric, 2)::float8 AS display_score
          ) x
    ) AS scored"""
    return sql, params
