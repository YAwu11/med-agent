"""Inject patient record delta context into each new human turn when needed."""

from typing import NotRequired, override

from langchain.agents import AgentState
from langchain.agents.middleware import AgentMiddleware
from langchain_core.messages import HumanMessage
from langgraph.runtime import Runtime

from deerflow.config.paths import Paths, get_paths
from deerflow.patient_record_context import (
    build_patient_record_delta,
    build_patient_record_snapshot,
    format_patient_record_delta_block,
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

        context_event = last_message.additional_kwargs.get("context_event", {})
        if isinstance(context_event, dict) and context_event.get("kind") == "patient_record_delta":
            return {
                "messages": messages,
                "patient_record_snapshot": snapshot,
            }

        previous_snapshot = state.get("patient_record_snapshot")
        if not isinstance(previous_snapshot, dict):
            return {
                "messages": messages,
                "patient_record_snapshot": snapshot,
            }

        delta = build_patient_record_delta(previous_snapshot, snapshot)
        patient_record_delta_block = format_patient_record_delta_block(delta)
        if not patient_record_delta_block:
            return {
                "messages": messages,
                "patient_record_snapshot": snapshot,
            }

        hidden_delta_message = HumanMessage(
            content=patient_record_delta_block,
            id=(f"{last_message.id}:patient-record-delta" if last_message.id else None),
            additional_kwargs={
                "context_event": {
                    "kind": "patient_record_delta",
                    "hidden": True,
                    "source": "middleware_fallback",
                    "revision": delta.get("revision", 0),
                }
            },
        )
        messages.insert(last_message_index, hidden_delta_message)

        return {
            "messages": messages,
            "patient_record_snapshot": snapshot,
        }