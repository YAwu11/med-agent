import aiohttp

import pytest

from app.core.sandbox.exceptions import SandboxRuntimeError
from app.core.tools.builtins.rag_retrieve import rag_retrieve_tool
from app.core.tools.errors import FatalToolExecutionError
from deerflow.sandbox.tools import read_file_tool


class _BrokenSession:
    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    def post(self, *_args, **_kwargs):
        raise aiohttp.ClientConnectionError("connection refused")


@pytest.mark.anyio
async def test_rag_retrieve_raises_fatal_error_when_service_is_unreachable(monkeypatch):
    monkeypatch.setattr(
        "app.core.tools.builtins.rag_retrieve.aiohttp.ClientSession",
        lambda timeout=None: _BrokenSession(),
    )

    with pytest.raises(FatalToolExecutionError, match="知识库检索服务连接失败"):
        await rag_retrieve_tool.ainvoke({"query": "肺炎诊疗指南"})


def test_read_file_raises_fatal_error_for_sandbox_runtime_failure(monkeypatch):
    monkeypatch.setattr(
        "deerflow.sandbox.tools.ensure_sandbox_initialized",
        lambda _runtime: (_ for _ in ()).throw(SandboxRuntimeError("sandbox provider mismatch")),
    )

    with pytest.raises(FatalToolExecutionError, match="sandbox provider mismatch"):
        read_file_tool.func(object(), "inspect file", "/mnt/user-data/workspace/report.txt")