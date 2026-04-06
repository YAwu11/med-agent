from app.core.reflection import resolve_class
from app.core.sandbox.sandbox_provider import SandboxProvider


def test_app_core_sandbox_provider_accepts_deerflow_provider_path():
    resolved = resolve_class("deerflow.sandbox.local:LocalSandboxProvider", SandboxProvider)

    assert resolved.__name__ == "LocalSandboxProvider"