"""Inject patient record snapshot context into each new human turn."""

from typing import NotRequired, override

from langchain.agents import AgentState
from langchain.agents.middleware import AgentMiddleware
from langchain_core.messages import HumanMessage
from langgraph.runtime import Runtime

from deerflow.config.paths import Paths, get_paths
from deerflow.patient_record_context import (
    build_patient_record_snapshot,
    format_patient_record_block,
    has_patient_record_content,
)


class PatientRecordMiddlewareState(AgentState):
    patient_record_snapshot: NotRequired[dict | None]


class PatientRecordMiddleware(AgentMiddleware[PatientRecordMiddlewareState]):
    state_schema = PatientRecordMiddlewareState

    def __init__(self, base_dir: str | None = None):
        super().__init__()
        self._paths = Paths(base_dir) if base_dir else get_paths()

    @override
    def before_agent(
        self,
        state: PatientRecordMiddlewareState,
        runtime: Runtime,
    ) -> dict | None:
        messages = list(state.get("messages", []))
        if not messages:
            return None

        last_message_index = len(messages) - 1
        last_message = messages[last_message_index]
        if not isinstance(last_message, HumanMessage):
            return None

        thread_id = (runtime.context or {}).get("thread_id")
        if not thread_id:
            return None

        snapshot = build_patient_record_snapshot(thread_id, paths=self._paths)
        if not has_patient_record_content(snapshot):
            return None

        patient_record_block = format_patient_record_block(snapshot)
        if not patient_record_block:
            return None

        original_content = ""
        if isinstance(last_message.content, str):
            original_content = last_message.content
        elif isinstance(last_message.content, list):
            text_parts: list[str] = []
            for block in last_message.content:
                if isinstance(block, dict) and block.get("type") == "text":
                    text_parts.append(str(block.get("text", "")))
            original_content = "\n".join(text_parts)

        messages[last_message_index] = HumanMessage(
            content=f"{patient_record_block}\n\n{original_content}",
            id=last_message.id,
            additional_kwargs=last_message.additional_kwargs,
        )

        return {
            "messages": messages,
            "patient_record_snapshot": snapshot,
        }