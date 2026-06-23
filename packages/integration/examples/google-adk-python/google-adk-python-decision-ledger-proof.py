# SPDX-License-Identifier: Apache-2.0

import asyncio
import base64
import hashlib
import json
import os
import random
import sys
import uuid
from urllib.parse import urlparse

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ed25519
from google.adk import version as adk_version
from google.adk.agents import Agent
from google.adk.models import BaseLlm, LlmResponse
from google.adk.plugins import BasePlugin
from google.adk.runners import InMemoryRunner
from google.adk.tools import FunctionTool
from google.genai import types


EVENT_TYPE_TOOL_CALL_URI = "https://atrib.dev/v1/types/tool_call"
GOOGLE_ADK_DECISION_LEDGER_EVENT_TYPE_URI = (
    "https://google-adk-decision-ledger.example/v1"
)
GOOGLE_ADK_DECISION_LEDGER_SCHEMA = "atrib.google-adk.decision-ledger.entry.v1"
DEFAULT_SERVER_URL = "google-adk-python-decision-ledger://proof"
DEFAULT_PRIVATE_KEY_HEX = (
    "5566778899aabbccddeeff00112233445566778899aabbccddeeff0011223344"
)
DEFAULT_CONTEXT_ID = "676f6f676c652d61646b2d70792d3130"
DEFAULT_PARENT_RECORD_HASH = "sha256:" + ("a" * 64)
PRIVATE_PHRASE = "python decision ledger private tool note"


def canonical_json(value):
  return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def digest_bytes(value):
  return hashlib.sha256(value).digest()


def digest_hex(value):
  return hashlib.sha256(value).hexdigest()


def digest_canonical(value):
  return "sha256:" + digest_hex(canonical_json(value).encode("utf-8"))


def base64url_encode(value):
  return base64.urlsafe_b64encode(value).decode("ascii").rstrip("=")


def normalize_server_url(value):
  parsed = urlparse(value)
  if not parsed.scheme:
    return value.lower()
  host = parsed.netloc.lower()
  path = parsed.path
  if path == "/":
    path = ""
  elif path.endswith("/"):
    path = path[:-1]
  return f"{parsed.scheme.lower()}://{host}{path}"


def compute_content_id(server_url, tool_name):
  normalized = normalize_server_url(server_url)
  return "sha256:" + digest_hex(f"{normalized}:{tool_name}".encode("utf-8"))


def canonical_signing_input(record):
  unsigned = {key: value for key, value in record.items() if key != "signature"}
  return canonical_json(unsigned).encode("utf-8")


def canonical_record(record):
  return canonical_json(record).encode("utf-8")


def record_hash(record):
  return "sha256:" + digest_hex(canonical_record(record))


def genesis_chain_root(context_id):
  return "sha256:" + digest_hex(context_id.encode("utf-8"))


def normalize_record_hashes(values):
  unique = sorted(set(values or []))
  for value in unique:
    if not isinstance(value, str) or not value.startswith("sha256:") or len(value) != 71:
      raise ValueError("record hashes must use sha256:<64 lowercase hex>")
  return unique


def hash_principal(principal):
  return digest_canonical({"principal": principal})


def load_private_key():
  raw = os.environ.get("ATRIB_PRIVATE_KEY", DEFAULT_PRIVATE_KEY_HEX)
  key_bytes = bytes.fromhex(raw) if len(raw) == 64 else base64.urlsafe_b64decode(raw + "==")
  if len(key_bytes) != 32:
    raise ValueError("ADK Python decision ledger private key must be 32 bytes")
  return ed25519.Ed25519PrivateKey.from_private_bytes(key_bytes)


def public_key_for(private_key):
  return private_key.public_key().public_bytes(
      encoding=serialization.Encoding.Raw,
      format=serialization.PublicFormat.Raw,
  )


def sign_record(record, private_key):
  signature = private_key.sign(canonical_signing_input(record))
  signed = dict(record)
  signed["signature"] = base64url_encode(signature)
  return signed


def build_confirmation_binding_hash(input_value):
  return digest_canonical({
      "tool_name": input_value["tool_name"],
      "canonical_args_digest": input_value["canonical_args_digest"],
      "authority": input_value["authority"],
      "policy_version": input_value["policy_version"],
      "expires_at": input_value["expires_at"],
  })


def build_decision_ledger_entry(params):
  canonical_args_digest = params.get("canonical_args_digest") or digest_canonical(
      params.get("args") or {}
  )
  selection = params.get("selection") or {
      "source": "unavailable",
      "tool_name": params["tool_name"],
      "canonical_args_digest": canonical_args_digest,
      "function_call_id": None,
      "rationale_digest": digest_canonical({
          "text": params.get("model_rationale", ""),
          "trust": "untrusted_generated",
      }),
  }
  entry_without_id = {
      "schema": GOOGLE_ADK_DECISION_LEDGER_SCHEMA,
      "decision_state": params["decision_state"],
      "invocation_id": params["invocation_id"],
      "session_id": params["session_id"],
      "step": params["step"],
      "tool_call_id": params["tool_call_id"],
      "tool_name": params["tool_name"],
      "canonical_args_digest": canonical_args_digest,
      "selection": selection,
      "authority": params["authority"],
      "policy": params["policy"],
      "confirmation": params["confirmation"],
      "model_rationale": {
          "text": params.get("model_rationale", ""),
          "trust": "untrusted_generated",
      },
      "timestamp": params["timestamp"],
      "parent_record_hashes": normalize_record_hashes(params.get("parent_record_hashes", [])),
  }
  if "result_digest" in params:
    entry_without_id["result_digest"] = params["result_digest"]
  elif "result" in params:
    entry_without_id["result_digest"] = digest_canonical(params["result"])
  entry = dict(entry_without_id)
  entry["decision_id"] = digest_canonical(entry_without_id)
  return entry


def decision_subject(entry):
  return {
      "schema": entry["schema"],
      "decision_id": entry["decision_id"],
      "invocation_id": entry["invocation_id"],
      "session_id": entry["session_id"],
      "step": entry["step"],
      "tool_call_id": entry["tool_call_id"],
      "tool_name": entry["tool_name"],
      "canonical_args_digest": entry["canonical_args_digest"],
  }


def decision_result(entry):
  return {
      "decision_state": entry["decision_state"],
      "authority": entry["authority"],
      "policy": entry["policy"],
      "confirmation": entry["confirmation"],
      "result_digest": entry.get("result_digest") or None,
  }


def make_record(
    *,
    context_id,
    creator_key,
    server_url,
    operation,
    event_type,
    timestamp_ms,
    args_hash,
    result_hash,
    previous_record=None,
    informed_by=None,
):
  record = {
      "spec_version": "atrib/1.0",
      "content_id": compute_content_id(server_url, operation),
      "creator_key": creator_key,
      "chain_root": record_hash(previous_record) if previous_record else genesis_chain_root(context_id),
      "event_type": event_type,
      "context_id": context_id,
      "timestamp": timestamp_ms,
      "signature": "",
      "args_hash": args_hash,
      "result_hash": result_hash,
      "tool_name": operation,
  }
  normalized_informed_by = normalize_record_hashes(informed_by or [])
  if normalized_informed_by:
    record["informed_by"] = normalized_informed_by
  return record


def sign_decision_entry(
    *,
    entry,
    private_key,
    creator_key,
    context_id,
    server_url,
    timestamp_ms,
    previous_record=None,
    informed_by=None,
    user_id="unknown",
    agent_name="unknown",
    principal=None,
    args=None,
):
  operation = f"google.adk.python.decision.{entry['decision_state']}"
  record = make_record(
      context_id=context_id,
      creator_key=creator_key,
      server_url=server_url,
      operation=operation,
      event_type=GOOGLE_ADK_DECISION_LEDGER_EVENT_TYPE_URI,
      timestamp_ms=timestamp_ms,
      args_hash=digest_canonical(decision_subject(entry)),
      result_hash=digest_canonical(decision_result(entry)),
      previous_record=previous_record,
      informed_by=informed_by if informed_by is not None else entry["parent_record_hashes"],
  )
  signed = sign_record(record, private_key)
  signed_hash = record_hash(signed)
  sidecar = {
      "framework": "google-adk-python",
      "plugin_name": "atrib_google_adk_python_decision_ledger",
      "record_kind": "decision",
      "decision_entry": entry,
      "operation": operation,
      "tool_name": entry["tool_name"],
      "invocation_id": entry["invocation_id"],
      "session_id": entry["session_id"],
      "user_id": user_id,
      "agent_name": agent_name,
      "function_call_id": entry["tool_call_id"],
      "record_hash": signed_hash,
      "informed_by": normalize_record_hashes(informed_by if informed_by is not None else entry["parent_record_hashes"]),
  }
  if principal:
    sidecar["principal"] = principal
  if args is not None:
    sidecar["args"] = args
  return {"record": signed, "record_hash": signed_hash, "entry": entry, "sidecar": sidecar}


def sign_tool_outcome(
    *,
    tool_name,
    tool_args,
    outcome,
    pending,
    private_key,
    creator_key,
    context_id,
    server_url,
    timestamp_ms,
    previous_record,
    invocation_id,
    session_id,
    user_id,
    agent_name,
    function_call_id,
):
  operation = f"google.adk.python.tool.{tool_name}"
  informed_by = [pending["decision"]["record_hash"]]
  record = make_record(
      context_id=context_id,
      creator_key=creator_key,
      server_url=server_url,
      operation=operation,
      event_type=EVENT_TYPE_TOOL_CALL_URI,
      timestamp_ms=timestamp_ms,
      args_hash=digest_canonical(tool_args),
      result_hash=digest_canonical(outcome),
      previous_record=previous_record,
      informed_by=informed_by,
  )
  signed = sign_record(record, private_key)
  signed_hash = record_hash(signed)
  sidecar = {
      "framework": "google-adk-python",
      "plugin_name": "atrib_google_adk_python_decision_ledger",
      "record_kind": "tool_outcome",
      "operation": operation,
      "tool_name": tool_name,
      "invocation_id": invocation_id,
      "session_id": session_id,
      "user_id": user_id,
      "agent_name": agent_name,
      "function_call_id": function_call_id,
      "args": tool_args,
      "record_hash": signed_hash,
      "informed_by": informed_by,
  }
  if outcome["status"] == "ok":
    sidecar["result"] = outcome["result"]
  else:
    sidecar["error"] = outcome["error"]
  if pending.get("principal"):
    sidecar["principal"] = pending["principal"]
  return {
      "record": signed,
      "record_hash": signed_hash,
      "decision_record_hash": pending["decision"]["record_hash"],
      "sidecar": sidecar,
  }


def ctx_attr(tool_context, *names, default=None):
  for name in names:
    value = getattr(tool_context, name, None)
    if value is not None:
      return value
  return default


def normalize_function_args(value):
  if value is None:
    return {}
  if isinstance(value, dict):
    return dict(value)
  if hasattr(value, "items"):
    return dict(value.items())
  return json.loads(canonical_json(value))


def selection_key(tool_name, args):
  return f"{tool_name}:{digest_canonical(normalize_function_args(args))}"


def extract_model_response_parts(llm_response):
  content = getattr(llm_response, "content", None)
  return getattr(content, "parts", None) or []


def extract_model_selection(llm_response):
  parts = extract_model_response_parts(llm_response)
  text_parts = [getattr(part, "text", None) for part in parts]
  rationale = " ".join(text for text in text_parts if text)
  selections = []
  for part in parts:
    function_call = getattr(part, "function_call", None)
    if not function_call:
      continue
    args = normalize_function_args(getattr(function_call, "args", None))
    tool_name = getattr(function_call, "name", "")
    selections.append({
        "source": "after_model_callback",
        "tool_name": tool_name,
        "canonical_args_digest": digest_canonical(args),
        "function_call_id": getattr(function_call, "id", None),
        "rationale_digest": digest_canonical({
            "text": rationale,
            "trust": "untrusted_generated",
        }),
        "rationale_text": rationale,
    })
  return selections


def native_confirmation_counts(events):
  requested = 0
  request_events = 0
  for event in events:
    actions = getattr(event, "actions", None)
    requested_tool_confirmations = (
        getattr(actions, "requested_tool_confirmations", None) if actions else None
    )
    if isinstance(requested_tool_confirmations, dict):
      requested += len(requested_tool_confirmations)
    elif requested_tool_confirmations:
      requested += 1
    parts = getattr(getattr(event, "content", None), "parts", None) or []
    for part in parts:
      function_call = getattr(part, "function_call", None)
      if function_call and getattr(function_call, "name", None) == "adk_request_confirmation":
        request_events += 1
  return {
      "requested_tool_confirmations": requested,
      "adk_request_confirmation_events": request_events,
  }


class AtribAdkPythonDecisionLedgerPlugin(BasePlugin):
  def __init__(self, *, options, private_key, creator_key, execution_counter):
    super().__init__("atrib_google_adk_python_decision_ledger")
    self.options = options
    self.private_key = private_key
    self.creator_key = creator_key
    self.execution_counter = execution_counter
    self.records = []
    self.sidecars = []
    self.decisions = []
    self.outcomes = []
    self.pending = {}
    self.selections = {}
    self.native_confirmation_requests = []
    self.last_record = None
    self.step = 0

  async def after_model_callback(self, *, callback_context, llm_response):
    for selection in extract_model_selection(llm_response):
      key = f"{selection['tool_name']}:{selection['canonical_args_digest']}"
      self.selections[key] = selection
    return None

  async def on_event_callback(self, *, invocation_context, event):
    parts = getattr(getattr(event, "content", None), "parts", None) or []
    for part in parts:
      function_call = getattr(part, "function_call", None)
      if function_call and getattr(function_call, "name", None) == "adk_request_confirmation":
        self.native_confirmation_requests.append({
            "source": "on_event_callback",
            "invocation_id": ctx_attr(invocation_context, "invocation_id", "invocationId", default=None),
            "function_call_id": getattr(function_call, "id", None),
            "args_digest": digest_canonical(normalize_function_args(getattr(function_call, "args", None))),
        })
    return None

  async def before_tool_callback(self, *, tool, tool_args, tool_context):
    self.step += 1
    timestamp_ms = self.options["now_ms"] + self.step - 1
    policy_outcome = self.options["policy_outcome"]
    native_confirmation_required = self.options.get("native_confirmation_required", False)
    decision_state = (
        "confirmation_required"
        if native_confirmation_required
        else {
            "allow": "allowed",
            "deny": "refused",
            "error": "policy_error",
        }[policy_outcome]
    )
    principal = self.options["principal"]
    authority = {
        "mode": self.options["authority_mode"],
        "principal_hash": hash_principal(principal),
    }
    policy = {
        "source": "confirmation" if native_confirmation_required else "plugin",
        "rule": (
            f"{tool.name}:native-require-confirmation"
            if native_confirmation_required
            else f"{tool.name}:atlas-policy"
        ),
        "version": "atlas-policy-v1",
        "outcome": "escalate" if native_confirmation_required else policy_outcome,
    }
    if native_confirmation_required:
      policy["reason"] = "ADK FunctionTool require_confirmation requested approval before execution"
    if policy_outcome == "deny":
      policy["reason"] = "sku denied by local policy"
    if policy_outcome == "error":
      policy["reason"] = "policy evaluator failed closed before dispatch"
    selection = self.selections.get(
        selection_key(tool.name, tool_args),
        {
            "source": "unavailable",
            "tool_name": tool.name,
            "canonical_args_digest": digest_canonical(tool_args),
            "function_call_id": None,
            "rationale_digest": digest_canonical({
                "text": f"scripted request for {self.options['sku']}",
                "trust": "untrusted_generated",
            }),
        },
    )
    entry = build_decision_ledger_entry({
        "decision_state": decision_state,
        "invocation_id": ctx_attr(tool_context, "invocation_id", "invocationId", default="unknown"),
        "session_id": ctx_attr(tool_context, "session_id", "sessionId", default=self.options["session_id"]),
        "step": self.step,
        "tool_call_id": ctx_attr(tool_context, "function_call_id", "functionCallId", default=f"{tool.name}:no-call-id:{self.step}"),
        "tool_name": tool.name,
        "args": tool_args,
        "authority": authority,
        "policy": policy,
        "confirmation": {
            "required": native_confirmation_required,
            **({
                "source": "adk.FunctionTool.require_confirmation",
                "status": "requested",
            } if native_confirmation_required else {}),
        },
        "selection": {
            key: value
            for key, value in selection.items()
            if key != "rationale_text"
        },
        "model_rationale": selection.get(
            "rationale_text",
            f"scripted request for {self.options['sku']}",
        ),
        "timestamp": iso_ms(timestamp_ms),
        "parent_record_hashes": self.options["parent_record_hashes"],
    })
    decision = sign_decision_entry(
        entry=entry,
        private_key=self.private_key,
        creator_key=self.creator_key,
        context_id=self.options["context_id"],
        server_url=DEFAULT_SERVER_URL,
        timestamp_ms=timestamp_ms,
        previous_record=self.last_record,
        informed_by=entry["parent_record_hashes"],
        user_id=ctx_attr(tool_context, "user_id", "userId", default=self.options["user_id"]),
        agent_name=ctx_attr(tool_context, "agent_name", "agentName", default=self.options["agent_name"]),
        principal=principal,
        args=tool_args,
    )
    self.last_record = decision["record"]
    self.records.append(decision["record"])
    self.sidecars.append(decision["sidecar"])
    self.decisions.append(decision)
    marker = f"{tool.name}:{entry['tool_call_id']}"
    self.pending[marker] = {"decision": decision, "principal": principal}
    if decision_state in ["allowed", "confirmation_required"]:
      return None
    return {
        "atrib_decision": decision_state,
        "decision_record_hash": decision["record_hash"],
        "reason": policy.get("reason", policy_outcome),
    }

  async def after_tool_callback(self, *, tool, tool_args, tool_context, result):
    marker = f"{tool.name}:{ctx_attr(tool_context, 'function_call_id', 'functionCallId', default=f'{tool.name}:no-call-id:{self.step}')}"
    pending = self.pending.get(marker)
    if not pending:
      return None
    if pending["decision"]["entry"]["decision_state"] != "allowed":
      return None
    outcome = sign_tool_outcome(
        tool_name=tool.name,
        tool_args=tool_args,
        outcome={"status": "ok", "result": result},
        pending=pending,
        private_key=self.private_key,
        creator_key=self.creator_key,
        context_id=self.options["context_id"],
        server_url=DEFAULT_SERVER_URL,
        timestamp_ms=self.options["now_ms"] + self.step,
        previous_record=self.last_record,
        invocation_id=ctx_attr(tool_context, "invocation_id", "invocationId", default="unknown"),
        session_id=ctx_attr(tool_context, "session_id", "sessionId", default=self.options["session_id"]),
        user_id=ctx_attr(tool_context, "user_id", "userId", default=self.options["user_id"]),
        agent_name=ctx_attr(tool_context, "agent_name", "agentName", default=self.options["agent_name"]),
        function_call_id=ctx_attr(tool_context, "function_call_id", "functionCallId", default=None),
    )
    self.last_record = outcome["record"]
    self.records.append(outcome["record"])
    self.sidecars.append(outcome["sidecar"])
    self.outcomes.append(outcome)
    return None

  async def on_tool_error_callback(self, *, tool, tool_args, tool_context, error):
    marker = f"{tool.name}:{ctx_attr(tool_context, 'function_call_id', 'functionCallId', default=f'{tool.name}:no-call-id:{self.step}')}"
    pending = self.pending.get(marker)
    if not pending:
      return None
    outcome = sign_tool_outcome(
        tool_name=tool.name,
        tool_args=tool_args,
        outcome={"status": "error", "error": {"name": type(error).__name__, "message": str(error)}},
        pending=pending,
        private_key=self.private_key,
        creator_key=self.creator_key,
        context_id=self.options["context_id"],
        server_url=DEFAULT_SERVER_URL,
        timestamp_ms=self.options["now_ms"] + self.step,
        previous_record=self.last_record,
        invocation_id=ctx_attr(tool_context, "invocation_id", "invocationId", default="unknown"),
        session_id=ctx_attr(tool_context, "session_id", "sessionId", default=self.options["session_id"]),
        user_id=ctx_attr(tool_context, "user_id", "userId", default=self.options["user_id"]),
        agent_name=ctx_attr(tool_context, "agent_name", "agentName", default=self.options["agent_name"]),
        function_call_id=ctx_attr(tool_context, "function_call_id", "functionCallId", default=None),
    )
    self.last_record = outcome["record"]
    self.records.append(outcome["record"])
    self.sidecars.append(outcome["sidecar"])
    self.outcomes.append(outcome)
    return None


class SingleToolCallModel(BaseLlm):
  calls: int = 0
  args: dict

  def __init__(self, args):
    super().__init__(model="atrib-scripted-python-adk-decision-ledger-model", args=args)

  async def generate_content_async(self, llm_request, stream=False):
    self.calls += 1
    if self.calls == 1:
      yield LlmResponse(
          content=types.Content(
              role="model",
              parts=[
                  types.Part.from_text(
                      text=(
                          f"I selected quote_price because {self.args['sku']} needs "
                          "a catalog quote before any follow-up action."
                      )
                  ),
                  types.Part.from_function_call(name="quote_price", args=self.args),
              ],
          )
      )
      return

    yield LlmResponse(
        content=types.Content(
            role="model",
            parts=[types.Part.from_text(text=f"Decision path complete for {self.args['sku']}.")],
        )
    )


def event_counts(events):
  function_call_events = 0
  function_response_events = 0
  for event in events:
    parts = getattr(getattr(event, "content", None), "parts", None) or []
    if any(part.function_call for part in parts):
      function_call_events += 1
    if any(part.function_response for part in parts):
      function_response_events += 1
  return {
      "yielded_events": len(events),
      "function_call_events": function_call_events,
      "function_response_events": function_response_events,
  }


async def run_live_decision_path(options):
  async def run_inner():
    return await run_live_decision_path_once(options)

  if "deterministic_uuid_seed" not in options:
    return await run_inner()

  original_uuid4 = uuid.uuid4
  rng = random.Random(options["deterministic_uuid_seed"])

  def deterministic_uuid4():
    return uuid.UUID(int=rng.getrandbits(128), version=4)

  uuid.uuid4 = deterministic_uuid4
  try:
    return await run_inner()
  finally:
    uuid.uuid4 = original_uuid4


async def run_live_decision_path_once(options):
  private_key = load_private_key()
  creator_key = base64url_encode(public_key_for(private_key))
  execution_counter = {"count": 0}
  plugin = AtribAdkPythonDecisionLedgerPlugin(
      options=options,
      private_key=private_key,
      creator_key=creator_key,
      execution_counter=execution_counter,
  )

  def quote_price(sku: str, quantity: int, internal_note: str = ""):
    execution_counter["count"] += 1
    return {
        "sku": sku,
        "quantity": quantity,
        "total_cents": 8400,
        "private_note": internal_note,
    }

  agent = Agent(
      name=options["agent_name"],
      model=SingleToolCallModel({
          "sku": options["sku"],
          "quantity": 2,
          "internal_note": PRIVATE_PHRASE,
      }),
      instruction="Quote catalog items with the quote_price tool.",
      tools=[FunctionTool(quote_price, require_confirmation=options.get("require_confirmation", False))],
  )
  runner = InMemoryRunner(
      agent=agent,
      app_name=f"atrib-google-adk-python-decision-{options['policy_outcome']}",
      plugins=[plugin],
  )
  await runner.session_service.create_session(
      app_name=runner.app_name,
      user_id=options["user_id"],
      session_id=options["session_id"],
  )
  yielded_events = []
  async for event in runner.run_async(
      user_id=options["user_id"],
      session_id=options["session_id"],
      new_message=types.Content(
          role="user",
          parts=[types.Part.from_text(text=options["prompt"])],
      ),
  ):
    yielded_events.append(event)

  if not plugin.decisions:
    raise RuntimeError("Python ADK decision plugin did not sign a decision")
  decision = plugin.decisions[0]
  outcome = plugin.outcomes[0] if plugin.outcomes else None
  counts = event_counts(yielded_events)
  native_confirmation = native_confirmation_counts(yielded_events)
  return {
      "summary": {
          "decision_state": decision["entry"]["decision_state"],
          "decision_record_hash": decision["record_hash"],
          "outcome_record_hash": outcome["record_hash"] if outcome else None,
          "authority_mode": decision["entry"]["authority"]["mode"],
          "policy_source": decision["entry"]["policy"]["source"],
          "policy_rule": decision["entry"]["policy"]["rule"],
          "policy_reason": decision["entry"]["policy"].get("reason"),
          "selection_source": decision["entry"]["selection"]["source"],
          "selection_rationale_digest": decision["entry"]["selection"]["rationale_digest"],
          "model_rationale_trust": decision["entry"]["model_rationale"]["trust"],
          "tool_body_executed": execution_counter["count"] > 0,
          **native_confirmation,
          **counts,
      },
      "decision": decision,
      "outcome": outcome,
      "publicRecords": plugin.records,
      "sidecars": plugin.sidecars,
      "google_operational_ids": build_operational_ids(options["context_id"], plugin.sidecars),
  }


def build_operational_ids(context_id, sidecars):
  rows = []
  for sidecar in sidecars:
    rows.append({
        "trace_id": digest_hex(f"{context_id}:{sidecar['invocation_id']}".encode("utf-8"))[:32],
        "span_id": digest_hex(f"{sidecar['record_hash']}:span".encode("utf-8"))[:16],
        "adk_invocation_id": sidecar["invocation_id"],
        "adk_session_id": sidecar["session_id"],
        "adk_function_call_id": sidecar.get("function_call_id"),
        "adk_agent_name": sidecar["agent_name"],
        "source": "local-adk-python-decision-sidecar",
        "trace_projection": "deterministic-local",
    })
  return rows


def check_authorized_execution_binding(*, decision, tool_name, args, authority, policy_version, expires_at, now):
  canonical_args_digest = digest_canonical(args)
  actual_binding_hash = build_confirmation_binding_hash({
      "tool_name": tool_name,
      "canonical_args_digest": canonical_args_digest,
      "authority": authority,
      "policy_version": policy_version,
      "expires_at": expires_at,
  })
  expected_binding_hash = decision["confirmation"].get("binding_hash", "")
  reasons = []
  if decision["decision_state"] != "confirmation_resolved":
    reasons.append("decision_not_resolved")
  if decision["tool_name"] != tool_name:
    reasons.append("tool_mismatch")
  if decision["canonical_args_digest"] != canonical_args_digest:
    reasons.append("args_mismatch")
  if decision["authority"]["mode"] != authority["mode"]:
    reasons.append("authority_mode_mismatch")
  if decision["authority"]["principal_hash"] != authority["principal_hash"]:
    reasons.append("principal_mismatch")
  if decision["policy"]["version"] != policy_version:
    reasons.append("policy_version_mismatch")
  if expected_binding_hash != actual_binding_hash:
    reasons.append("confirmation_binding_mismatch")
  if now > expires_at:
    reasons.append("confirmation_expired")
  return {
      "ok": len(reasons) == 0,
      "decision_state": "confirmation_resolved" if len(reasons) == 0 else "stale_or_mismatched",
      "reasons": reasons,
      "expected_binding_hash": expected_binding_hash,
      "actual_binding_hash": actual_binding_hash,
  }


def build_confirmation_proof(*, chain_tail_record, start_timestamp_ms):
  private_key = load_private_key()
  creator_key = base64url_encode(public_key_for(private_key))
  authority = {
      "mode": "user-auth",
      "principal_hash": hash_principal("user:atlas-buyer@example.test"),
  }
  args = {"sku": "atlas-kit", "quantity": 2}
  canonical_args_digest = digest_canonical(args)
  expires_at = iso_ms(start_timestamp_ms + 60_000)
  binding_hash = build_confirmation_binding_hash({
      "tool_name": "quote_price",
      "canonical_args_digest": canonical_args_digest,
      "authority": authority,
      "policy_version": "atlas-policy-v1",
      "expires_at": expires_at,
  })
  required_entry = build_decision_ledger_entry({
      "decision_state": "confirmation_required",
      "invocation_id": "adk-python-confirmation-invocation-1",
      "session_id": "adk-python-confirmation-session-1",
      "step": 1,
      "tool_call_id": "adk-python-confirmation-call-1",
      "tool_name": "quote_price",
      "canonical_args_digest": canonical_args_digest,
      "authority": authority,
      "policy": {
          "source": "confirmation",
          "rule": "quote_price:requires-user-confirmation",
          "version": "atlas-policy-v1",
          "outcome": "escalate",
      },
      "confirmation": {
          "required": True,
          "confirmation_id": "confirm-atlas-1",
          "binding_hash": binding_hash,
          "expires_at": expires_at,
      },
      "model_rationale": "scripted model asked for a payment-impacting quote",
      "timestamp": iso_ms(start_timestamp_ms),
      "parent_record_hashes": [DEFAULT_PARENT_RECORD_HASH],
  })
  required = sign_decision_entry(
      entry=required_entry,
      private_key=private_key,
      creator_key=creator_key,
      context_id=DEFAULT_CONTEXT_ID,
      server_url=DEFAULT_SERVER_URL,
      timestamp_ms=start_timestamp_ms,
      previous_record=chain_tail_record,
      informed_by=[DEFAULT_PARENT_RECORD_HASH],
      user_id="atrib-python-confirmation-user",
      agent_name="google_adk_python_decision_confirmation_fixture",
      principal="user:atlas-buyer@example.test",
      args={"sku": "atlas-kit", "quantity": 2},
  )
  resolved_entry = build_decision_ledger_entry({
      "decision_state": "confirmation_resolved",
      "invocation_id": required_entry["invocation_id"],
      "session_id": required_entry["session_id"],
      "step": 2,
      "tool_call_id": required_entry["tool_call_id"],
      "tool_name": required_entry["tool_name"],
      "canonical_args_digest": canonical_args_digest,
      "authority": authority,
      "policy": {
          "source": "confirmation",
          "rule": "quote_price:requires-user-confirmation",
          "version": "atlas-policy-v1",
          "outcome": "allow",
      },
      "confirmation": {
          "required": True,
          "confirmation_id": "confirm-atlas-1",
          "response_payload_digest": digest_canonical({"approved": True, "approver": "operator"}),
          "binding_hash": binding_hash,
          "expires_at": expires_at,
      },
      "model_rationale": "operator confirmation resolved the pending call",
      "timestamp": iso_ms(start_timestamp_ms + 1_000),
      "parent_record_hashes": [required["record_hash"]],
  })
  resolved = sign_decision_entry(
      entry=resolved_entry,
      private_key=private_key,
      creator_key=creator_key,
      context_id=DEFAULT_CONTEXT_ID,
      server_url=DEFAULT_SERVER_URL,
      timestamp_ms=start_timestamp_ms + 1_000,
      previous_record=required["record"],
      informed_by=[required["record_hash"]],
      user_id="atrib-python-confirmation-user",
      agent_name="google_adk_python_decision_confirmation_fixture",
      principal="user:atlas-buyer@example.test",
      args={"sku": "atlas-kit", "quantity": 2},
  )
  binding = check_authorized_execution_binding(
      decision=resolved["entry"],
      tool_name="quote_price",
      args={"sku": "atlas-kit", "quantity": 3},
      authority=authority,
      policy_version="atlas-policy-v1",
      expires_at=expires_at,
      now=iso_ms(start_timestamp_ms + 2_000),
  )
  if binding["ok"] or "args_mismatch" not in binding["reasons"]:
    raise RuntimeError("confirmation mismatch proof did not fail closed on changed args")
  stale_entry = build_decision_ledger_entry({
      "decision_state": binding["decision_state"],
      "invocation_id": resolved_entry["invocation_id"],
      "session_id": resolved_entry["session_id"],
      "step": 3,
      "tool_call_id": resolved_entry["tool_call_id"],
      "tool_name": resolved_entry["tool_name"],
      "args": {"sku": "atlas-kit", "quantity": 3},
      "authority": authority,
      "policy": {
          "source": "confirmation",
          "rule": "quote_price:binding-check",
          "version": "atlas-policy-v1",
          "outcome": "deny",
          "reason": ",".join(binding["reasons"]),
      },
      "confirmation": {
          "required": True,
          "confirmation_id": "confirm-atlas-1",
          "binding_hash": binding["actual_binding_hash"],
          "expires_at": expires_at,
      },
      "model_rationale": "executor rejected a stale or mismatched confirmation binding",
      "timestamp": iso_ms(start_timestamp_ms + 2_000),
      "parent_record_hashes": [resolved["record_hash"]],
  })
  stale = sign_decision_entry(
      entry=stale_entry,
      private_key=private_key,
      creator_key=creator_key,
      context_id=DEFAULT_CONTEXT_ID,
      server_url=DEFAULT_SERVER_URL,
      timestamp_ms=start_timestamp_ms + 2_000,
      previous_record=resolved["record"],
      informed_by=[resolved["record_hash"]],
      user_id="atrib-python-confirmation-user",
      agent_name="google_adk_python_decision_confirmation_fixture",
      principal="user:atlas-buyer@example.test",
      args={"sku": "atlas-kit", "quantity": 3},
  )
  return {
      "required": required,
      "resolved": resolved,
      "stale": stale,
      "binding": binding,
      "publicRecords": [required["record"], resolved["record"], stale["record"]],
      "sidecars": [required["sidecar"], resolved["sidecar"], stale["sidecar"]],
  }


def summarize_decision(decision):
  return {
      "decision_state": decision["entry"]["decision_state"],
      "record_hash": decision["record_hash"],
      "canonical_args_digest": decision["entry"]["canonical_args_digest"],
      "confirmation_binding_hash": decision["entry"]["confirmation"].get("binding_hash"),
  }


def iso_ms(timestamp_ms):
  from datetime import datetime, timezone

  return datetime.fromtimestamp(timestamp_ms / 1000, tz=timezone.utc).isoformat().replace(
      "+00:00", "Z"
  )


def options_for(policy_outcome, sku, now_ms, extra=None):
  extra = extra or {}
  return {
      "context_id": extra.get("context_id", DEFAULT_CONTEXT_ID),
      "parent_record_hashes": extra.get("parent_record_hashes", [DEFAULT_PARENT_RECORD_HASH]),
      "session_id": extra.get("session_id", f"adk-python-decision-session-{policy_outcome}-{sku}"),
      "user_id": extra.get("user_id", "atrib-python-decision-user"),
      "agent_name": extra.get("agent_name", f"google_adk_python_decision_{policy_outcome}_agent"),
      "prompt": extra.get("prompt", f"Quote {sku}."),
      "policy_outcome": policy_outcome,
      "sku": sku,
      "now_ms": now_ms,
      "principal": extra.get("principal", "user:atlas-buyer@example.test"),
      "authority_mode": extra.get("authority_mode", "user-auth"),
      "require_confirmation": extra.get("require_confirmation", False),
      "native_confirmation_required": extra.get("native_confirmation_required", False),
      **({"deterministic_uuid_seed": extra["deterministic_uuid_seed"]} if "deterministic_uuid_seed" in extra else {}),
  }


async def run_proof():
  base_timestamp = 1_779_846_000_000
  allowed = await run_live_decision_path(
      options_for("allow", "atlas-kit", base_timestamp, {"deterministic_uuid_seed": 0xA110})
  )
  agent_authority = await run_live_decision_path(
      options_for(
          "allow",
          "agent-kit",
          base_timestamp + 5_000,
          {
              "authority_mode": "agent-auth",
              "principal": "agent:catalog-service@example.test",
              "agent_name": "google_adk_python_decision_agent_auth_agent",
              "deterministic_uuid_seed": 0xA63A,
          },
      )
  )
  refused = await run_live_decision_path(
      options_for("deny", "denied-kit", base_timestamp + 10_000, {"deterministic_uuid_seed": 0xD3A1})
  )
  policy_error = await run_live_decision_path(
      options_for(
          "error",
          "policy-error-kit",
          base_timestamp + 15_000,
          {"deterministic_uuid_seed": 0xE440},
      )
  )
  native_confirmation = await run_live_decision_path(
      options_for(
          "allow",
          "confirm-kit",
          base_timestamp + 18_000,
          {
              "native_confirmation_required": True,
              "require_confirmation": True,
              "deterministic_uuid_seed": 0xC0F1,
          },
      )
  )
  confirmation = build_confirmation_proof(
      chain_tail_record=policy_error["decision"]["record"],
      start_timestamp_ms=base_timestamp + 20_000,
  )
  public_records_json = canonical_json(
      allowed["publicRecords"]
      + agent_authority["publicRecords"]
      + refused["publicRecords"]
      + policy_error["publicRecords"]
      + native_confirmation["publicRecords"]
      + confirmation["publicRecords"]
  )
  sidecars_json = canonical_json(
      allowed["sidecars"]
      + agent_authority["sidecars"]
      + refused["sidecars"]
      + policy_error["sidecars"]
      + native_confirmation["sidecars"]
      + confirmation["sidecars"]
  )
  if PRIVATE_PHRASE in public_records_json:
    raise RuntimeError("public decision ledger records leaked private tool material")
  if PRIVATE_PHRASE not in sidecars_json:
    raise RuntimeError("decision ledger sidecars should keep inspectable tool material")
  if "user:atlas-buyer@example.test" in public_records_json:
    raise RuntimeError("public decision ledger records leaked the raw principal")
  if "agent:catalog-service@example.test" in public_records_json:
    raise RuntimeError("public decision ledger records leaked the raw agent principal")
  return {
      "ok": True,
      "strategy": "atrib-google-adk-python-decision-ledger-proof-v1",
      "adk": {
          "python_package": "google-adk",
          "version": adk_version.__version__,
          "runner": "InMemoryRunner",
          "plugin": "BasePlugin",
          "tool": "FunctionTool",
          "model": "BaseLlm",
      },
      "contract": {
          "schema": GOOGLE_ADK_DECISION_LEDGER_SCHEMA,
          "event_type": GOOGLE_ADK_DECISION_LEDGER_EVENT_TYPE_URI,
          "decision_states": [
              "allowed",
              "refused",
              "confirmation_required",
              "confirmation_resolved",
              "stale_or_mismatched",
              "policy_error",
          ],
          "framework_attested_fields": [
              "invocation_id",
              "session_id",
              "tool_call_id",
              "tool_name",
              "decision_state",
              "authority.mode",
              "policy.source",
              "policy.rule",
              "selection.source",
          ],
          "derived_commitments": [
              "canonical_args_digest",
              "confirmation.binding_hash",
              "result_digest",
              "selection.rationale_digest",
          ],
          "untrusted_fields": ["model_rationale.text"],
          "adk_surfaces": {
              "tool_selection": "BasePlugin.after_model_callback",
              "authority_decision": "BasePlugin.before_tool_callback",
              "execution_receipt": "BasePlugin.after_tool_callback",
              "native_confirmation_request": "FunctionTool(require_confirmation=True)",
              "confirmation_resolution_binding": "local fixture",
          },
      },
      "live_adk": {
          "allowed": allowed["summary"],
          "agent_authority": agent_authority["summary"],
          "refused": refused["summary"],
          "policy_error": policy_error["summary"],
          "native_confirmation_required": native_confirmation["summary"],
      },
      "confirmation": {
          "required": summarize_decision(confirmation["required"]),
          "resolved": summarize_decision(confirmation["resolved"]),
          "stale_or_mismatched": summarize_decision(confirmation["stale"]),
          "binding_reasons": confirmation["binding"]["reasons"],
          "fail_closed": True,
      },
      "record_hashes": {
          "allowed_decision": allowed["decision"]["record_hash"],
          "allowed_tool_outcome": allowed["outcome"]["record_hash"],
          "agent_authority_decision": agent_authority["decision"]["record_hash"],
          "agent_authority_tool_outcome": agent_authority["outcome"]["record_hash"],
          "refused_decision": refused["decision"]["record_hash"],
          "policy_error_decision": policy_error["decision"]["record_hash"],
          "native_confirmation_required": native_confirmation["decision"]["record_hash"],
          "confirmation_required": confirmation["required"]["record_hash"],
          "confirmation_resolved": confirmation["resolved"]["record_hash"],
          "stale_or_mismatched": confirmation["stale"]["record_hash"],
      },
      "proof": {
          "allowed_execution_informed_by_decision": allowed["outcome"]["record"]["informed_by"] == [allowed["decision"]["record_hash"]],
          "agent_authority_execution_informed_by_decision": agent_authority["outcome"]["record"]["informed_by"] == [agent_authority["decision"]["record_hash"]],
          "refused_tool_body_executed": refused["summary"]["tool_body_executed"],
          "policy_error_tool_body_executed": policy_error["summary"]["tool_body_executed"],
          "native_confirmation_tool_body_executed": native_confirmation["summary"]["tool_body_executed"],
          "native_confirmation_requested": native_confirmation["summary"]["requested_tool_confirmations"] > 0,
          "model_selection_captured": allowed["summary"]["selection_source"] == "after_model_callback",
          "agent_auth_mode_captured": agent_authority["summary"]["authority_mode"] == "agent-auth",
          "refusal_rule_recorded": refused["summary"]["policy_rule"] == "quote_price:atlas-policy",
          "policy_error_rule_recorded": policy_error["summary"]["policy_rule"] == "quote_price:atlas-policy",
          "confirmation_binding_covers": [
              "tool_name",
              "canonical_args_digest",
              "authority",
              "policy_version",
              "expires_at",
          ],
          "stale_mismatch_detected": True,
      },
      "privacy": {
          "public_records_hash_only": True,
          "local_sidecars_keep_payloads": True,
          "public_records_omit_private_phrase": True,
          "public_records_omit_raw_principal": True,
      },
      "publicRecords": (
          allowed["publicRecords"]
          + agent_authority["publicRecords"]
          + refused["publicRecords"]
          + policy_error["publicRecords"]
          + native_confirmation["publicRecords"]
          + confirmation["publicRecords"]
      ),
      "sidecars": allowed["sidecars"]
      + agent_authority["sidecars"]
      + refused["sidecars"]
      + policy_error["sidecars"]
      + native_confirmation["sidecars"]
      + confirmation["sidecars"],
      "caveats": [
          "The allowed, agent-auth, refused, policy_error, and native confirmation_required states run through real google-adk Python InMemoryRunner BasePlugin callbacks.",
          "Native ADK FunctionTool require_confirmation is exercised for confirmation_required, but confirmation_resolved and stale_or_mismatched binding checks stay local fixtures because ADK ToolConfirmation does not expose a native binding tag over tool, args, authority, policy, and expiry.",
          "This does not claim Agent Platform Runtime, Gemini Enterprise, BigQuery export, Memory Bank, or Google adoption.",
      ],
  }


async def run_allow_path(options):
  path = await run_live_decision_path(
      options_for(
          "allow",
          options.get("sku", "atlas-kit"),
          options.get("now_ms", 1_779_846_000_000),
          {
              "context_id": options.get("context_id", DEFAULT_CONTEXT_ID),
              "parent_record_hashes": [options.get("parent_record_hash", DEFAULT_PARENT_RECORD_HASH)],
              "session_id": options.get("session_id", "adk-python-decision-session-allow-atlas-kit"),
              "prompt": options.get("prompt", "Quote atlas-kit."),
              "agent_name": "google_adk_python_decision_allow_agent",
              "deterministic_uuid_seed": options.get("deterministic_uuid_seed", 0x676F6F67),
          },
      )
  )
  if not path.get("outcome"):
    raise RuntimeError("allowed Python ADK decision did not sign a tool outcome")
  return {
      "ok": True,
      "strategy": "atrib-google-adk-python-decision-ledger-allow-path-v1",
      "adk": {
          "python_package": "google-adk",
          "version": adk_version.__version__,
          "runner": "InMemoryRunner",
          "plugin": "BasePlugin",
          "tool": "FunctionTool",
          "model": "BaseLlm",
      },
      **path,
  }


async def run_for_options(options):
  if options.get("mode") == "allow_path":
    return await run_allow_path(options)
  return await run_proof()


async def worker_main():
  while True:
    line = await asyncio.to_thread(sys.stdin.readline)
    if line == "":
      return
    if not line.strip():
      continue
    try:
      result = await run_for_options(json.loads(line))
      print(json.dumps({"ok": True, "result": result}, sort_keys=True), flush=True)
    except Exception as error:
      print(
          json.dumps(
              {
                  "ok": False,
                  "error": str(error),
                  "error_type": error.__class__.__name__,
              },
              sort_keys=True,
          ),
          flush=True,
      )


async def main():
  if os.environ.get("ATRIB_GOOGLE_ADK_PYTHON_WORKER") == "1":
    await worker_main()
    return
  raw_options = os.environ.get("ATRIB_GOOGLE_ADK_PYTHON_DECISION_OPTIONS")
  options = json.loads(raw_options) if raw_options else {"mode": "proof"}
  result = await run_for_options(options)
  print(json.dumps(result, indent=2, sort_keys=True))


if __name__ == "__main__":
  asyncio.run(main())
