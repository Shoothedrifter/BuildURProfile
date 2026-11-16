"""Text model adapter: siliconflow chat.completions 路径与 Qwen3 思考开关。"""

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from buildurprofile_agent.providers.text_model import OpenAIResumeTextModel


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
