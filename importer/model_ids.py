"""Model ID rules: one identity for a model across benchmarks, the Yugos world card and this project.

Three things are kept apart and never mixed into one name:

    model    the model as its vendor ships it, wherever it is hosted   anthropic/claude-opus-4.5
    config   model + how it was run (what benchmarks score)            …@xhigh, …@none+search
    offer    where it is bought and at what price (Yugos world card)   openrouter:anthropic/claude-opus-4.5

A raw name from a source ("Claude 4.5 Opus Thinking High Effort", "GPT-5.2 (Search, Non-Reasoning)",
"claude-3-5-sonnet-20241022") is split by `parse_raw` into:

    base      the model's own name                         "Claude 4.5 Opus"
    effort    none|minimal|low|medium|high|xhigh|max|enabled  (enabled = thinking on, level not stated)
    mode      search | codex-harness | tool-mentor | fp8 | bf16 | nvfp4 …  (joined with "+")
    snapshot  a dated snapshot of the same model           "2024-10-22", "Nov 2024"
    notes     informative text that is not identity        "39B/141B", "hosted 35B-A3B", "32k thinking tokens"

Identity is decided on `base` only (see `strict_key`). Names that agree only after dropping packaging words
("Instruct", "-it", "chat") or vendor words ("Amazon", "NVIDIA") share a `loose_key`: such pairs are reported
for review, never merged silently. The registry and alias table (data/models/) hold the decisions;
scripts/build_model_registry.py builds them and the importer resolves every name through them.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

from .normalize import normalize_effort, split_effort

# --------------------------------------------------------------------------------------------------
# "Thinking" is a setting (effort) unless the vendor released the thinking model as its own model ID.
# Keep this list explicit and reviewable: anything not listed here is treated as effort.
SEPARATE_THINKING = [re.compile(p, re.I) for p in (
    r"\bqwen\s*-?\s*3\b.*\b(2507|next|vl|omni|max)\b",   # Qwen3 2507 / Next / VL / Omni / Max: separate *-Thinking models
    r"\bqwen\s*-?\s*3\b.*thinking.*\b2507\b",
    r"\bkimi[\s-]*k2[\s-]+think",                         # Kimi K2 Thinking (K2.5+ are hybrid: effort)
    r"\bseed[\s-]*1\.6|\bseed[\s-]*thinking",             # ByteDance Seed1.6-Thinking, Seed-Thinking-v1.5
    r"\bolmo\b", r"\bmellum", r"^k2[\s-]*think", r"openthinker", r"\bmai[\s-]*thinking",
    r"\btrinity\b", r"gemini[\s-]*2\.0[\s-]*flash[\s-]*thinking", r"\bdeep[\s-]*think\b",
    r"grok[\s-]*voice[\s-]*think",
    r"general[\s-]*reasoner", r"\bphi[\s-]*\d.*reasoning",          # models whose name contains the word
    r"\bsonar\b",                                                      # Perplexity Sonar Reasoning (Pro): own model
)]

# words that mean "thinking" / "no thinking" when used as a setting
_THINK_ON = r"thinking|think|reasoning|reasoner"
_THINK_OFF = r"non[\s-]?thinking|no[\s-]?thinking|no[\s-]?think|non[\s-]?reasoning|nonthinking|nonreasoning"

_MODE_WORDS = {
    "search": "search", "web search": "search", "grounding": "search", "with search": "search",
    "codex harness": "codex-harness", "tools": "tools", "with tools": "tools",
}
_PRECISION = {"fp8", "bf16", "fp16", "nvfp4", "fp4", "int4", "int8", "awq", "gptq"}
_MONTHS = r"jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec"

_FULL_DATE = re.compile(r"^(\d{4}-\d{2}-\d{2}|\d{8}|\d{2}-\d{2}-\d{2}|\d{2}-\d{4}|\d{2}-\d{2})$")
_MONTH_YEAR = re.compile(rf"^({_MONTHS})[a-z]*\.?\s*'?\d{{2,4}}$", re.I)
_VERSION_TAG = re.compile(r"^v?\d{4}$", re.I)                 # 2507, 0324, 1106, v0925: vendor version tags
_SIZE = re.compile(r"^\d+(\.\d+)?[bm](/\d+(\.\d+)?[bm])?$", re.I)  # 7b, 39b/141b
_EMBEDDED_DATE = re.compile(r"[-_ ]?\b(\d{4}-\d{2}-\d{2}|20\d{6})\b")
_TRAILING_MONTH_YEAR = re.compile(r"[-_ ](\d{2}-20\d{2})$")      # command-r-plus-08-2024

# words that do not change which model it is (only used for the loose key, i.e. for review)
_SOFT_WORDS = {"instruct", "it", "chat", "hf", "latest", "v", "model", "amazon", "meta", "google", "openai",
               "anthropic", "mistralai", "microsoft", "ibm", "nvidia", "alibaba", "xai", "x", "ai"}


@dataclass
class Parsed:
    base: str
    effort: str | None = None
    mode: list[str] = field(default_factory=list)
    snapshot: str | None = None
    notes: list[str] = field(default_factory=list)
    system: bool = False        # two models working together ("A + B"): a system, not one model

    @property
    def mode_str(self) -> str | None:
        return "+".join(sorted(set(self.mode))) or None


def separate_thinking(name: str) -> bool:
    return any(p.search(name) for p in SEPARATE_THINKING)


def _paren_kind(text: str, name: str, p: Parsed) -> bool:
    """Classify one "(…)" group. True = consumed (not part of the name)."""
    t = text.strip()
    low = t.lower()
    outside = re.sub(r"\([^()]*\)", " ", name)        # the name without any (…) groups
    parts = [x.strip() for x in re.split(r"[,;]", low) if x.strip()]
    consumed_all = True
    think_on, level = False, None
    for part in parts:
        if part in _MODE_WORDS:
            p.mode.append(_MODE_WORDS[part])
        elif part in _PRECISION:
            p.mode.append(part)
        elif re.fullmatch(_THINK_OFF, part) or part == "chat" and "deepseek" in name.lower():
            p.effort = p.effort or "none"
        elif re.fullmatch(rf"(max|maximum)\s+({_THINK_ON})", part):
            p.effort = "max"
        elif re.fullmatch(rf"(\d+k)\s+({_THINK_ON})(\s+tokens)?", part):
            # a stated thinking budget is its own configuration: "(32k think)" != "(default think)"
            p.effort = p.effort or "enabled"
            p.mode.append(f"thinking-{part.split()[0]}")
        elif re.fullmatch(rf"default\s+({_THINK_ON})(\s+tokens)?", part):
            p.effort = p.effort or "enabled"
        elif re.fullmatch(_THINK_ON, part):
            if separate_thinking(name):
                consumed_all = False
            else:
                think_on = True
        elif normalize_effort(part) is not None and part.split()[0] in (
                "none", "minimal", "low", "medium", "high", "xhigh", "x-high", "max", "maximum"):
            level = level or normalize_effort(part)
        elif part.startswith("default fallback"):
            pass
        elif _FULL_DATE.match(part) or _MONTH_YEAR.match(part) or re.fullmatch(rf"({_MONTHS})[a-z]*\s+\d{{4}}", part):
            p.snapshot = p.snapshot or t
        elif part.startswith("hosted ") or (_SIZE.match(part) and re.search(r"\d+(\.\d+)?b\b", outside, re.I)):
            p.notes.append(t)             # informative only: the name already says which size it is
        elif part == "tool-mentor":
            p.mode.append("tool-mentor")
        else:
            consumed_all = False
    # "(thinking, high)": both a level and thinking -> effort high, mode thinking
    if level:
        p.effort = p.effort or level
        if think_on:
            p.mode.append("thinking")
    elif think_on:
        p.effort = p.effort or "enabled"
    return consumed_all


def parse_raw(raw: str) -> Parsed:
    """Split a source's model name into base name, effort, mode, snapshot and notes."""
    name = raw.strip()
    p = Parsed(base=name)

    # "A + B" / "A & B" / "(7B + 72B)": two models working together (Aider architect + editor, SWE-bench
    # combinations) are a system, not either model. "… + tool-mentor" (no version number) is a run add-on.
    m = re.search(r"\s+\+\s+([a-z][a-z-]*)\s*$", name, re.I)
    if m and not re.search(r"\d", m.group(1)):
        p.mode.append(m.group(1).lower())
        name = name[: m.start()]
    elif re.search(r"\S\s+[+&]\s+\S", name):
        p.system = True

    # parenthesised groups: classify each; keep the ones that are part of the name
    kept: list[str] = []
    def paren(mo: re.Match) -> str:
        inner = mo.group(1)
        if _VERSION_TAG.match(inner.strip()):           # "(2507)", "(0125)": version tag, part of the name
            kept.append(inner.strip())
            return " "
        if _paren_kind(inner, name, p):
            return " "
        kept.append(inner.strip())
        return " "
    name = re.sub(r"\(([^()]*)\)", paren, name)
    name = " ".join([name.strip(), *kept]).strip()

    # trailing precision words ("Ling 3.0 Flash FP8", "Nemotron 3.5 Bolt E4B BF16", "-NVFP4")
    while True:
        m = re.search(r"[\s-]+(" + "|".join(_PRECISION) + r")\s*$", name, re.I)
        if not m:
            break
        p.mode.append(m.group(1).lower())
        name = name[: m.start()]

    # "-thinking-high", "-thinking-minimal" (gemini live preview ids)
    m = re.search(r"[\s-]+thinking[\s-]+(minimal|low|medium|high|xhigh|max)\s*$", name, re.I)
    if m and not separate_thinking(name):
        p.effort = p.effort or normalize_effort(m.group(1))
        name = name[: m.start()]

    # "Thinking xHigh Effort": thinking AND an effort level are two settings (LiveBench lists
    # "Claude 4.5 Opus High Effort" and "… Thinking High Effort" as different runs) -> effort + mode thinking
    if re.search(r"\bthinking\s+(minimal|low|medium|high|xhigh|x-high|max|maximum)\s+effort\s*$", name, re.I) \
            and not separate_thinking(name):
        p.mode.append("thinking")
    # "Thinking xHigh Effort", "Max Effort", trailing "Thinking", bare trailing level
    base, eff = split_effort(name)
    if eff and not (eff == "enabled" and separate_thinking(name)):   # a separate *-Thinking model keeps its name
        p.effort = p.effort or eff
        name = base

    # thinking / reasoner / non-thinking words inside the name
    if re.search(rf"(^|[\s-])({_THINK_OFF})($|[\s-])", name, re.I):
        p.effort = p.effort or "none"
        name = re.sub(rf"[\s-]*({_THINK_OFF})(?=$|[\s-])", "", name, flags=re.I)
    if not separate_thinking(name) and re.search(rf"(^|[\s-])({_THINK_ON})($|[\s-])", name, re.I):
        p.effort = p.effort or "enabled"
        name = re.sub(rf"[\s-]*\b({_THINK_ON})\b", "", name, flags=re.I)

    # dated snapshot inside the name: claude-3-5-sonnet-20241022, gpt-4o-2024-08-06
    m = _EMBEDDED_DATE.search(name) or _TRAILING_MONTH_YEAR.search(name.strip())
    if m:
        p.snapshot = p.snapshot or m.group(1)
        name = name.strip()
        name = (name[: m.start()] + name[m.end():])

    p.base = re.sub(r"\s{2,}", " ", name).strip(" -_")
    return p


# spellings of the same word ("R+" is "R Plus": the plus sign must not vanish)
_SYNONYMS = [
    (re.compile(r"\bexp\b", re.I), "experimental"),
    (re.compile(r"(?<=\w)\+"), " plus"),
    # "v" before a version number is not part of the name: Nova Pro v1 == Nova Pro 1.0, DeepSeek-V3 == DeepSeek 3
    # (but "GPT-4V" keeps its V: there it follows the number and means vision)
    (re.compile(r"\bv(?=\d)", re.I), " "),
    # a leading vendor word is not part of the name: NVIDIA-Nemotron-3-Nano == Nemotron-3-Nano, Meta-Llama-3 == Llama-3
    (re.compile(r"^\s*(nvidia|meta|amazon|google|microsoft|mistralai|openai|anthropic|ibm|alibaba)(?=[\s._-]+\w)", re.I), ""),
]
_LETTER_DIGIT = re.compile(r"(?<=[a-z])(?=\d)|(?<=\d)(?=[a-z])")


def _norm(base: str) -> str:
    for pat, rep_ in _SYNONYMS:
        base = pat.sub(rep_, base)
    return base


def _key(base: str) -> str:
    """Words in any order, numbers in order; dates and a trailing ".0" ignored. Unlike the old
    canonical_key it does not strip effort words: parse_raw has already decided what is effort."""
    text = _LETTER_DIGIT.sub(" ", _EMBEDDED_DATE.sub(" ", _norm(base).lower()))
    tokens = [t for t in re.split(r"[^a-z0-9]+", text) if t]
    words = sorted({t for t in tokens if not t.isdigit()})
    numbers = [t for t in tokens if t.isdigit()]
    while len(numbers) > 1 and numbers[-1].strip("0") == "":
        numbers.pop()
    return "-".join(words) + ("#" + ".".join(numbers) if numbers else "")


def strict_key(base: str) -> str:
    """Identity key: two names with the same strict key are the same model."""
    return _key(base)


def compact_key(base: str) -> str:
    """Letters and digits only, in order ("HunyuanTurboS" == "Hunyuan Turbo S"): review candidates."""
    return re.sub(r"[^a-z0-9]", "", base.replace("+", "plus").lower())


def loose_key(base: str) -> str:
    """Like strict_key without packaging/vendor words and 'v' prefixes: equal loose keys are review candidates."""
    k = _key(base)
    words, _, nums = k.partition("#")
    kept = [w for w in words.split("-") if w and w not in _SOFT_WORDS]
    return "-".join(kept) + (f"#{nums}" if nums else "")


# --------------------------------------------------------------------------------------------------
# vendor prefix and slugs

VENDOR_SLUGS = {
    "anthropic": "anthropic", "openai": "openai", "google": "google", "meta": "meta",
    "alibaba": "alibaba", "alibaba qwen": "alibaba", "qwen": "alibaba", "deepseek": "deepseek",
    "xai": "xai", "xai (spacex)": "xai", "mistral": "mistral", "moonshot ai": "moonshot", "moonshot": "moonshot",
    "z.ai": "zhipu", "zhipu (z.ai)": "zhipu", "zhipu": "zhipu", "minimax": "minimax", "nvidia": "nvidia",
    "amazon": "amazon", "microsoft": "microsoft", "cohere": "cohere", "bytedance": "bytedance",
    "baidu": "baidu", "tencent": "tencent", "xiaomi": "xiaomi", "upstage": "upstage", "inclusionai": "inclusionai",
    "stepfun": "stepfun", "ibm": "ibm", "01.ai": "01-ai", "allen institute for ai": "allenai", "allenai": "allenai",
    "ai21 labs": "ai21", "hugging face": "huggingface", "lg ai research": "lg", "shanghai ai lab": "shanghai-ai-lab",
    "reka": "reka", "abacus.ai": "abacus-ai", "unknown": "unknown", "other": "unknown", "system": "system",
    "lmsys": "lmsys", "databricks": "databricks", "tii": "tii", "openbmb": "openbmb", "snowflake": "snowflake",
    "stability ai": "stability-ai", "openchat": "openchat", "nexusflow": "nexusflow", "nous research": "nous-research",
    "rwkv": "rwkv", "laion": "laion", "prime intellect": "prime-intellect", "stanford": "stanford", "uc berkeley": "berkeley",
}


def slugify(text: str) -> str:
    s = text.lower().replace("’", "").replace("'", "")
    s = re.sub(r"[^a-z0-9.+]+", "-", s)
    s = re.sub(r"(?<![0-9])\.|\.(?![0-9])", "-", s)   # dots only between digits
    return re.sub(r"-{2,}", "-", s).strip("-")


def vendor_slug(vendor: str | None) -> str:
    v = (vendor or "").strip().lower()
    return VENDOR_SLUGS.get(v) or slugify(v) or "unknown"


def model_id(vendor: str | None, name: str) -> str:
    return f"{vendor_slug(vendor)}/{slugify(name)}"
