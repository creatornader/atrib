// SPDX-License-Identifier: Apache-2.0

import type { Sha256Uri } from '@atrib/runtime-log'

export const HOST_RUNTIME_PROOF_ENVELOPE_SCHEMA =
  'https://atrib.dev/schemas/integration/host-runtime-proof-envelope/v0' as const

export type HostRuntimeId =
  | 'claude-code'
  | 'codex'
  | 'cursor'
  | 'gemini-cli'
  | 'goose'
  | 'hermes'
  | 'opencode'
  | 'openclaw'
  | 'github-copilot'
  | 'custom'

export type HostRuntimeBoundary =
  | 'native-tool-hook'
  | 'mcp-tool-call'
  | 'sdk-callback'
  | 'lifecycle-hook'
  | 'runtime-log-window'
  | 'span-intake'
  | 'post-hoc-export'
  | 'approval'
  | 'handoff'
  | 'subagent'
  | 'sandbox-signer'

export type HostRuntimeAdapterFamily =
  | 'framework-tool-call'
  | 'host-runtime'
  | 'observability-intake'
  | 'runtime-log'
  | 'hosted-runtime-import'
  | 'sandbox-signer'
  | 'handoff-verify'

export type HostRuntimeProducer =
  | '@atrib/agent'
  | '@atrib/mcp'
  | '@atrib/mcp-wrap'
  | '@atrib/openinference'
  | '@atrib/runtime-log'
  | '@atrib/verify'
  | 'atrib-emit-cli'
  | 'host-runtime-adapter'
  | 'local-substrate'

export type HostRuntimeSigningRole =
  | 'tool-call-owner'
  | 'proof-owner'
  | 'manifest-only'
  | 'correlation-only'
  | 'verifier-only'
  | 'skip'

export type HostRuntimeStatus = 'ok' | 'error' | 'blocked' | 'cancelled' | 'unknown'

export type HostRuntimePrivacyPosture =
  | 'hash-only'
  | 'local-sidecar'
  | 'archive-evidence'
  | 'public-body'

export type HostRuntimeSpanContract = 'openinference' | 'otel' | 'unknown'

export interface HostRuntimeSurfaceInput {
  readonly host: HostRuntimeId
  readonly boundary: HostRuntimeBoundary
  readonly atrib_owned_mcp_server?: boolean
  readonly already_wrapped_by_mcp?: boolean
  readonly has_direct_tool_hook?: boolean
  readonly span_contract?: HostRuntimeSpanContract
}

export interface HostRuntimeSurfaceClassification {
  readonly host: HostRuntimeId
  readonly family: HostRuntimeAdapterFamily
  readonly producer: HostRuntimeProducer
  readonly signing_role: HostRuntimeSigningRole
  readonly reason: string
}

export interface HostRuntimeProofEnvelope {
  readonly schema: typeof HOST_RUNTIME_PROOF_ENVELOPE_SCHEMA
  readonly host: HostRuntimeId
  readonly family: HostRuntimeAdapterFamily
  readonly boundary: HostRuntimeBoundary
  readonly producer: HostRuntimeProducer
  readonly signing_role: HostRuntimeSigningRole
  readonly host_version?: string
  readonly session_id?: string
  readonly context_id?: string
  readonly run_id?: string
  readonly task_id?: string
  readonly turn_id?: string
  readonly api_request_id?: string
  readonly tool_call_id?: string
  readonly tool_name?: string
  readonly args_hash?: Sha256Uri
  readonly result_hash?: Sha256Uri
  readonly status?: HostRuntimeStatus
  readonly duration_ms?: number
  readonly record_hash?: Sha256Uri
  readonly manifest_hash?: Sha256Uri
  readonly privacy_posture?: HostRuntimePrivacyPosture
  readonly notes?: readonly string[]
}

export type HostRuntimeProofIssueCode =
  | 'duplicate_tool_call_producer'
  | 'missing_tool_call_identity'

export interface HostRuntimeProofIssue {
  readonly code: HostRuntimeProofIssueCode
  readonly message: string
  readonly key?: string
  readonly producers?: readonly HostRuntimeProducer[]
}

export interface HostRuntimeProofCheckResult {
  readonly ok: boolean
  readonly issues: readonly HostRuntimeProofIssue[]
}

export type HostRuntimeProofEnvelopeInput = Omit<HostRuntimeProofEnvelope, 'schema'>

export function classifyHostRuntimeSurface(
  input: HostRuntimeSurfaceInput,
): HostRuntimeSurfaceClassification {
  if (input.boundary === 'native-tool-hook' && input.already_wrapped_by_mcp) {
    return {
      host: input.host,
      family: 'host-runtime',
      producer: 'host-runtime-adapter',
      signing_role: 'skip',
      reason: 'the MCP wrapper owns this tool call, so the host adapter only correlates ids',
    }
  }

  switch (input.boundary) {
    case 'mcp-tool-call':
      return {
        host: input.host,
        family: 'framework-tool-call',
        producer: input.atrib_owned_mcp_server ? '@atrib/mcp' : '@atrib/mcp-wrap',
        signing_role: 'tool-call-owner',
        reason: input.atrib_owned_mcp_server
          ? 'the atrib-owned MCP server can sign directly at the server boundary'
          : 'the call crosses third-party MCP, so signing belongs at the wrapper boundary',
      }
    case 'sdk-callback':
      return {
        host: input.host,
        family: 'framework-tool-call',
        producer: '@atrib/agent',
        signing_role: 'tool-call-owner',
        reason: 'the SDK callback exposes the outbound call before the host runtime layer',
      }
    case 'native-tool-hook':
      return {
        host: input.host,
        family: 'host-runtime',
        producer: 'host-runtime-adapter',
        signing_role: 'tool-call-owner',
        reason: 'the host hook is closest to native tool execution and owns host ids',
      }
    case 'lifecycle-hook':
      return {
        host: input.host,
        family: 'host-runtime',
        producer: 'atrib-emit-cli',
        signing_role: 'proof-owner',
        reason: 'lifecycle hooks are host events, not tool-call middleware',
      }
    case 'approval':
      return {
        host: input.host,
        family: 'host-runtime',
        producer: 'host-runtime-adapter',
        signing_role: 'proof-owner',
        reason: 'approval decisions are host evidence linked to later signed actions',
      }
    case 'subagent':
      return {
        host: input.host,
        family: 'host-runtime',
        producer: 'host-runtime-adapter',
        signing_role: 'proof-owner',
        reason: 'subagent launch and completion are host runtime events',
      }
    case 'handoff':
      return {
        host: input.host,
        family: 'handoff-verify',
        producer: '@atrib/verify',
        signing_role: 'verifier-only',
        reason: 'receivers verify upstream claims before linking follow-up work',
      }
    case 'runtime-log-window':
      return {
        host: input.host,
        family: 'runtime-log',
        producer: '@atrib/runtime-log',
        signing_role: 'manifest-only',
        reason: 'the host owns raw run history and atrib verifies a bounded manifest',
      }
    case 'span-intake':
      return classifySpanIntake(input)
    case 'post-hoc-export':
      return {
        host: input.host,
        family: 'hosted-runtime-import',
        producer: 'host-runtime-adapter',
        signing_role: 'proof-owner',
        reason: 'the adapter signs what the consumer observed from the hosted export',
      }
    case 'sandbox-signer':
      return {
        host: input.host,
        family: 'sandbox-signer',
        producer: 'local-substrate',
        signing_role: 'proof-owner',
        reason: 'the host signer owns keys while sandboxed code requests signatures',
      }
  }
}

export function createHostRuntimeProofEnvelope(
  input: HostRuntimeProofEnvelopeInput,
): HostRuntimeProofEnvelope {
  return {
    schema: HOST_RUNTIME_PROOF_ENVELOPE_SCHEMA,
    ...input,
  }
}

export function checkHostRuntimeProofEnvelopes(
  envelopes: readonly HostRuntimeProofEnvelope[],
): HostRuntimeProofCheckResult {
  const issues: HostRuntimeProofIssue[] = []
  const ownersByKey = new Map<string, HostRuntimeProofEnvelope[]>()

  for (const envelope of envelopes) {
    if (envelope.signing_role !== 'tool-call-owner') continue

    const key = toolCallKey(envelope)
    if (!key) {
      issues.push({
        code: 'missing_tool_call_identity',
        message: 'tool-call owners need a tool_call_id or tool_name',
      })
      continue
    }

    const current = ownersByKey.get(key) ?? []
    current.push(envelope)
    ownersByKey.set(key, current)
  }

  for (const [key, owners] of ownersByKey) {
    if (owners.length < 2) continue
    issues.push({
      code: 'duplicate_tool_call_producer',
      key,
      message: 'one host tool call has more than one signing owner',
      producers: owners.map((owner) => owner.producer),
    })
  }

  return {
    ok: issues.length === 0,
    issues,
  }
}

function classifySpanIntake(input: HostRuntimeSurfaceInput): HostRuntimeSurfaceClassification {
  if (input.has_direct_tool_hook || input.already_wrapped_by_mcp) {
    return {
      host: input.host,
      family: 'observability-intake',
      producer: '@atrib/openinference',
      signing_role: 'correlation-only',
      reason: 'a stronger execution boundary owns signing, so spans only correlate',
    }
  }

  if (input.span_contract === 'openinference') {
    return {
      host: input.host,
      family: 'observability-intake',
      producer: '@atrib/openinference',
      signing_role: 'proof-owner',
      reason: 'OpenInference-shaped spans can feed signed records and local sidecars',
    }
  }

  return {
    host: input.host,
    family: 'observability-intake',
    producer: 'host-runtime-adapter',
    signing_role: 'skip',
    reason: 'plain OTel spans need a host-specific ingest contract before signing',
  }
}

function toolCallKey(envelope: HostRuntimeProofEnvelope): string | undefined {
  const identity = envelope.tool_call_id ?? envelope.tool_name
  if (!identity) return undefined

  return [
    envelope.host,
    envelope.session_id ?? '',
    envelope.context_id ?? '',
    envelope.run_id ?? '',
    envelope.task_id ?? '',
    envelope.turn_id ?? '',
    envelope.api_request_id ?? '',
    identity,
  ].join('\u0000')
}
