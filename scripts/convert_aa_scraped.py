#!/usr/bin/env python3
"""Convert scraped Artificial Analysis data to generic benchmark-results/v1 files."""
import json, os, sys
from datetime import datetime

AA_DIR = os.path.join(os.path.dirname(__file__), "..", "data", "artificial-analysis")
OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "data")

with open(os.path.join(AA_DIR, "json", "language-models.json")) as f:
    raw = json.load(f)

fetched_at = raw["fetchedAt"]
models = raw["models"]

# --- benchmark definitions: AA field -> our benchmark ---
# key, name, version, area, unit, field, lower_is_better, metric, description
BENCHMARKS = [
    ("aa-hle", "AA-HLE", "scraped", "reasoning", "percent", "hle", False, "accuracy",
     "Humanity's Last Exam scores as reported by Artificial Analysis"),
    ("aa-gpqa", "AA-GPQA Diamond", "scraped", "reasoning", "percent", "gpqa", False, "accuracy",
     "GPQA Diamond scores as reported by Artificial Analysis"),
    ("aa-critpt", "AA-CRITPt", "scraped", "reasoning", "percent", "critpt", False, None,
     "CRITPt scores as reported by Artificial Analysis"),
    ("aa-critpt-agentic", "AA-CRITPt Agentic", "scraped", "agentic", "percent", "critptAgentic", False, None,
     "CRITPt Agentic scores as reported by Artificial Analysis"),
    ("aa-critpt-agentic-hard", "AA-CRITPt Agentic Hard", "scraped", "agentic", "percent", "critptAgenticHard", False, None,
     "CRITPt Agentic Hard scores as reported by Artificial Analysis"),
    ("aa-lcr", "AA-LCR", "scraped", "long_context", "percent", "lcr", False, None,
     "Long Context Reasoning scores as reported by Artificial Analysis"),
    ("aa-ifbench", "AA-IFBench", "scraped", "reasoning", "percent", "ifbench", False, None,
     "IFBench scores as reported by Artificial Analysis"),
    ("aa-tau2", "AA-τ²-Bench", "scraped", "agentic", "percent", "tau2", False, None,
     "τ²-Bench scores as reported by Artificial Analysis"),
    ("aa-tau-banking", "AA-τ²-Bench Banking", "scraped", "agentic", "percent", "tauBanking", False, None,
     "τ²-Bench Banking scores as reported by Artificial Analysis"),
    ("aa-terminalbench-hard", "AA-Terminal-Bench Hard", "scraped", "coding", "percent", "terminalbenchHard", False, None,
     "Terminal-Bench Hard scores as reported by Artificial Analysis"),
    ("aa-terminalbench-40", "AA-Terminal-Bench 4.0", "scraped", "coding", "percent", "terminalBench40", False, None,
     "Terminal-Bench 4.0 scores as reported by Artificial Analysis"),
    ("aa-terminalbench-41", "AA-Terminal-Bench 4.1", "scraped", "coding", "percent", "terminalBench41", False, None,
     "Terminal-Bench 4.1 scores as reported by Artificial Analysis"),
    ("aa-terminalbench-21", "AA-Terminal-Bench 2.1", "scraped", "coding", "percent", "terminalBench21", False, None,
     "Terminal-Bench 2.1 scores as reported by Artificial Analysis"),
    ("aa-terminalbench-science", "AA-Terminal-Bench Science", "scraped", "coding", "percent", "terminalBenchScience", False, None,
     "Terminal-Bench Science scores as reported by Artificial Analysis"),
    ("aa-gdpval", "GDPval-AA", "scraped", "other", "elo", "gdpval", False, None,
     "GDPval Elo as reported by Artificial Analysis"),
    ("aa-gdp-pdf", "AA-GDP.pdf", "scraped", "other", "percent", "gdpPdfAllPass", False, None,
     "GDP.pdf all-pass rate as reported by Artificial Analysis"),
    ("aa-briefcase", "AA-Briefcase", "scraped", "agentic", "elo", "briefcaseElo", False, None,
     "AA-Briefcase Elo as reported by Artificial Analysis"),
    ("aa-automationbench", "AA-AutomationBench", "scraped", "agentic", "percent", "automationBenchPartialScore", False, None,
     "AutomationBench partial score as reported by Artificial Analysis"),
    ("aa-scicode", "AA-SciCode", "scraped", "coding", "percent", "scicode", False, None,
     "SciCode scores as reported by Artificial Analysis"),
    ("aa-mlcr-overall", "MLCR-AA Overall", "scraped", "long_context", "percent", "mlcrOverall", False, None,
     "MLCR overall score as reported by Artificial Analysis"),
    ("aa-hle-diamond", "AA-HLE-Diamond", "scraped", "reasoning", "percent", "hleDiamond", False, "accuracy",
     "HLE-Diamond scores as reported by Artificial Analysis"),
    ("aa-omniscience", "AA-Omniscience Index", "scraped", "knowledge", "points", "omniscience", False, None,
     "Omniscience net score as reported by Artificial Analysis"),
    ("aa-omniscience-acc", "AA-Omniscience Accuracy", "scraped", "knowledge", "percent", "omniscienceAccuracy", False, "accuracy",
     "Omniscience accuracy as reported by Artificial Analysis"),
    ("aa-omniscience-halluc", "AA-Omniscience Hallucination Rate", "scraped", "knowledge", "percent", "omniscienceHallucinationRate", True, None,
     "Omniscience hallucination rate as reported by Artificial Analysis"),
    ("aa-frontiercode-20", "AA-FrontierCode 2.0", "scraped", "coding", "percent", "frontierCode20", False, None,
     "FrontierCode 2.0 scores as reported by Artificial Analysis"),
    ("aa-frontiercode", "AA-FrontierCode 1.1", "scraped", "coding", "percent", "frontierCode", False, None,
     "FrontierCode 1.1 scores as reported by Artificial Analysis"),
    ("aa-mmlu-pro", "AA-MMLU-Pro", "scraped", "knowledge", "percent", "mmluPro", False, "accuracy",
     "MMLU-Pro scores as reported by Artificial Analysis"),
    ("aa-mmmu-pro", "AA-MMMU-Pro", "scraped", "multimodal", "percent", "mmmuPro", False, "accuracy",
     "MMMU-Pro scores as reported by Artificial Analysis"),
    ("aa-aime-2025", "AA-AIME 2025", "scraped", "math", "percent", "aime25", False, "accuracy",
     "AIME 2025 scores as reported by Artificial Analysis"),
    ("aa-math-500", "AA-MATH-500", "scraped", "math", "percent", "math500", False, "accuracy",
     "MATH-500 scores as reported by Artificial Analysis"),
    ("aa-livecodebench", "AA-LiveCodeBench", "scraped", "coding", "percent", "livecodebench", False, None,
     "LiveCodeBench scores as reported by Artificial Analysis"),
    ("aa-intelligence-index", "Artificial Analysis Intelligence Index", "scraped", "other", "points", "intelligenceIndex", False, None,
     "Artificial Analysis Intelligence Index as reported by Artificial Analysis"),
    ("aa-harveylab", "AA-Harvey LAB", "scraped", "legal", "percent", "harveyLab", False, None,
     "Harvey LAB scores as reported by Artificial Analysis"),
    ("aa-healthbench", "AA-HealthBench", "scraped", "medical", "percent", "healthbench", False, None,
     "HealthBench length-adjusted score as reported by Artificial Analysis"),
    ("aa-healthbench-pro", "AA-HealthBench Professional", "scraped", "medical", "percent", "healthbenchProfessional", False, None,
     "HealthBench Professional length-adjusted score as reported by Artificial Analysis"),
    ("aa-mka", "AA-MKA", "scraped", "multimodal", "percent", "mkaClimbWsr", False, None,
     "MKA climb WSR as reported by Artificial Analysis"),
    ("aa-vials", "AA-VIALS", "scraped", "medical", "percent", "vials", False, None,
     "VIALS scores as reported by Artificial Analysis"),
    ("aa-aa3d", "AA-3D", "scraped", "other", "elo", "aa3dElo", False, None,
     "AA-3D Elo as reported by Artificial Analysis"),
    ("aa-analyst-agent", "AA-AnalystAgent", "scraped", "agentic", "percent", "analystAgent", False, None,
     "AnalystAgent scores as reported by Artificial Analysis"),
    ("aa-enterprise-ops-gym", "AA-EnterpriseOps-Gym", "scraped", "agentic", "percent", "enterpriseOpsGym", False, None,
     "EnterpriseOps-Gym scores as reported by Artificial Analysis"),
    ("aa-apex-agents", "APEX-Agents-AA", "scraped", "agentic", "percent", "apexAgents", False, None,
     "APEX-Agents scores as reported by Artificial Analysis"),
    ("aa-itbench", "AA-ITBench SRE", "scraped", "agentic", "percent", "itBenchSre", False, None,
     "ITBench SRE scores as reported by Artificial Analysis"),
    ("aa-global-mmlu-lite", "AA-Global-MMLU-Lite", "scraped", "knowledge", "percent", "globalMmluLiteScore", False, "accuracy",
     "Global-MMLU-Lite scores as reported by Artificial Analysis"),
    ("aa-openness-index", "AA-Openness Index", "scraped", "other", "points", "opennessIndex", False, None,
     "Openness Index as reported by Artificial Analysis"),
    ("aa-code2video", "AA-Code2Video", "scraped", "other", "elo", "code2videoElo", False, None,
     "Code2Video Elo as reported by Artificial Analysis"),
    # Capability sub-indexes
    ("aa-cap-finance", "Artificial Analysis Finance & Accounting Index", "scraped", "finance", "points", None, False, None,
     "Finance & Accounting capability index"),
    ("aa-cap-strategy", "Artificial Analysis Strategy & Ops Index", "scraped", "other", "points", None, False, None,
     "Strategy & Ops capability index"),
    ("aa-cap-legal", "Artificial Analysis Legal Index", "scraped", "legal", "points", None, False, None,
     "Legal capability index"),
    ("aa-cap-healthcare", "Artificial Analysis Healthcare & Medical Index", "scraped", "medical", "points", None, False, None,
     "Healthcare & Medical capability index"),
    ("aa-cap-engineering", "Artificial Analysis Engineering Index", "scraped", "other", "points", None, False, None,
     "Engineering capability index"),
    ("aa-cap-economics", "Artificial Analysis Economics Index", "scraped", "other", "points", None, False, None,
     "Economics capability index"),
    # Cyber
    ("aa-deepsecbench", "DeepsecBench-AA", "scraped", "other", "percent", "deepsecBench", False, None,
     "DeepSecBench scores as reported by Artificial Analysis"),
    ("aa-cwebench", "CWE-Bench-AA", "scraped", "other", "percent", "cweBench", False, None,
     "CWE-Bench scores as reported by Artificial Analysis"),
    ("aa-cybergym", "CyberGym-E2E-AA", "scraped", "other", "percent", "cybergymE2e", False, None,
     "CyberGym-E2E scores as reported by Artificial Analysis"),
    ("aa-cyber-index", "AA-Cyber Index", "scraped", "other", "points", "cyberIndex", False, None,
     "Artificial Analysis Cyber Index as reported by Artificial Analysis"),
    ("aa-frontierphysics", "AA-FrontierPhysics", "scraped", "reasoning", "percent", "frontierphysics", False, None,
     "FrontierPhysics scores as reported by Artificial Analysis"),
]

# Capability sub-indexes come from nested dict
CAP_FIELDS = {
    "aa-cap-finance": "financeAndAccounting",
    "aa-cap-strategy": "strategyAndOps",
    "aa-cap-legal": "legal",
    "aa-cap-healthcare": "healthcareAndMedical",
    "aa-cap-engineering": "engineering",
    "aa-cap-economics": "economics",
}

def get_score(model, bench_def):
    key = bench_def[0]
    field = bench_def[5]
    if key in CAP_FIELDS:
        caps = model.get("capabilities")
        if isinstance(caps, dict):
            return caps.get(CAP_FIELDS[key])
        return None
    if field is None:
        return None
    return model.get(field)

def effort_label(m):
    e = m.get("effort", {})
    if isinstance(e, dict):
        return e.get("slug") or e.get("label")
    return None

# Build results
bench_defs = []
bench_results = {}

for bdef in BENCHMARKS:
    key = bdef[0]
    bench_results[key] = []
    for m in models:
        score = get_score(m, bdef)
        if score is None:
            continue
        result = {
            "benchmark": key,
            "model": m["name"],
            "developer": m.get("creator", {}).get("name", ""),
            "score": score if isinstance(score, (int, float)) else float(score),
        }
        eff = effort_label(m)
        if eff:
            result["reasoning_effort"] = eff
        rd = m.get("releaseDate")
        if rd:
            result["evaluation_date"] = rd
        result["external_id"] = m.get("slug", m["name"])

        # Pricing in extra
        extra = {}
        for pk, pf in [("price_input_per_1m", "price1mInputTokens"),
                        ("price_output_per_1m", "price1mOutputTokens"),
                        ("price_cache_hit_per_1m", "cacheHitPrice"),
                        ("output_tokens_per_second", "outputSpeed")]:
            pv = m.get(pf)
            if pv is not None:
                extra[pk] = pv

        # Cost per task from intelligence index
        iic = m.get("intelligenceIndexCostPerTask")
        if isinstance(iic, dict) and isinstance(iic.get("cost"), dict):
            cpt = iic["cost"].get("total")
            if cpt is not None:
                result["cost_per_task_usd"] = cpt

        if extra:
            result["extra"] = extra
        bench_results[key].append(result)

# Only keep benchmarks that have results
active = [(bdef, bench_results[bdef[0]]) for bdef in BENCHMARKS if bench_results[bdef[0]]]

print(f"Benchmarks with data: {len(active)}")
for bdef, results in active:
    print(f"  {bdef[1]}: {len(results)} models")

# Build the generic file
doc = {
    "format": "benchmark-results/v1",
    "source": {
        "name": "Artificial Analysis (scraped)",
        "site": "https://artificialanalysis.ai",
        "publisher": "Artificial Analysis",
        "description": "Benchmark scores, pricing, and performance data scraped from Artificial Analysis website. Note: scraped data, not from official API.",
        "license": "No license for reuse (scraped from website)",
        "attribution": "Artificial Analysis, https://artificialanalysis.ai",
        "retrieved_from": ["https://artificialanalysis.ai/models"],
        "notes": [
            "Scores are as reported by Artificial Analysis, which runs its own evaluations.",
            "This data was scraped from their website; their terms forbid scraping.",
            "Percentage scores are stored as 0-1 fractions."
        ],
        "collected_at": fetched_at
    },
    "benchmarks": [],
    "results": []
}

for bdef, results in active:
    key, name, version, area, unit = bdef[0], bdef[1], bdef[2], bdef[3], bdef[4]
    b = {
        "key": key,
        "name": name,
        "version": version,
        "area": area,
        "unit": unit,
        "description": bdef[7],
        "url": "https://artificialanalysis.ai/leaderboards/terminal"
    }
    if bdef[6]:  # lower_is_better
        b["lower_is_better"] = True
    if bdef[7] == "accuracy":
        b["metric"] = "accuracy"
    doc["benchmarks"].append(b)
    doc["results"].extend(results)

out_path = os.path.join(OUT_DIR, "artificial-analysis-scraped.json")
with open(out_path, "w") as f:
    json.dump(doc, f, indent=2)

print(f"\nWrote {out_path}")
print(f"Total benchmarks: {len(doc['benchmarks'])}")
print(f"Total results: {len(doc['results'])}")
