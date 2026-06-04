# SPDX-License-Identifier: Apache-2.0

import asyncio
import json

from google.adk import version as adk_version
from google.adk.agents import Agent
from google.adk.models import BaseLlm, LlmResponse
from google.adk.plugins import BasePlugin
from google.adk.runners import InMemoryRunner
from google.adk.tools import FunctionTool
from google.genai import types


PRIVATE_PHRASE = "quiet ADK Python tool note"


class AtribAdkPythonProbePlugin(BasePlugin):
  def __init__(self):
    super().__init__("atrib_google_adk_python_probe")
    self.events = []

  async def after_tool_callback(self, *, tool, tool_args, tool_context, result):
    self.events.append({
        "index": len(self.events),
        "operation": "after_tool_callback",
        "tool_name": tool.name,
        "function_call_id": getattr(tool_context, "function_call_id", None),
        "invocation_id": getattr(tool_context, "invocation_id", None),
        "agent_name": getattr(tool_context, "agent_name", None),
        "user_id": getattr(tool_context, "user_id", None),
        "args": tool_args,
        "result": result,
    })
    return None


class ScriptedAdkPythonModel(BaseLlm):
  calls: int = 0

  def __init__(self):
    super().__init__(model="atrib-scripted-python-adk-model")

  async def generate_content_async(self, llm_request, stream=False):
    self.calls += 1
    if self.calls == 1:
      yield LlmResponse(
          content=types.Content(
              role="model",
              parts=[
                  types.Part.from_function_call(
                      name="quote_price",
                      args={
                          "sku": "atlas-kit",
                          "quantity": 2,
                          "internal_note": PRIVATE_PHRASE,
                      },
                  )
              ],
          )
      )
      return

    yield LlmResponse(
        content=types.Content(
            role="model",
            parts=[types.Part.from_text(text="Quote ready for atlas-kit.")],
        )
    )


def quote_price(sku: str, quantity: int, internal_note: str = ""):
  return {
      "sku": sku,
      "quantity": quantity,
      "total_cents": 8400,
      "private_note": internal_note,
  }


def event_counts(events):
  function_call_events = 0
  function_response_events = 0
  final_text_parts = []
  for event in events:
    parts = getattr(getattr(event, "content", None), "parts", None) or []
    if any(part.function_call for part in parts):
      function_call_events += 1
    if any(part.function_response for part in parts):
      function_response_events += 1
    final_text_parts.extend(part.text for part in parts if part.text)

  return {
      "yielded_events": len(events),
      "function_call_events": function_call_events,
      "function_response_events": function_response_events,
      "final_text": "".join(final_text_parts),
  }


async def run():
  plugin = AtribAdkPythonProbePlugin()
  agent = Agent(
      name="google_adk_python_atrib_smoke_agent",
      model=ScriptedAdkPythonModel(),
      instruction="Quote catalog items with the quote_price tool.",
      tools=[FunctionTool(quote_price)],
  )
  runner = InMemoryRunner(
      agent=agent,
      app_name="atrib-google-adk-python-smoke",
      plugins=[plugin],
  )
  await runner.session_service.create_session(
      app_name="atrib-google-adk-python-smoke",
      user_id="atrib-python-smoke-user",
      session_id="atrib-python-smoke-session",
  )

  yielded_events = []
  async for event in runner.run_async(
      user_id="atrib-python-smoke-user",
      session_id="atrib-python-smoke-session",
      new_message=types.Content(
          role="user",
          parts=[types.Part.from_text(text="Quote two atlas kits.")],
      ),
  ):
    yielded_events.append(event)

  counts = event_counts(yielded_events)
  print(json.dumps({
      "ok": True,
      "google_adk_version": adk_version.__version__,
      "runtime": {
          "runner": "InMemoryRunner",
          "plugin": "BasePlugin",
          "tool": "FunctionTool",
          "model": "BaseLlm",
      },
      "session": {
          "app_name": "atrib-google-adk-python-smoke",
          "user_id": "atrib-python-smoke-user",
          "session_id": "atrib-python-smoke-session",
      },
      "events": plugin.events,
      "summary": {
          **counts,
          "plugin_event_count": len(plugin.events),
          "private_phrase_in_plugin_events": PRIVATE_PHRASE in json.dumps(plugin.events),
      },
  }, indent=2))


if __name__ == "__main__":
  asyncio.run(run())
