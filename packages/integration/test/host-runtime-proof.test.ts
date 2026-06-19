// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import {
  HOST_RUNTIME_PROOF_ENVELOPE_SCHEMA,
  checkHostRuntimeProofEnvelopes,
  classifyHostRuntimeSurface,
  createHostRuntimeProofEnvelope,
} from '../src/host-runtime-proof.js'

describe('host runtime proof classification', () => {
  it('treats OpenClaw native tool hooks as host runtime signing owners', () => {
    expect(
      classifyHostRuntimeSurface({
        host: 'openclaw',
        boundary: 'native-tool-hook',
      }),
    ).toMatchObject({
      family: 'host-runtime',
      producer: 'host-runtime-adapter',
      signing_role: 'tool-call-owner',
    })
  })

  it('treats Hermes native tool hooks as host runtime signing owners', () => {
    expect(
      classifyHostRuntimeSurface({
        host: 'hermes',
        boundary: 'native-tool-hook',
      }),
    ).toMatchObject({
      family: 'host-runtime',
      producer: 'host-runtime-adapter',
      signing_role: 'tool-call-owner',
    })
  })

  it('lets MCP wrapping own a tool call when a host hook sees the same call', () => {
    expect(
      classifyHostRuntimeSurface({
        host: 'openclaw',
        boundary: 'native-tool-hook',
        already_wrapped_by_mcp: true,
      }),
    ).toMatchObject({
      family: 'host-runtime',
      producer: 'host-runtime-adapter',
      signing_role: 'skip',
    })

    expect(
      classifyHostRuntimeSurface({
        host: 'openclaw',
        boundary: 'mcp-tool-call',
      }),
    ).toMatchObject({
      family: 'framework-tool-call',
      producer: '@atrib/mcp-wrap',
      signing_role: 'tool-call-owner',
    })
  })

  it('routes atrib-owned MCP servers to direct MCP middleware', () => {
    expect(
      classifyHostRuntimeSurface({
        host: 'hermes',
        boundary: 'mcp-tool-call',
        atrib_owned_mcp_server: true,
      }),
    ).toMatchObject({
      family: 'framework-tool-call',
      producer: '@atrib/mcp',
      signing_role: 'tool-call-owner',
    })
  })

  it('keeps spans as correlation when a direct hook already owns signing', () => {
    expect(
      classifyHostRuntimeSurface({
        host: 'hermes',
        boundary: 'span-intake',
        span_contract: 'openinference',
        has_direct_tool_hook: true,
      }),
    ).toMatchObject({
      family: 'observability-intake',
      producer: '@atrib/openinference',
      signing_role: 'correlation-only',
    })
  })

  it('uses runtime-log manifests for host-owned run windows', () => {
    expect(
      classifyHostRuntimeSurface({
        host: 'openclaw',
        boundary: 'runtime-log-window',
      }),
    ).toMatchObject({
      family: 'runtime-log',
      producer: '@atrib/runtime-log',
      signing_role: 'manifest-only',
    })
  })
})

describe('host runtime proof envelope checks', () => {
  it('creates schema-pinned envelopes', () => {
    const envelope = createHostRuntimeProofEnvelope({
      host: 'hermes',
      family: 'host-runtime',
      boundary: 'native-tool-hook',
      producer: 'host-runtime-adapter',
      signing_role: 'tool-call-owner',
      session_id: 'session-1',
      tool_call_id: 'tool-call-1',
      status: 'ok',
      privacy_posture: 'hash-only',
    })

    expect(envelope.schema).toBe(HOST_RUNTIME_PROOF_ENVELOPE_SCHEMA)
  })

  it('flags duplicate tool-call signing owners for one host event', () => {
    const hostEnvelope = createHostRuntimeProofEnvelope({
      host: 'openclaw',
      family: 'host-runtime',
      boundary: 'native-tool-hook',
      producer: 'host-runtime-adapter',
      signing_role: 'tool-call-owner',
      session_id: 'session-1',
      tool_call_id: 'tool-call-1',
      tool_name: 'shell',
      status: 'ok',
    })
    const mcpEnvelope = createHostRuntimeProofEnvelope({
      host: 'openclaw',
      family: 'framework-tool-call',
      boundary: 'mcp-tool-call',
      producer: '@atrib/mcp-wrap',
      signing_role: 'tool-call-owner',
      session_id: 'session-1',
      tool_call_id: 'tool-call-1',
      tool_name: 'shell',
      status: 'ok',
    })

    const result = checkHostRuntimeProofEnvelopes([hostEnvelope, mcpEnvelope])

    expect(result.ok).toBe(false)
    expect(result.issues[0]!.code).toBe('duplicate_tool_call_producer')
    expect(result.issues[0]!.producers).toEqual(['host-runtime-adapter', '@atrib/mcp-wrap'])
  })

  it('allows host correlation next to an MCP signing owner', () => {
    const hostEnvelope = createHostRuntimeProofEnvelope({
      host: 'openclaw',
      family: 'host-runtime',
      boundary: 'native-tool-hook',
      producer: 'host-runtime-adapter',
      signing_role: 'skip',
      session_id: 'session-1',
      tool_call_id: 'tool-call-1',
      tool_name: 'shell',
    })
    const mcpEnvelope = createHostRuntimeProofEnvelope({
      host: 'openclaw',
      family: 'framework-tool-call',
      boundary: 'mcp-tool-call',
      producer: '@atrib/mcp-wrap',
      signing_role: 'tool-call-owner',
      session_id: 'session-1',
      tool_call_id: 'tool-call-1',
      tool_name: 'shell',
      status: 'ok',
    })

    const result = checkHostRuntimeProofEnvelopes([hostEnvelope, mcpEnvelope])

    expect(result).toEqual({
      ok: true,
      issues: [],
    })
  })
})
