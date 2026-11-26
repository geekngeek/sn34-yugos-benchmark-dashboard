"""Model ID rules (importer/model_ids.py): every case here came from a real source name."""
import pytest

from importer.model_ids import compact_key, loose_key, model_id, parse_raw, slugify, strict_key


def key(raw: str) -> str:
    return strict_key(parse_raw(raw).base)


@pytest.mark.parametrize("raw, base, effort, mode, snapshot", [
    ("Claude 4.5 Opus Thinking High Effort", "Claude 4.5 Opus", "high", "thinking", None),   # two settings
    ("Claude 4.5 Opus High Effort", "Claude 4.5 Opus", "high", None, None),                  # effort only
    ("Claude 4.8 Opus Thinking Max Effort", "Claude 4.8 Opus", "max", "thinking", None),
    ("Claude Opus 4.5 (Thinking, High)", "Claude Opus 4.5", "high", "thinking", None),
    ("gemini-2.5-pro-preview-06-05 (32k think)", "gemini-2.5-pro-preview-06-05", "enabled", "thinking-32k", None),
    ("gemini-2.5-pro-preview-06-05 (default think)", "gemini-2.5-pro-preview-06-05", "enabled", None, None),
    ("Claude 3.7 Sonnet Thinking", "Claude 3.7 Sonnet", "enabled", None, None),
    ("Claude-3.7-Sonnet (Think)", "Claude-3.7-Sonnet", "enabled", None, None),
    ("Claude 5.2 Fable (xhigh)", "Claude 5.2 Fable", "xhigh", None, None),
    ("GPT-5.6 Terra (High, Default Fallback)", "GPT-5.6 Terra", "high", None, None),
    ("GPT-5.2 (Search, Non-Reasoning)", "GPT-5.2", "none", "search", None),
    ("Gemini 3 Pro (Grounding)", "Gemini 3 Pro", None, "search", None),
    ("GPT-5.5 (Codex Harness)", "GPT-5.5", None, "codex-harness", None),
    ("grok-voice-think-fast-1.0 + tool-mentor", "grok-voice-think-fast-1.0", None, "tool-mentor", None),
    ("Grok 4.1 Fast (Reasoning)", "Grok 4.1 Fast", "enabled", None, None),
    ("Grok 4.1 Fast (Non-Reasoning)", "Grok 4.1 Fast", "none", None, None),
    ("DeepSeek-V3.2-Exp (Reasoner)", "DeepSeek-V3.2-Exp", "enabled", None, None),
    ("DeepSeek-V3.2-Exp (Chat)", "DeepSeek-V3.2-Exp", "none", None, None),
    ("DeepSeek-V3.1-NonThinking", "DeepSeek-V3.1", "none", None, None),
    ("Gemini 2.5 Flash (Max Thinking)", "Gemini 2.5 Flash", "max", None, None),
    ("gemini-3.1-flash-live-preview-thinking-high", "gemini-3.1-flash-live-preview", "high", None, None),
    ("Llama 3.1 405B Instruct (FP8)", "Llama 3.1 405B Instruct", None, "fp8", None),
    ("Nemotron 3.5 Bolt E4B BF16", "Nemotron 3.5 Bolt E4B", None, "bf16", None),
    ("claude-3-5-sonnet-20241022", "claude-3-5-sonnet", None, None, "20241022"),
    ("Claude 3.5 Sonnet (October 2024)", "Claude 3.5 Sonnet", None, None, "October 2024"),
    ("qwen-max-2025-01-25", "qwen-max", None, None, "2025-01-25"),
    ("Command R+ (08-2024)", "Command R+", None, None, "08-2024"),
    ("command-r-plus-08-2024", "command-r-plus", None, None, "08-2024"),
    ("amazon-nova-experimental-chat (10-09)", "amazon-nova-experimental-chat", None, None, "10-09"),
])
def test_parse(raw, base, effort, mode, snapshot):
    p = parse_raw(raw)
    assert (p.base, p.effort, p.mode_str, p.snapshot) == (base, effort, mode, snapshot)


@pytest.mark.parametrize("a, b", [
    ("Claude Opus 4.5", "claude-opus-4-5-20251101"),           # word order, dashes, date stamp
    ("Claude 4.5 Opus Thinking High Effort", "Claude Opus 4.5"),
    ("Command R+ (08-2024)", "Command R Plus"),                # "+" is "Plus"
    ("NVIDIA-Nemotron-3-Nano-30B-A3B", "Nemotron-3-Nano-30B-A3B"),   # leading vendor word
    ("Meta-Llama-3-70B-Instruct", "Llama 3 70B Instruct"),
    ("nova-pro-v1", "Amazon Nova Pro 1.0"),                    # "v" before a number, ".0"
    ("Amazon.nova Premier v1:0", "nova-premier-v1"),
    ("gemini-2.0-flash-exp", "Gemini 2.0 Flash (Experimental)"),  # exp == experimental
    ("DeepSeek-V3", "DeepSeek V3"),
    ("Kimi K2.5 Thinking", "kimi-k2.5"),                       # hybrid model: thinking is effort
    ("Qwen 3 235B A22B Thinking", "Qwen3-235B-A22B"),          # original Qwen3 is hybrid
    ("gpt-4o-2024-08-06", "GPT-4o"),                           # dated snapshot of the same model
])
def test_same_model(a, b):
    assert key(a) == key(b)


@pytest.mark.parametrize("a, b", [
    ("Command R+", "Command R"),                              # "+" must not vanish
    ("Kimi K2 Thinking", "Kimi K2"),                          # released as its own model
    ("Qwen3-235B-A22B-Thinking-2507", "Qwen3-235B-A22B-Instruct-2507"),
    ("Qwen3-235B-A22B-Thinking-2507", "Qwen 3 235B A22B"),
    ("GPT-4V", "GPT-4"),                                      # V after the number means vision
    ("GPT-5", "GPT-5.5"), ("GPT-5.4", "GPT-4.5"),             # version order matters
    ("Qwen2.5-Coder (7B)", "Qwen2.5-Coder"),                  # a size in brackets can be the identity
    ("General-Reasoner-14B", "General-14B"),                  # "Reasoner" is part of this model's name
    ("Phi-4-reasoning", "Phi-4"),
    ("Sonar Reasoning Pro", "Sonar Pro"),                     # Perplexity sells these as two models
    ("Yi-34B", "Yi-34B-Chat"),                                # base and chat are different weights
    ("Gemma 3 27B", "Gemma 3 27B IT"),
    ("Mistral Medium", "Mistral Small"),
])
def test_different_models(a, b):
    assert key(a) != key(b)


@pytest.mark.parametrize("raw", ["DeepSeek R1 + claude-3-5-sonnet-20241022", "o3 (high) + gpt-4.1",
                                 "GPT-4o & Claude 3 Opus", "Qwen2.5 (7B + 72B)"])
def test_two_models_are_a_system(raw):
    p = parse_raw(raw)
    assert p.system and not p.mode
    assert key(raw) != key("DeepSeek R1") and key(raw) != key("o3")


def test_add_on_is_a_mode_not_a_system():
    p = parse_raw("grok-voice-think-fast-1.0 + tool-mentor")
    assert (p.system, p.mode_str, p.base) == (False, "tool-mentor", "grok-voice-think-fast-1.0")


def test_size_in_brackets_is_only_a_note_when_the_name_has_a_size():
    assert parse_raw("Mixtral-8x22B (39B/141B)").notes == ["39B/141B"]
    assert parse_raw("Qwen2.5-Coder (7B)").base == "Qwen2.5-Coder 7B"


def test_review_keys():
    # packaging words only meet in the loose key: reported for review, not merged
    assert loose_key("Gemma 3 27B IT") == loose_key("Gemma 3 27B")
    assert strict_key("Gemma 3 27B IT") != strict_key("Gemma 3 27B")
    assert compact_key("HunyuanTurboS") == compact_key("Hunyuan TurboS")


def test_ids():
    assert slugify("Claude Opus 4.5") == "claude-opus-4.5"
    assert slugify("Qwen3.8 Max") == "qwen3.8-max"
    assert model_id("Alibaba Qwen", "qwen3.8-max") == "alibaba/qwen3.8-max"
    assert model_id("Zhipu (Z.ai)", "glm-5.4") == "zhipu/glm-5.4"
    assert model_id("xAI (SpaceX)", "grok-4.20") == "xai/grok-4.20"
