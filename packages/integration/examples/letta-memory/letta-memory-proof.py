# SPDX-License-Identifier: Apache-2.0

from __future__ import annotations

import asyncio
import importlib.metadata
import json
import warnings
from typing import Any

from letta.schemas.agent import AgentState
from letta.schemas.embedding_config import EmbeddingConfig
from letta.schemas.enums import AgentType
from letta.schemas.llm_config import LLMConfig
from letta.schemas.memory import Block, Memory
from letta.schemas.tool import Tool
from letta.schemas.user import User
from letta.services.tool_executor import mcp_tool_executor
from letta.services.tool_executor.core_tool_executor import LettaCoreToolExecutor
from letta.services.tool_executor.mcp_tool_executor import ExternalMCPToolExecutor

PRIVATE_PHRASE = "cobalt cedar exact recall tier"


class FakeAgentManager:
    def __init__(self) -> None:
        self.memory_updates: list[dict[str, Any]] = []
        self.rebuilds: list[dict[str, Any]] = []
        self.searches: list[dict[str, Any]] = []

    async def update_memory_if_changed_async(
        self,
        agent_id: str,
        new_memory: Memory,
        actor: User,
    ) -> None:
        self.memory_updates.append(
            {
                "agent_id": agent_id,
                "actor_id": actor.id,
                "compiled_memory": new_memory.compile(),
            }
        )

    async def rebuild_system_prompt_async(
        self,
        agent_id: str,
        actor: User,
        force: bool = False,
    ) -> None:
        self.rebuilds.append(
            {
                "agent_id": agent_id,
                "actor_id": actor.id,
                "force": force,
            }
        )

    async def search_agent_archival_memory_async(self, **kwargs: Any) -> str:
        self.searches.append(kwargs)
        return (
            "Found archival passage for signed Letta memory proof. "
            f"The private phrase is {PRIVATE_PHRASE}."
        )


class FakePassageManager:
    def __init__(self) -> None:
        self.inserts: list[dict[str, Any]] = []

    async def insert_passage(self, **kwargs: Any) -> None:
        self.inserts.append(kwargs)


class FakeMCPManager:
    calls: list[dict[str, Any]] = []

    async def execute_mcp_server_tool(
        self,
        mcp_server_name: str,
        tool_name: str,
        tool_args: dict[str, Any],
        environment_variables: dict[str, Any],
        actor: User,
        agent_id: str | None,
    ) -> tuple[dict[str, Any], bool]:
        self.__class__.calls.append(
            {
                "mcp_server_name": mcp_server_name,
                "tool_name": tool_name,
                "tool_args": tool_args,
                "environment_variable_keys": sorted(environment_variables.keys()),
                "actor_id": actor.id,
                "agent_id": agent_id,
            }
        )
        return (
            {
                "status": "accepted",
                "receipt_hint": "fake external MCP verifier response",
                "private_phrase": PRIVATE_PHRASE,
            },
            True,
        )


def build_agent_state() -> AgentState:
    memory = Memory(
        blocks=[
            Block(
                label="human",
                value="Nader likes quiet sci-fi.",
                description="Facts about the user that the agent may edit.",
            )
        ]
    )
    return AgentState(
        id="agent-12345678",
        name="atrib-letta-memory-proof",
        system="local Letta memory proof",
        agent_type=AgentType.letta_v1_agent,
        llm_config=LLMConfig(
            model="gpt-5-mini",
            model_endpoint_type="openai",
            context_window=10000,
        ),
        embedding_config=EmbeddingConfig(
            embedding_endpoint_type="openai",
            embedding_model="text-embedding-3-small",
            embedding_dim=2,
        ),
        memory=memory,
        blocks=memory.blocks,
        tools=[],
        sources=[],
        tags=[],
    )


def build_tool(name: str, tags: list[str] | None = None) -> Tool:
    return Tool(
        name=name,
        tags=tags or [],
        json_schema={"type": "object", "properties": {}},
        args_json_schema={"type": "object", "properties": {}},
    )


async def run_core_operation(
    executor: LettaCoreToolExecutor,
    function_name: str,
    function_args: dict[str, Any],
    actor: User,
    agent_state: AgentState,
) -> dict[str, Any]:
    result = await executor.execute(
        function_name=function_name,
        function_args=function_args,
        tool=build_tool(function_name),
        actor=actor,
        agent_state=agent_state,
    )
    if result.status != "success":
        raise RuntimeError(
            f"Letta core operation failed: {function_name}: {result.func_return}"
        )
    return {
        "operation": f"letta.core.{function_name}",
        "executor": "LettaCoreToolExecutor",
        "function_name": function_name,
        "status": result.status,
        "args": function_args,
        "result": normalize_result(result.func_return),
    }


async def run_external_mcp_operation(
    executor: ExternalMCPToolExecutor,
    actor: User,
    agent_state: AgentState,
) -> dict[str, Any]:
    function_name = "verify_memory_receipt"
    function_args = {
        "record_hash": "sha256:example-letta-record",
        "private_note": PRIVATE_PHRASE,
    }
    result = await executor.execute(
        function_name=function_name,
        function_args=function_args,
        tool=build_tool(function_name, tags=["mcp:atrib-local"]),
        actor=actor,
        agent_state=agent_state,
    )
    if result.status != "success":
        raise RuntimeError(f"Letta external MCP operation failed: {result.func_return}")
    return {
        "operation": f"letta.external_mcp.{function_name}",
        "executor": "ExternalMCPToolExecutor",
        "function_name": function_name,
        "status": result.status,
        "args": function_args,
        "result": normalize_result(result.func_return),
    }


async def main() -> None:
    warnings.filterwarnings("ignore", category=DeprecationWarning)
    mcp_tool_executor.MCPManager = FakeMCPManager

    actor = User(name="Atrib Operator")
    agent_state = build_agent_state()
    agent_manager = FakeAgentManager()
    passage_manager = FakePassageManager()
    core_executor = LettaCoreToolExecutor(
        message_manager=None,
        agent_manager=agent_manager,
        block_manager=None,
        run_manager=None,
        passage_manager=passage_manager,
        actor=actor,
    )
    external_executor = ExternalMCPToolExecutor(
        message_manager=None,
        agent_manager=agent_manager,
        block_manager=None,
        run_manager=None,
        passage_manager=passage_manager,
        actor=actor,
    )

    operations = [
        await run_core_operation(
            core_executor,
            "core_memory_append",
            {
                "label": "human",
                "content": f"Prefers hash-only memory receipts: {PRIVATE_PHRASE}.",
            },
            actor,
            agent_state,
        ),
        await run_core_operation(
            core_executor,
            "core_memory_replace",
            {
                "label": "human",
                "old_content": "quiet sci-fi",
                "new_content": "quiet notebooks",
            },
            actor,
            agent_state,
        ),
        await run_core_operation(
            core_executor,
            "memory_apply_patch",
            {
                "label": "human",
                "patch": "\n".join(
                    [
                        "@@",
                        " Nader likes quiet notebooks.",
                        f"-Prefers hash-only memory receipts: {PRIVATE_PHRASE}.",
                        "+Prefers hash-only signed recall receipts.",
                    ]
                ),
            },
            actor,
            agent_state,
        ),
        await run_core_operation(
            core_executor,
            "archival_memory_insert",
            {
                "content": f"Store this archival proof phrase: {PRIVATE_PHRASE}.",
                "tags": ["atrib", "exact-recall"],
            },
            actor,
            agent_state,
        ),
        await run_core_operation(
            core_executor,
            "archival_memory_search",
            {
                "query": PRIVATE_PHRASE,
                "tags": ["atrib"],
                "tag_match_mode": "any",
                "top_k": 3,
            },
            actor,
            agent_state,
        ),
        await run_external_mcp_operation(external_executor, actor, agent_state),
    ]

    if len(agent_manager.memory_updates) != 3:
        raise RuntimeError("expected three Letta core-memory updates")
    if len(passage_manager.inserts) != 1:
        raise RuntimeError("expected one Letta archival insert")
    if len(agent_manager.rebuilds) != 1:
        raise RuntimeError("expected one Letta system-prompt rebuild")
    if len(agent_manager.searches) != 1:
        raise RuntimeError("expected one Letta archival search")
    if len(FakeMCPManager.calls) != 1:
        raise RuntimeError("expected one Letta external MCP call")

    final_memory = agent_state.memory.get_block("human").value
    if PRIVATE_PHRASE in final_memory:
        raise RuntimeError("core-memory patch did not remove the private phrase")
    if PRIVATE_PHRASE not in json.dumps(operations):
        raise RuntimeError(
            "proof operations should keep private material for local sidecars"
        )

    print(
        json.dumps(
            {
                "ok": True,
                "letta_version": importlib.metadata.version("letta"),
                "operations": operations,
                "summary": {
                    "core_memory_update_count": len(agent_manager.memory_updates),
                    "archival_insert_count": len(passage_manager.inserts),
                    "archival_search_count": len(agent_manager.searches),
                    "system_prompt_rebuild_count": len(agent_manager.rebuilds),
                    "external_mcp_call_count": len(FakeMCPManager.calls),
                    "final_core_memory": final_memory,
                    "final_core_memory_contains_private_phrase": PRIVATE_PHRASE
                    in final_memory,
                    "archival_search_contains_private_phrase": PRIVATE_PHRASE
                    in operations[4]["result"],
                },
            },
            indent=2,
        )
    )


def normalize_result(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, dict):
        return value
    return repr(value)


if __name__ == "__main__":
    asyncio.run(main())
