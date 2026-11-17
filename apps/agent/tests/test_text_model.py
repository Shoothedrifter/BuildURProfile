"""Text model adapter: siliconflow chat.completions 路径与 Qwen3 思考开关。"""

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from buildurprofile_agent.providers.text_model import (
    FallbackTextModel, FormattedOutputError, OpenAIResumeTextModel, ResumeTextModelError,
    build_text_model, parse_fallback_candidates,
)


def chat_client(reply: str):
    # 注入假 client：只实现 chat.completions.create，记录请求参数
    create = AsyncMock(return_value=SimpleNamespace(
        choices=[SimpleNamespace(message=SimpleNamespace(content=reply))]))
    return SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create)))


@pytest.mark.asyncio
async def test_siliconflow_calls_chat_completions_with_json_object():
    client = chat_client('{"items": []}')
    model = OpenAIResumeTextModel(provider="siliconflow",
                                  model="deepseek-ai/DeepSeek-V4.1-Flash",
                                  api_key="sk-test", client=client)
    result = await model.generate_json("resume_format_v1", {"type": "object"}, "prompt text")
    assert result == {"items": []}
    kwargs = client.chat.completions.create.call_args.kwargs
    assert kwargs["model"] == "deepseek-ai/DeepSeek-V4.1-Flash"
    assert kwargs["response_format"] == {"type": "json_object"}
    joined = "".join(m["content"] for m in kwargs["messages"])
    assert "prompt text" in joined
    assert '"type": "object"' in joined  # schema 文字进消息
    assert "enable_thinking" not in str(kwargs)


@pytest.mark.asyncio
async def test_qwen3_candidate_disables_thinking():
    client = chat_client("{}")
    model = OpenAIResumeTextModel(provider="siliconflow", model="Qwen/Qwen3-8B",
                                  api_key="sk-test", client=client)
    result = await model.generate_json("resume_format_v1", {"type": "object"}, "p")
    assert result == {}
    kwargs = client.chat.completions.create.call_args.kwargs
    assert kwargs.get("extra_body") == {"enable_thinking": False}


@pytest.mark.asyncio
async def test_non_qwen3_candidate_omits_enable_thinking():
    client = chat_client("{}")
    model = OpenAIResumeTextModel(provider="siliconflow", model="Qwen/Qwen2.5-7B-Instruct",
                                  api_key="sk-test", client=client)
    await model.generate_json("resume_format_v1", {"type": "object"}, "p")
    kwargs = client.chat.completions.create.call_args.kwargs
    assert "extra_body" not in kwargs


class SequenceModel:
    """按脚本逐次应答的假模型：raises 里的元素依次抛出，之后返回 answer。"""
    def __init__(self, answer: dict, raises: list[ResumeTextModelError]):
        self.answer, self.raises, self.calls = answer, list(raises), 0

    async def generate_json(self, name, schema, prompt):
        index = self.calls
        self.calls += 1
        if index < len(self.raises):
            raise self.raises[index]
        return self.answer


@pytest.mark.asyncio
async def test_fallback_switches_to_next_candidate_on_any_error():
    first = SequenceModel({}, [ResumeTextModelError(reason="RATE_LIMITED", retryable=True)])
    second = SequenceModel({"items": []}, [])
    chain = FallbackTextModel([first, second])
    assert await chain.generate_json("n", {"type": "object"}, "p") == {"items": []}
    assert (first.calls, second.calls) == (1, 1)


@pytest.mark.asyncio
async def test_fallback_switches_on_invalid_output():
    first = SequenceModel({}, [ResumeTextModelError(reason="INVALID_OUTPUT")])
    second = SequenceModel({"ok": True}, [])
    assert await FallbackTextModel([first, second]).generate_json("n", {}, "p") == {"ok": True}


@pytest.mark.asyncio
async def test_fallback_raises_last_error_when_all_candidates_fail():
    first = SequenceModel({}, [ResumeTextModelError(reason="RATE_LIMITED", retryable=True)])
    last = SequenceModel({}, [ResumeTextModelError(reason="NETWORK_ERROR", retryable=True)])
    with pytest.raises(ResumeTextModelError) as error:
        await FallbackTextModel([first, last]).generate_json("n", {}, "p")
    assert error.value.reason == "NETWORK_ERROR"  # 最后候选的错误上抛，含单候选链等价现状


def test_parse_fallback_candidates_builds_ordered_chain(monkeypatch):
    monkeypatch.setenv("SILICONFLOW_API_KEY", "sk-a")
    monkeypatch.setenv("ZAI_API_KEY", "sk-b")
    models = parse_fallback_candidates(
        "siliconflow:deepseek-ai/DeepSeek-V4.1-Flash,siliconflow:Qwen/Qwen3-8B,zai:glm-5.3-flash")
    assert [(m.provider, m.model) for m in models] == [
        ("siliconflow", "deepseek-ai/DeepSeek-V4.1-Flash"),
        ("siliconflow", "Qwen/Qwen3-8B"), ("zai", "glm-5.3-flash")]


def test_parse_fallback_candidates_skips_candidate_without_key(monkeypatch):
    monkeypatch.delenv("SILICONFLOW_API_KEY", raising=False)
    monkeypatch.setenv("ZAI_API_KEY", "sk-b")
    models = parse_fallback_candidates("siliconflow:Qwen/Qwen3-8B,zai:glm-5.3-flash")
    assert [m.provider for m in models] == ["zai"]


def test_parse_fallback_candidates_rejects_bad_syntax(monkeypatch):
    monkeypatch.setenv("SILICONFLOW_API_KEY", "sk-a")
    for raw in ("baidu:ernie", "siliconflow:"):
        with pytest.raises(ResumeTextModelError, match="CONFIG_INVALID"):
            parse_fallback_candidates(raw)


def test_build_text_model_uses_chain_when_configured_and_ignores_single_vars(monkeypatch):
    monkeypatch.setenv("RESUME_TEXT_FALLBACKS", "siliconflow:Qwen/Qwen3-8B")
    monkeypatch.setenv("SILICONFLOW_API_KEY", "sk-a")
    monkeypatch.setenv("RESUME_TEXT_PROVIDER", "zai")
    assert isinstance(build_text_model(), FallbackTextModel)


def test_build_text_model_falls_back_to_single_candidate(monkeypatch):
    monkeypatch.delenv("RESUME_TEXT_FALLBACKS", raising=False)
    assert isinstance(build_text_model(), OpenAIResumeTextModel)


def test_build_text_model_missing_all_keys(monkeypatch):
    monkeypatch.setenv("RESUME_TEXT_FALLBACKS", "siliconflow:Qwen/Qwen3-8B")
    monkeypatch.delenv("SILICONFLOW_API_KEY", raising=False)
    with pytest.raises(ResumeTextModelError, match="CONFIG_MISSING"):
        build_text_model()


@pytest.mark.asyncio
async def test_run_with_fallback_retries_same_candidate_before_switching():
    # 候选一首次输出未过内容校验 → 同候选重采样（新一次 LLM 调用）即可成功，不换候选
    flaky = SequenceModel({"v": 1}, [])
    second = SequenceModel({"v": 2}, [])
    seen = []

    async def attempt(candidate):
        seen.append(candidate)
        answer = await candidate.generate_json("n", {}, "p")
        if candidate is flaky and answer["v"] == 1 and seen.count(flaky) == 1:
            raise FormattedOutputError("PARSE_FAILED: formatted number absent from source")
        return answer

    assert await FallbackTextModel([flaky, second]).run_with_fallback(attempt) == {"v": 1}
    assert seen == [flaky, flaky]


@pytest.mark.asyncio
async def test_run_with_fallback_switches_on_formatted_output_error():
    # 候选一连续 3 次输出都不合格（单次失败率 ~50% 的实测背景）→ 用尽重采样才换候选二
    first = SequenceModel({"v": 1}, [])
    second = SequenceModel({"v": 2}, [])
    seen = []

    async def attempt(candidate):
        seen.append(candidate)
        answer = await candidate.generate_json("n", {}, "p")
        if answer["v"] == 1:
            raise FormattedOutputError("PARSE_FAILED: formatted number absent from source")
        return answer

    assert await FallbackTextModel([first, second]).run_with_fallback(attempt) == {"v": 2}
    assert seen == [first, first, first, second]


@pytest.mark.asyncio
async def test_run_with_fallback_switches_on_text_model_error():
    first = SequenceModel({}, [ResumeTextModelError(reason="RATE_LIMITED", retryable=True)] * 3)
    second = SequenceModel({"ok": True}, [])
    calls = []

    async def attempt(candidate):
        calls.append(candidate)
        return await candidate.generate_json("n", {}, "p")

    assert await FallbackTextModel([first, second]).run_with_fallback(attempt) == {"ok": True}
    assert calls == [first, first, first, second]


@pytest.mark.asyncio
async def test_run_with_fallback_raises_last_error_when_all_candidates_fail():
    # 全链尽抛最后一个候选的错误；最后是内容校验失败时保留 FormattedOutputError 类型
    first = SequenceModel({}, [ResumeTextModelError(reason="RATE_LIMITED", retryable=True)])
    last = SequenceModel({}, [])

    async def attempt(candidate):
        await candidate.generate_json("n", {}, "p")
        raise FormattedOutputError("PARSE_FAILED: formatted number absent from source")

    with pytest.raises(FormattedOutputError, match="absent from source"):
        await FallbackTextModel([first, last]).run_with_fallback(attempt)


@pytest.mark.asyncio
async def test_run_with_fallback_does_not_swallow_unrelated_errors():
    # 代码缺陷（如 KeyError）不是「候选不合格」：不得触发切换，原样上抛
    first = SequenceModel({"ok": True}, [])
    second = SequenceModel({"ok": True}, [])

    async def attempt(candidate):
        raise KeyError("bug")

    with pytest.raises(KeyError):
        await FallbackTextModel([first, second]).run_with_fallback(attempt)
    assert (first.calls, second.calls) == (0, 0)


@pytest.mark.asyncio
async def test_run_with_fallback_without_candidates_raises_config_missing():
    async def attempt(candidate):
        return {}

    with pytest.raises(ResumeTextModelError, match="CONFIG_MISSING"):
        await FallbackTextModel([]).run_with_fallback(attempt)


@pytest.mark.asyncio
async def test_single_candidate_run_with_fallback_passes_errors_through():
    # 单候选适配器：attempt 抛什么冒什么，不吞不换（与无链现状一致）
    model = OpenAIResumeTextModel(provider="siliconflow", model="m", api_key="k")

    async def bad(candidate):
        raise FormattedOutputError("PARSE_FAILED: x")

    with pytest.raises(FormattedOutputError):
        await model.run_with_fallback(bad)
