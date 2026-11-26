"""Name normalization so one model from several sources lands on one row.

  canonical_key("Claude 5.5 Opus") == canonical_key("Claude Opus 5.5")
  split_effort("Claude 5.5 Opus Thinking xHigh Effort") -> ("Claude 5.5 Opus", "xhigh")
  normalize_provider("Z AI") -> "Z.ai"
"""
from __future__ import annotations

import re

# Stored vocabulary: none | minimal | low | medium | high | xhigh | max | enabled
_EFFORT_WORDS = {
    "non-reasoning": "none", "nonreasoning": "none", "none": "none",
    "minimal": "minimal", "low": "low", "medium": "medium", "high": "high",
    "xhigh": "xhigh", "x-high": "xhigh", "max": "max", "maximum": "max",
    "reasoning": "enabled", "thinking": "enabled",
}


def normalize_effort(value: str | None) -> str | None:
    if value is None:
        return None
    v = str(value).strip().lower().replace("_", " ")
    if not v:
        return None
    if v in _EFFORT_WORDS:
        return _EFFORT_WORDS[v]
    first = re.split(r"[,\s]+", v)[0]
    return _EFFORT_WORDS.get(first)


# "(xhigh)" / "(High, Default Fallback)" at the end of a name
_PAREN = re.compile(r"\s*\(([^()]*)\)\s*$")
# "... Thinking xHigh Effort", "... Max Effort", "... Thinking"
_EFFORT_SUFFIX = re.compile(
    r"(?:\s+thinking)?\s+(minimal|low|medium|high|xhigh|x-high|max|maximum)\s+effort\s*$", re.I)
_THINKING_SUFFIX = re.compile(r"\s+thinking\s*$", re.I)
# bare trailing level ("Gemini 3.7 Flash High"); "Max" is excluded on purpose:
# "Qwen3.8 Max" is a model name, LiveBench writes the effort as "Max Effort".
# Only stripped when the rest has a version number, so "Mistral Medium" stays.
_BARE_LEVEL = re.compile(r"\s+(minimal|low|medium|high|xhigh)\s*$", re.I)


def split_effort(name: str) -> tuple[str, str | None]:
    """Return (base name, effort). Date/snapshot parentheses such as "(Sep '25)"
    are kept: they mark a distinct model snapshot."""
    base = name.strip()
    effort = None
    m = _PAREN.search(base)
    if m and normalize_effort(m.group(1)) is not None:
        effort = normalize_effort(m.group(1))
        base = base[: m.start()].rstrip()
    m = _EFFORT_SUFFIX.search(base)
    if m:
        effort = effort or normalize_effort(m.group(1))
        base = base[: m.start()].rstrip()
    m = _THINKING_SUFFIX.search(base)
    if m:
        effort = effort or "enabled"
        base = base[: m.start()].rstrip()
    m = _BARE_LEVEL.search(base)
    if m and effort is None and re.search(r"\d", base[: m.start()]):
        effort = normalize_effort(m.group(1))
        base = base[: m.start()].rstrip()
    return base, effort


_DATE = re.compile(r"\b(\d{8}|\d{4}-\d{2}-\d{2})\b")


_LETTER_DIGIT = re.compile(r"(?<=[a-z])(?=\d)|(?<=\d)(?=[a-z])")


def canonical_key(name: str) -> str:
    """Model identity across sources: words in any order, numbers in order.

      'Claude 4.5 Opus' == 'Claude Opus 4.5' == 'claude-opus-4-5-20251101'  -> 'claude-opus#4.5'
      'Qwen3.8 Max' == 'Qwen 3.8 Max' == 'qwen3-8-max'                      -> 'max-qwen#3.8'
      'GPT-5' != 'GPT-5.5' != 'GPT-5.4' != 'GPT-4.5'  (the version sequence is kept)
    Effort suffixes and date stamps (20251101, 2025-12-11) are ignored; trailing
    ".0" is dropped so 'Mistral Large 4' == 'mistral-large-4-0'.
    """
    base, _ = split_effort(name)
    text = _LETTER_DIGIT.sub(" ", _DATE.sub(" ", base.lower()))
    tokens = [t for t in re.split(r"[^a-z0-9]+", text) if t]
    if not tokens:
        raise ValueError(f"cannot build a key from model name {name!r}")
    words = sorted({t for t in tokens if not t.isdigit()})
    numbers = [t for t in tokens if t.isdigit()]
    while len(numbers) > 1 and numbers[-1].strip("0") == "":
        numbers.pop()
    return "-".join(words) + ("#" + ".".join(numbers) if numbers else "")


_PROVIDERS = {
    "google": "Google", "google deepmind": "Google", "deepmind": "Google",
    "openai": "OpenAI", "anthropic": "Anthropic",
    "meta": "Meta", "meta ai": "Meta",
    "alibaba": "Alibaba", "qwen": "Alibaba", "alibaba cloud": "Alibaba",
    "z ai": "Z.ai", "z.ai": "Z.ai", "zai": "Z.ai", "z-ai": "Z.ai", "zhipu": "Z.ai", "zhipu ai": "Z.ai",
    "moonshot ai": "Moonshot AI", "moonshot": "Moonshot AI", "kimi": "Moonshot AI",
    "minimax": "MiniMax", "mistral": "Mistral", "mistral ai": "Mistral",
    "deepseek": "DeepSeek", "xai": "xAI", "x.ai": "xAI",
    "nvidia": "NVIDIA", "amazon": "Amazon", "aws": "Amazon", "microsoft": "Microsoft",
    "cohere": "Cohere", "bytedance": "ByteDance", "bytedance seed": "ByteDance",
    "abacus.ai": "Abacus.AI", "abacusai": "Abacus.AI",
}


def normalize_provider(name: str | None) -> str:
    if not name or not name.strip():
        return "Unknown"
    return _PROVIDERS.get(name.strip().lower(), name.strip())


# Developer guessed from a model name, for sources that only list model names.
# Order matters: fine-tune families first (e.g. "Llama-3.1-Nemotron" is NVIDIA's).
_DEVELOPER_PATTERNS: list[tuple[str, str]] = [
    (r"nemotron", "NVIDIA"),
    (r"^(gpt|o1|o3|o4|chatgpt|codex)\b|^gpt", "OpenAI"),
    (r"^claude", "Anthropic"),
    (r"^(gemini|gemma)", "Google"),
    (r"^(code)?llama", "Meta"),
    (r"^(qwen|qwq)", "Alibaba"),
    (r"^deepseek", "DeepSeek"),
    (r"^(mistral|mixtral|ministral|mathstral|codestral|magistral|devstral)", "Mistral"),
    (r"^grok", "xAI"),
    (r"^yi\b|^yi-", "01.AI"),
    (r"^(chat)?glm", "Z.ai"),
    (r"^phi", "Microsoft"),
    (r"^minimax", "MiniMax"),
    (r"^granite", "IBM"),
    (r"^(seed|doubao)", "ByteDance"),
    (r"^exaone", "LG AI Research"),
    (r"^hunyuan", "Tencent"),
    (r"^ernie", "Baidu"),
    (r"^intern", "Shanghai AI Lab"),
    (r"^jamba", "AI21 Labs"),
    (r"^(command|c4ai|aya|cohere)", "Cohere"),
    (r"^smollm", "Hugging Face"),
    (r"^mimo", "Xiaomi"),
    (r"^reka", "Reka"),
    (r"^kimi", "Moonshot AI"),
    (r"^olmo", "Allen Institute for AI"),
    # older / open families whose developer is well known (sources such as LMArena list no developer)
    (r"^pixtral", "Mistral"),
    (r"^(vicuna|fastchat|longchat)", "LMSYS"),
    (r"^zephyr", "Hugging Face"),
    (r"^(dbrx|dolly|mpt-)", "Databricks"),
    (r"^falcon", "TII"),
    (r"^(flan-t5|gopher|chinchilla)", "Google"),
    (r"^step-\d", "StepFun"),
    (r"^minicpm", "OpenBMB"),
    (r"^wizardlm", "Microsoft"),
    (r"^(tulu|molmo)", "Allen Institute for AI"),
    (r"^snowflake", "Snowflake"),
    (r"^stablelm", "Stability AI"),
    (r"^openchat", "OpenChat"),
    (r"^athene", "Nexusflow"),
    (r"^(nous-hermes|hermes-\d)", "Nous Research"),
    (r"^rwkv", "RWKV"),
    (r"^openassistant", "LAION"),
    (r"^intellect-\d", "Prime Intellect"),
    (r"^alpaca", "Stanford"),
    (r"^koala", "UC Berkeley"),
]


def infer_provider(model_name: str) -> str | None:
    """Best guess at the developer from a model name; None when unknown."""
    low = model_name.strip().lower()
    for pattern, dev in _DEVELOPER_PATTERNS:
        if re.search(pattern, low):
            return dev
    return None
