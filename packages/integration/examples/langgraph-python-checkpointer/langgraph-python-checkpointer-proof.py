# SPDX-License-Identifier: Apache-2.0

from __future__ import annotations

import importlib.metadata
import json
from typing import Any, TypedDict

from langgraph.checkpoint.memory import InMemorySaver
from langgraph.graph import END, START, StateGraph


PRIVATE_PHRASE = "quiet LangGraph Python checkpoint note"
THREAD_ID = "atrib-python-checkpointer-smoke"


class ProcurementState(TypedDict):
    request: str
    private_note: str
    answer: str
    steps: list[str]


class RecordingInMemorySaver(InMemorySaver):
    def __init__(self) -> None:
        super().__init__()
        self.events: list[dict[str, Any]] = []

    def get_tuple(self, config: Any) -> Any:
        result = super().get_tuple(config)
        checkpoint = getattr(result, "checkpoint", None) if result is not None else None
        self._append(
            {
                "operation": "get_tuple",
                "config": summarize_config(config),
                "found": result is not None,
                "checkpoint_id": checkpoint.get("id") if isinstance(checkpoint, dict) else None,
            }
        )
        return result

    def put(
        self,
        config: Any,
        checkpoint: Any,
        metadata: Any,
        new_versions: Any,
    ) -> Any:
        result = super().put(config, checkpoint, metadata, new_versions)
        channel_values = checkpoint.get("channel_values", {}) if isinstance(checkpoint, dict) else {}
        self._append(
            {
                "operation": "put",
                "config": summarize_config(config),
                "checkpoint_id": checkpoint.get("id") if isinstance(checkpoint, dict) else None,
                "metadata": json_safe(metadata),
                "channel_keys": sorted(channel_values.keys()),
                "channel_values": json_safe(channel_values),
                "new_version_keys": sorted(new_versions.keys()) if hasattr(new_versions, "keys") else [],
            }
        )
        return result

    def put_writes(
        self,
        config: Any,
        writes: Any,
        task_id: str,
        task_path: str = "",
    ) -> None:
        result = super().put_writes(config, writes, task_id, task_path)
        self._append(
            {
                "operation": "put_writes",
                "config": summarize_config(config),
                "task_id": task_id,
                "task_path": task_path,
                "write_count": len(writes),
                "write_channels": [write[0] for write in writes],
                "writes": json_safe(writes),
            }
        )
        return result

    def _append(self, event: dict[str, Any]) -> None:
        event["index"] = len(self.events)
        self.events.append(event)


def summarize_config(config: Any) -> dict[str, Any]:
    configurable = (config or {}).get("configurable", {})
    return {
        key: configurable[key]
        for key in ("thread_id", "checkpoint_ns", "checkpoint_id")
        if key in configurable
    }


def json_safe(value: Any) -> Any:
    try:
        json.dumps(value, sort_keys=True)
        return value
    except TypeError:
        if isinstance(value, tuple):
            return [json_safe(item) for item in value]
        if isinstance(value, list):
            return [json_safe(item) for item in value]
        if isinstance(value, dict):
            return {str(key): json_safe(item) for key, item in value.items()}
        return repr(value)


def draft(state: ProcurementState) -> ProcurementState:
    return {
        "request": state["request"],
        "private_note": state["private_note"],
        "answer": "",
        "steps": state.get("steps", []) + ["draft"],
    }


def approve(state: ProcurementState) -> ProcurementState:
    return {
        "request": state["request"],
        "private_note": state["private_note"],
        "answer": f"approved {state['request']}",
        "steps": state.get("steps", []) + ["approve"],
    }


def run_proof() -> dict[str, Any]:
    builder = StateGraph(ProcurementState)
    builder.add_node("draft", draft)
    builder.add_node("approve", approve)
    builder.add_edge(START, "draft")
    builder.add_edge("draft", "approve")
    builder.add_edge("approve", END)

    saver = RecordingInMemorySaver()
    graph = builder.compile(checkpointer=saver)
    config = {"configurable": {"thread_id": THREAD_ID}}
    result = graph.invoke(
        {
            "request": "atlas-kit order",
            "private_note": PRIVATE_PHRASE,
            "answer": "",
            "steps": [],
        },
        config,
    )
    state_snapshot = graph.get_state(config)

    return {
        "ok": True,
        "langgraph_version": importlib.metadata.version("langgraph"),
        "workflow": {
            "graph": "StateGraph",
            "compile": "compile(checkpointer=InMemorySaver())",
            "nodes": ["draft", "approve"],
            "thread_id": THREAD_ID,
        },
        "checkpointer": {
            "class": "InMemorySaver",
            "operations": sorted({event["operation"] for event in saver.events}),
        },
        "events": saver.events,
        "summary": {
            "event_count": len(saver.events),
            "get_tuple_count": sum(1 for event in saver.events if event["operation"] == "get_tuple"),
            "put_count": sum(1 for event in saver.events if event["operation"] == "put"),
            "put_writes_count": sum(
                1 for event in saver.events if event["operation"] == "put_writes"
            ),
            "private_phrase_in_events": PRIVATE_PHRASE in json.dumps(saver.events),
            "private_phrase_in_state": PRIVATE_PHRASE in json.dumps(state_snapshot.values),
            "workflow_completed": result["answer"] == "approved atlas-kit order",
        },
        "final_output": {
            "answer": result["answer"],
            "steps": result["steps"],
        },
    }


if __name__ == "__main__":
    print(json.dumps(run_proof(), sort_keys=True))
