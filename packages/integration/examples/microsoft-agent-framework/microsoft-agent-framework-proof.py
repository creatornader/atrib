# SPDX-License-Identifier: Apache-2.0

import asyncio
import importlib.metadata
import json
import warnings
from typing import Any

from typing_extensions import Never

from agent_framework import Executor, WorkflowBuilder, WorkflowContext, handler


PRIVATE_PHRASE = "silver Microsoft Agent Framework workflow note"
WORKFLOW_NAME = "atribAgentFrameworkWorkflow"


class ProposalExecutor(Executor):
    @handler
    async def process(self, request: str, ctx: WorkflowContext[dict[str, Any]]) -> None:
        await ctx.send_message(
            {
                "sku": "atlas-kit",
                "quantity": 2,
                "request": request,
                "private_note": PRIVATE_PHRASE,
            }
        )


class ApprovalExecutor(Executor):
    @handler
    async def process(
        self, proposal: dict[str, Any], ctx: WorkflowContext[Never, dict[str, Any]]
    ) -> None:
        await ctx.yield_output(
            {
                "status": "approved",
                "sku": proposal["sku"],
                "quantity": proposal["quantity"],
                "approved_by": "nora",
                "private_note": proposal["private_note"],
            }
        )


def event_to_dict(index: int, event: Any) -> dict[str, Any]:
    event_type = getattr(event.type, "value", str(event.type))
    data = {
        "index": index,
        "type": event_type,
    }
    for attr in ("executor_id", "iteration", "data"):
        if hasattr(event, attr):
            data[attr] = getattr(event, attr)
    return data


async def run_proof() -> dict[str, Any]:
    proposal = ProposalExecutor(id="proposal")
    approval = ApprovalExecutor(id="approval")
    workflow = (
        WorkflowBuilder(
            start_executor=proposal,
            name=WORKFLOW_NAME,
            output_from=[approval],
        )
        .add_edge(proposal, approval)
        .build()
    )
    run = await workflow.run("approve two atlas kits")
    outputs = run.get_outputs()
    events = [event_to_dict(index, event) for index, event in enumerate(run)]
    return {
        "ok": True,
        "agent_framework_core_version": importlib.metadata.version("agent-framework-core"),
        "workflow": {
            "name": WORKFLOW_NAME,
            "builder": "WorkflowBuilder",
            "execution": "Workflow.run",
            "executors": ["ProposalExecutor", "ApprovalExecutor"],
            "edge_count": 1,
        },
        "events": events,
        "summary": {
            "event_count": len(events),
            "output_count": len(outputs),
            "executor_invoked_count": sum(1 for event in events if event["type"] == "executor_invoked"),
            "executor_completed_count": sum(
                1 for event in events if event["type"] == "executor_completed"
            ),
            "output_contains_private_phrase": PRIVATE_PHRASE in json.dumps(outputs),
            "workflow_completed": outputs[0]["status"] == "approved",
        },
        "final_output": {
            "status": outputs[0]["status"],
            "sku": outputs[0]["sku"],
            "quantity": outputs[0]["quantity"],
            "approved_by": outputs[0]["approved_by"],
        },
    }


if __name__ == "__main__":
    warnings.filterwarnings("ignore")
    print(json.dumps(asyncio.run(run_proof()), sort_keys=True))
