"""Leased task consumer; Node remains the owner of task and asset state."""

from __future__ import annotations

import asyncio
import logging
import socket
import uuid
from contextlib import suppress
from typing import Any

import httpx

from .graph import WORKFLOW_VERSION, build_generation_graph, task_input
from .graphs.resume_parse import WORKFLOW_VERSION as RESUME_WORKFLOW_VERSION, build_resume_parse_graph
from .providers.base import ImageProviderError
from .providers.text_model import OpenAIResumeTextModel, ResumeTextModelError
from .skills.registry import SkillRegistry, default_registry
from .transport.node_api import AgentTask, CancelRequested, LeaseLost, NodeAgentClient, ResumeParseTask

log = logging.getLogger(__name__)


def failure_code(error: Exception) -> tuple[str, bool]:
    if isinstance(error, ImageProviderError):
        return error.code, error.retryable
    if isinstance(error, PermissionError):
        return "STYLE_UNAVAILABLE", False
    if isinstance(error, ValueError):
        return ("SKILL_VERSION_MISMATCH" if "SKILL_VERSION_MISMATCH" in str(error)
                else "INVALID_BRIEF"), False
    return "UNKNOWN", False


async def process_task(task: AgentTask, client: NodeAgentClient, provider: Any,
                       registry: SkillRegistry, checkpointer: Any, worker_id: str = "agent_test") -> None:
    processing: asyncio.Task | None = None
    reason: list[Exception] = []

    async def renew() -> None:
        while True:
            await asyncio.sleep(15)
            try:
                await client.touch_worker(worker_id)
                await client.check_cancel(task)
            except (CancelRequested, LeaseLost) as error:
                reason.append(error)
                if processing:
                    processing.cancel()
                return
            except Exception:
                # An unavailable Node API must not leave a long-running provider
                # request without a valid lease. The queue will retry after expiry.
                reason.append(LeaseLost("Task heartbeat failed"))
                if processing:
                    processing.cancel()
                return

    heart: asyncio.Task | None = None
    try:
        if task.workflow_version != WORKFLOW_VERSION:
            raise ValueError("SKILL_VERSION_MISMATCH")
        graph = build_generation_graph(task, client, provider, registry, checkpointer=checkpointer)
        processing = asyncio.create_task(graph.ainvoke(task_input(task), config={"configurable": {
            "thread_id": f"{task.id}:{task.lease_token}"}}))
        heart = asyncio.create_task(renew())
        result = await processing
        if not result.get("qa") or not result.get("config"):
            raise ValueError("INVALID_BRIEF")
        await client.check_cancel(task)
        if not await client.complete(task, result["config"]):
            raise LeaseLost("Task completed after lease expiry")
        log.info("agent task completed id=%s", task.id)
    except asyncio.CancelledError:
        if reason and isinstance(reason[0], CancelRequested):
            with suppress(LeaseLost):
                await client.ack_cancel(task)
            log.info("agent task cancelled id=%s", task.id)
        elif reason:
            log.warning("agent task lease lost id=%s", task.id)
        else:
            raise
    except CancelRequested:
        with suppress(LeaseLost):
            await client.ack_cancel(task)
        log.info("agent task cancelled id=%s", task.id)
    except LeaseLost:
        log.warning("agent task lease lost id=%s", task.id)
    except Exception as error:
        code, retryable = failure_code(error)
        log.warning("agent task failed id=%s code=%s", task.id, code)
        with suppress(LeaseLost):
            await client.fail(task, code, retryable=retryable)
    finally:
        if heart:
            heart.cancel()
            with suppress(asyncio.CancelledError):
                await heart


async def process_resume_task(task: ResumeParseTask, client: NodeAgentClient, model: Any,
                              registry: SkillRegistry, checkpointer: Any,
                              worker_id: str = "agent_test") -> None:
    processing: asyncio.Task | None = None
    reason: list[Exception] = []
    heart: asyncio.Task | None = None

    async def renew() -> None:
        while True:
            await asyncio.sleep(15)
            try:
                await client.touch_worker(worker_id)
                status = await client.heartbeat_resume(task)
                if status.get("cancelRequested"):
                    raise CancelRequested("Resume parsing was cancelled")
            except Exception as error:
                reason.append(error if isinstance(error, (CancelRequested, LeaseLost))
                              else LeaseLost("Resume heartbeat failed"))
                if processing:
                    processing.cancel()
                return

    try:
        if task.workflow_version != RESUME_WORKFLOW_VERSION:
            raise ValueError("SKILL_VERSION_MISMATCH")
        run = build_resume_parse_graph(task, client, model, registry, checkpointer=checkpointer)
        state = {"task_id": task.id, "file_id": task.file_id, "resume_id": task.resume_id,
                 "workflow_version": task.workflow_version, "stage": "queued"}
        processing = asyncio.create_task(run.graph.ainvoke(state, config={"configurable": {
            "thread_id": f"resume:{task.id}:{task.lease_token}"}}))
        heart = asyncio.create_task(renew())
        await processing
        status = await client.heartbeat_resume(task)
        if status.get("cancelRequested"):
            raise CancelRequested("Resume parsing was cancelled")
        if not await client.complete_resume(task, run.source.model_dump(), run.draft.model_dump()):
            raise LeaseLost("Resume completion lost its lease")
        log.info("resume parse completed id=%s", task.id)
    except asyncio.CancelledError:
        if reason and isinstance(reason[0], CancelRequested):
            with suppress(LeaseLost):
                await client.ack_cancel_resume(task)
            log.info("resume parse cancelled id=%s", task.id)
        elif reason:
            log.warning("resume parse lease lost id=%s", task.id)
        else:
            raise
    except CancelRequested:
        with suppress(LeaseLost):
            await client.ack_cancel_resume(task)
        log.info("resume parse cancelled id=%s", task.id)
    except LeaseLost:
        log.warning("resume parse lease lost id=%s", task.id)
    except Exception as error:
        code = ("SKILL_VERSION_MISMATCH" if "SKILL_VERSION_MISMATCH" in str(error)
                else "PDF_NO_TEXT" if "no extractable text" in str(error)
                else "PARSE_FAILED")
        retryable = (isinstance(error, ResumeTextModelError) and error.retryable
                     or isinstance(error, (httpx.TransportError, httpx.TimeoutException)))
        reason_code = error.reason if isinstance(error, ResumeTextModelError) else "PARSER_ERROR"
        log.warning("resume parse failed id=%s code=%s reason=%s", task.id, code, reason_code)
        with suppress(LeaseLost):
            await client.fail_resume(task, code, retryable=retryable)
    finally:
        if heart:
            heart.cancel()
            with suppress(asyncio.CancelledError):
                await heart


async def worker_loop(client: NodeAgentClient, provider: Any, checkpointer: Any,
                      *, registry: SkillRegistry | None = None,
                      worker_id: str | None = None, poll_seconds: float = 2.0) -> None:
    registry = registry or default_registry()
    worker_id = worker_id or f"agent_{socket.gethostname().split('.')[0]}_{uuid.uuid4().hex[:8]}"
    if len(worker_id) > 100 or not all(c.isalnum() or c in "_-" for c in worker_id):
        raise ValueError("Invalid AGENT_WORKER_ID")
    while True:
        try:
            await client.touch_worker(worker_id)
            task = await client.lease(worker_id)
            if task:
                await process_task(task, client, provider, registry, checkpointer, worker_id)
                continue
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("agent poll failed")
        await asyncio.sleep(poll_seconds)


async def resume_worker_loop(client: NodeAgentClient, checkpointer: Any,
                             *, registry: SkillRegistry | None = None,
                             worker_id: str | None = None, poll_seconds: float = 2.0,
                             text_model: Any = None) -> None:
    registry = registry or default_registry()
    text_model = text_model or OpenAIResumeTextModel()
    worker_id = worker_id or f"resume_{socket.gethostname().split('.')[0]}_{uuid.uuid4().hex[:8]}"
    if len(worker_id) > 100 or not all(c.isalnum() or c in "_-" for c in worker_id):
        raise ValueError("Invalid AGENT_WORKER_ID")
    while True:
        try:
            await client.touch_worker(worker_id)
            task = await client.lease_resume(worker_id)
            if task:
                await process_resume_task(task, client, text_model, registry, checkpointer,
                                          worker_id)
                continue
        except asyncio.CancelledError:
            raise
        except Exception:
            log.warning("resume poll failed code=UNKNOWN")
        await asyncio.sleep(poll_seconds)
