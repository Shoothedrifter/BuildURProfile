"""Version-one private worker protocol owned by the Node API.

Only this adapter receives the service token. Payment routes and database files
are never visible to Python Skills or graph state.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import httpx


class LeaseLost(RuntimeError):
    """A stale worker must not write an asset or terminal task state."""


class CancelRequested(RuntimeError):
    """The owner requested cancellation before the next side effect."""


@dataclass(frozen=True)
class AgentTask:
    id: str
    lease_token: str
    workflow_version: str
    brief: dict | None
    config: dict | None
    portrait_asset_id: str | None
    style_id: str | None
    output_asset_id: str | None

    @classmethod
    def from_json(cls, value: dict[str, Any]) -> "AgentTask":
        if not isinstance(value.get("id"), str) or not isinstance(value.get("leaseToken"), str):
            raise ValueError("Invalid lease response")
        return cls(value["id"], value["leaseToken"], value.get("workflowVersion", ""),
                   value.get("brief"), value.get("config"), value.get("portraitAssetId"),
                   value.get("styleId"), value.get("outputAssetId"))


@dataclass(frozen=True)
class ResumeParseTask:
    id: str
    lease_token: str
    workflow_version: str
    resume_id: str
    file_id: str
    page_count: int
    uploaded_at: str
    expires_at: str

    @classmethod
    def from_json(cls, value: dict[str, Any]) -> "ResumeParseTask":
        keys = ("id", "leaseToken", "resumeId", "fileId", "uploadedAt", "expiresAt")
        if any(not isinstance(value.get(key), str) or not value[key] for key in keys):
            raise ValueError("Invalid resume lease response")
        if value.get("workflowVersion") != "resume-parse-v1" or type(value.get("pageCount")) is not int or not 1 <= value["pageCount"] <= 20:
            raise ValueError("Invalid resume lease response")
        return cls(value["id"], value["leaseToken"], value["workflowVersion"],
                   value["resumeId"], value["fileId"], value["pageCount"],
                   value["uploadedAt"], value["expiresAt"])


@dataclass(frozen=True)
class Portrait:
    bytes: bytes
    mime: str


class NodeAgentClient:
    def __init__(self, base_url: str, service_token: str, *, timeout: float = 30.0,
                 http: httpx.AsyncClient | None = None) -> None:
        if len(service_token) < 32:
            raise ValueError("AGENT_SERVICE_TOKEN must have at least 32 characters")
        self._owns_http = http is None
        self._http = http or httpx.AsyncClient(base_url=base_url.rstrip("/"),
            headers={"authorization": f"Bearer {service_token}"}, timeout=timeout, trust_env=False)

    async def close(self) -> None:
        if self._owns_http:
            await self._http.aclose()

    async def _request(self, method: str, path: str, *, lease: str | None = None,
                       json: dict | None = None, content: bytes | None = None,
                       mime: str | None = None) -> httpx.Response:
        headers = {"x-agent-lease": lease} if lease else {}
        if mime:
            headers["content-type"] = mime
        response = await self._http.request(method, path, headers=headers, json=json, content=content)
        if response.status_code == 409:
            raise LeaseLost("Agent lease is no longer active")
        response.raise_for_status()
        return response

    async def lease(self, worker_id: str) -> AgentTask | None:
        response = await self._request("POST", "/_internal/agent/lease", json={"workerId": worker_id})
        return None if response.status_code == 204 else AgentTask.from_json(response.json())

    async def touch_worker(self, worker_id: str) -> None:
        await self._request("POST", "/_internal/agent/heartbeat", json={"workerId": worker_id})

    async def heartbeat(self, task: AgentTask) -> dict:
        response = await self._request("POST", f"/_internal/agent/tasks/{task.id}/heartbeat",
                                       json={"leaseToken": task.lease_token})
        result = response.json()
        if not result.get("ok"):
            raise LeaseLost("Agent lease is no longer active")
        return result

    async def check_cancel(self, task: AgentTask) -> None:
        if (await self.heartbeat(task)).get("cancelRequested"):
            raise CancelRequested("Generation was cancelled by its owner")

    async def portrait(self, task: AgentTask) -> Portrait:
        response = await self._request("GET", f"/_internal/agent/tasks/{task.id}/portrait",
                                       lease=task.lease_token)
        return Portrait(response.content, response.headers.get("content-type", ""))

    async def recipe(self, task: AgentTask) -> dict:
        response = await self._request("GET", f"/_internal/agent/tasks/{task.id}/recipe",
                                       lease=task.lease_token)
        return response.json()

    async def output(self, task: AgentTask) -> dict:
        response = await self._request("GET", f"/_internal/agent/tasks/{task.id}/output",
                                       lease=task.lease_token)
        return response.json()

    async def store_output(self, task: AgentTask, image: Any) -> str:
        response = await self._request("POST", f"/_internal/agent/tasks/{task.id}/output",
                                       lease=task.lease_token, content=image.bytes, mime=image.mime)
        result = response.json()
        if not isinstance(result.get("assetId"), str):
            raise ValueError("Invalid image asset response")
        return result["assetId"]

    async def complete(self, task: AgentTask, config: dict) -> bool:
        response = await self._request("POST", f"/_internal/agent/tasks/{task.id}/complete",
                                       json={"leaseToken": task.lease_token, "config": config})
        return bool(response.json().get("ok"))

    async def fail(self, task: AgentTask, code: str, *, retryable: bool) -> bool:
        response = await self._request("POST", f"/_internal/agent/tasks/{task.id}/fail",
                                       json={"leaseToken": task.lease_token, "errorCode": code,
                                             "retryable": retryable})
        return bool(response.json().get("ok"))

    async def ack_cancel(self, task: AgentTask) -> bool:
        response = await self._request("POST", f"/_internal/agent/tasks/{task.id}/ack-cancel",
                                       json={"leaseToken": task.lease_token})
        return bool(response.json().get("ok"))


    async def lease_resume(self, worker_id: str) -> ResumeParseTask | None:
        response = await self._request("POST", "/_internal/agent/resume-tasks/lease",
                                       json={"workerId": worker_id})
        return None if response.status_code == 204 else ResumeParseTask.from_json(response.json())

    async def resume_source(self, task: ResumeParseTask) -> bytes:
        response = await self._request("GET", f"/_internal/agent/resume-tasks/{task.id}/source",
                                       lease=task.lease_token)
        return response.content

    async def heartbeat_resume(self, task: ResumeParseTask, *, stage: str | None = None,
                               progress: int | None = None) -> dict:
        payload: dict[str, Any] = {"leaseToken": task.lease_token}
        if stage is not None:
            payload["stage"] = stage
        if progress is not None:
            payload["progress"] = progress
        response = await self._request("POST", f"/_internal/agent/resume-tasks/{task.id}/heartbeat", json=payload)
        result = response.json()
        if not result.get("ok"):
            raise LeaseLost("Resume lease is no longer active")
        return result

    async def complete_resume(self, task: ResumeParseTask, source: dict, draft: dict) -> bool:
        response = await self._request("POST", f"/_internal/agent/resume-tasks/{task.id}/complete",
                                       json={"leaseToken": task.lease_token, "source": source, "draft": draft})
        return bool(response.json().get("ok"))

    async def fail_resume(self, task: ResumeParseTask, code: str, *, retryable: bool) -> bool:
        response = await self._request("POST", f"/_internal/agent/resume-tasks/{task.id}/fail",
                                       json={"leaseToken": task.lease_token, "errorCode": code,
                                             "retryable": retryable})
        return bool(response.json().get("ok"))

    async def ack_cancel_resume(self, task: ResumeParseTask) -> bool:
        response = await self._request("POST", f"/_internal/agent/resume-tasks/{task.id}/ack-cancel",
                                       json={"leaseToken": task.lease_token})
        return bool(response.json().get("ok"))
