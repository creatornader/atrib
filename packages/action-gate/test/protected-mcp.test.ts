// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import {
  computeProtectedMcpBinding,
  createMemoryProtectedMcpPermitStore,
  createProtectedMcpExecutor,
  type ProtectedMcpActionContext,
  type ProtectedMcpToolCall,
} from '../src/index.js'

const PRIVATE_KEY = new Uint8Array(32).fill(23)
const CONTEXT_ID = '1234567890abcdef1234567890abcdef'
const NOW_MS = 1_780_000_000_000
const ACTION: ProtectedMcpActionContext = {
  run_id: 'run-1',
  action_id: 'action-1',
  agent_id: 'agent-1',
  risk: ['external_write'],
  credential: {
    run_key: 'run-key-1',
    principal_key: ['principal', 'key', '1'].join('-'),
  },
}
const REQUEST: ProtectedMcpToolCall = {
  name: 'payments.transfer',
  arguments: { amount: '42.00', recipient: 'merchant-1' },
}

describe('protected MCP executor', () => {
  it('issues and consumes a one-time permit only after an allow decision', async () => {
    let calls = 0
    const executor = createProtectedMcpExecutor({
      privateKey: PRIVATE_KEY,
      contextId: CONTEXT_ID,
      now: () => NOW_MS,
      createPermitId: () => 'permit-allow-1',
      evaluate: () => ({
        outcome: 'allow',
        policy_id: 'mcp-policy',
        policy_version: '1',
      }),
      executeUpstream: async (request) => {
        calls += 1
        return { accepted: true, request }
      },
    })

    const result = await executor.authorizeAndExecute({
      action: ACTION,
      request: REQUEST,
    })

    expect(result.state).toBe('allowed')
    expect(result.action_executed).toBe(true)
    expect(result.verification.valid).toBe(true)
    expect(result.result).toEqual({ accepted: true, request: REQUEST })
    expect(calls).toBe(1)

    const replay = await executor.dispatch({
      action: ACTION,
      request: REQUEST,
      permit_id: 'permit-allow-1',
    })
    expect(replay).toMatchObject({
      ok: false,
      authorization: { reason: 'authorization_consumed' },
    })
    if (replay.ok) throw new Error('expected replay rejection')
    expect(replay.bypass_evidence?.state).toBe('blocked')
    expect(replay.bypass_evidence?.verification.valid).toBe(true)
    expect(calls).toBe(1)
  })

  it('does not issue a permit or execute when policy blocks the action', async () => {
    let permitIds = 0
    let calls = 0
    const executor = createProtectedMcpExecutor({
      privateKey: PRIVATE_KEY,
      contextId: CONTEXT_ID,
      now: () => NOW_MS,
      createPermitId: () => {
        permitIds += 1
        return `permit-${permitIds}`
      },
      evaluate: () => ({
        outcome: 'block',
        policy_id: 'mcp-policy',
        policy_version: '1',
      }),
      executeUpstream: () => {
        calls += 1
        return { accepted: true }
      },
    })

    const result = await executor.authorizeAndExecute({
      action: ACTION,
      request: REQUEST,
    })

    expect(result.state).toBe('blocked')
    expect(result.action_executed).toBe(false)
    expect(result.verification.valid).toBe(true)
    expect(permitIds).toBe(0)
    expect(calls).toBe(0)
  })

  it('rejects a direct dispatch with no permit before the upstream side effect', async () => {
    let calls = 0
    const executor = createProtectedMcpExecutor({
      privateKey: PRIVATE_KEY,
      evaluate: () => ({
        outcome: 'allow',
        policy_id: 'mcp-policy',
        policy_version: '1',
      }),
      executeUpstream: () => {
        calls += 1
        return { accepted: true }
      },
    })

    const bypass = await executor.dispatch({
      action: ACTION,
      request: REQUEST,
    })

    expect(bypass).toMatchObject({
      ok: false,
      authorization: { reason: 'authorization_missing' },
    })
    if (bypass.ok) throw new Error('expected bypass rejection')
    expect(bypass.bypass_evidence?.state).toBe('blocked')
    expect(bypass.bypass_evidence?.verification.valid).toBe(true)
    expect(calls).toBe(0)
  })

  it('rejects an unknown permit before the upstream side effect', async () => {
    let calls = 0
    const executor = createProtectedMcpExecutor({
      privateKey: PRIVATE_KEY,
      now: () => NOW_MS,
      evaluate: () => ({
        outcome: 'allow',
        policy_id: 'mcp-policy',
        policy_version: '1',
      }),
      executeUpstream: () => {
        calls += 1
        return { accepted: true }
      },
    })

    const bypass = await executor.dispatch({
      action: ACTION,
      request: REQUEST,
      permit_id: 'not-issued',
    })

    expect(bypass).toMatchObject({
      ok: false,
      authorization: { reason: 'authorization_unknown' },
    })
    if (bypass.ok) throw new Error('expected bypass rejection')
    expect(bypass.bypass_evidence?.state).toBe('blocked')
    expect(calls).toBe(0)
  })

  it('keeps bypass rejection closed when evidence signing fails', async () => {
    let calls = 0
    const executor = createProtectedMcpExecutor({
      privateKey: new Uint8Array(31),
      evaluate: () => ({
        outcome: 'allow',
        policy_id: 'mcp-policy',
        policy_version: '1',
      }),
      executeUpstream: () => {
        calls += 1
        return { accepted: true }
      },
    })

    const bypass = await executor.dispatch({
      action: ACTION,
      request: REQUEST,
    })

    expect(bypass).toMatchObject({
      ok: false,
      authorization: { reason: 'authorization_missing' },
      evidence_error: {
        name: 'Error',
        message: 'Action Gate privateKey must be 32 bytes',
      },
    })
    expect(calls).toBe(0)
  })

  it('does not burn a valid permit when a different MCP call probes it', async () => {
    let calls = 0
    const store = createMemoryProtectedMcpPermitStore()
    await store.issue({
      permit_id: 'permit-bound',
      binding: computeProtectedMcpBinding({ action: ACTION, request: REQUEST }),
      issued_at_ms: NOW_MS,
      expires_at_ms: NOW_MS + 1_000,
    })
    const executor = createProtectedMcpExecutor({
      privateKey: PRIVATE_KEY,
      permitStore: store,
      now: () => NOW_MS,
      evaluate: () => ({
        outcome: 'allow',
        policy_id: 'mcp-policy',
        policy_version: '1',
      }),
      executeUpstream: () => {
        calls += 1
        return { accepted: true }
      },
    })

    const mismatch = await executor.dispatch({
      action: ACTION,
      request: { ...REQUEST, arguments: { amount: '43.00', recipient: 'merchant-1' } },
      permit_id: 'permit-bound',
    })
    const accepted = await executor.dispatch({
      action: ACTION,
      request: REQUEST,
      permit_id: 'permit-bound',
    })

    expect(mismatch).toMatchObject({
      ok: false,
      authorization: { reason: 'authorization_binding_mismatch' },
    })
    if (mismatch.ok) throw new Error('expected mismatch rejection')
    expect(mismatch.bypass_evidence?.state).toBe('blocked')
    expect(accepted.ok).toBe(true)
    expect(calls).toBe(1)
  })

  it('rejects an expired permit before the upstream side effect', async () => {
    let calls = 0
    const store = createMemoryProtectedMcpPermitStore()
    await store.issue({
      permit_id: 'permit-expired',
      binding: computeProtectedMcpBinding({ action: ACTION, request: REQUEST }),
      issued_at_ms: NOW_MS,
      expires_at_ms: NOW_MS + 10,
    })
    const executor = createProtectedMcpExecutor({
      privateKey: PRIVATE_KEY,
      permitStore: store,
      now: () => NOW_MS + 11,
      evaluate: () => ({
        outcome: 'allow',
        policy_id: 'mcp-policy',
        policy_version: '1',
      }),
      executeUpstream: () => {
        calls += 1
        return { accepted: true }
      },
    })

    const expired = await executor.dispatch({
      action: ACTION,
      request: REQUEST,
      permit_id: 'permit-expired',
    })

    expect(expired).toMatchObject({
      ok: false,
      authorization: { reason: 'authorization_expired' },
    })
    if (expired.ok) throw new Error('expected expiry rejection')
    expect(expired.bypass_evidence?.state).toBe('blocked')
    expect(calls).toBe(0)
  })

  it('blocks a revoked run credential before policy evaluation or execution', async () => {
    let policyCalls = 0
    let upstreamCalls = 0
    const executor = createProtectedMcpExecutor({
      privateKey: PRIVATE_KEY,
      revokedKeys: new Set(['run-key-1']),
      evaluate: () => {
        policyCalls += 1
        return {
          outcome: 'allow',
          policy_id: 'mcp-policy',
          policy_version: '1',
        }
      },
      executeUpstream: () => {
        upstreamCalls += 1
        return { accepted: true }
      },
    })

    const result = await executor.authorizeAndExecute({
      action: ACTION,
      request: REQUEST,
    })

    expect(result.state).toBe('blocked')
    expect(result.action_executed).toBe(false)
    expect(result.decision.entry.policy.policy_id).toBe('atrib.protected-mcp.revocation')
    expect(result.decision.entry.policy.evidence?.authorization_reason).toBe(
      'authorization_credential_revoked',
    )
    expect(policyCalls).toBe(0)
    expect(upstreamCalls).toBe(0)
  })

  it('checks revocation again at dispatch and closes a policy-to-use race', async () => {
    let checks = 0
    let upstreamCalls = 0
    const executor = createProtectedMcpExecutor({
      privateKey: PRIVATE_KEY,
      revokedKeys: () => {
        checks += 1
        return checks === 1 ? new Set<string>() : new Set(['run-key-1'])
      },
      evaluate: () => ({
        outcome: 'allow',
        policy_id: 'mcp-policy',
        policy_version: '1',
      }),
      executeUpstream: () => {
        upstreamCalls += 1
        return { accepted: true }
      },
    })

    const result = await executor.authorizeAndExecute({
      action: ACTION,
      request: REQUEST,
    })

    expect(result.state).toBe('allowed')
    expect(result.action_executed).toBe(true)
    expect(result.outcome.entry.status).toBe('execution_error')
    expect(result.error?.message).toContain('authorization_credential_revoked')
    expect(checks).toBe(2)
    expect(upstreamCalls).toBe(0)
  })

  it('fails closed when a revocation view is configured but no credential is supplied', async () => {
    const executor = createProtectedMcpExecutor({
      privateKey: PRIVATE_KEY,
      revokedKeys: new Set(),
      evaluate: () => ({
        outcome: 'allow',
        policy_id: 'mcp-policy',
        policy_version: '1',
      }),
      executeUpstream: () => ({ accepted: true }),
    })

    const result = await executor.authorizeAndExecute({
      action: {
        run_id: ACTION.run_id,
        action_id: ACTION.action_id,
        agent_id: ACTION.agent_id,
        risk: ACTION.risk,
      },
      request: REQUEST,
    })

    expect(result.state).toBe('blocked')
    expect(result.decision.entry.policy.evidence?.authorization_reason).toBe(
      'authorization_credential_missing',
    )
  })
})
