import { describe, expect, it } from 'vitest'
import type { AtribRecord } from '@atrib/mcp'
import {
  findProtectedIdentityKeys,
  runMem0MutationAssurance,
} from '../src/mem0-mutation-assurance.js'

const privateKey = new Uint8Array(32).fill(47)
const contextId = 'a9b79c3a5a394930867f46bbdc40dcc4'

describe('mem0 mutation assurance', () => {
  it('blocks identity scope passed through update metadata', async () => {
    let executed = false
    const result = await runMem0MutationAssurance({
      privateKey,
      contextId,
      runId: 'mem0-test',
      actionId: 'blocked-update',
      agentId: 'memory-agent',
      operation: 'update',
      args: {
        memory_id: 'memory-1',
        update: {
          metadata: { user_id: 'tenant-b', category: 'account' },
        },
      },
      execute: () => {
        executed = true
        return { message: 'updated' }
      },
      verifyPostcondition: () => [{ name: 'scope_preserved', passed: false }],
    })

    expect(result.state).toBe('blocked')
    expect(result.action_executed).toBe(false)
    expect(executed).toBe(false)
    expect(result.outcome.entry.status).toBe('blocked')
    expect(result.verification.valid).toBe(true)
  })

  it('signs a sanitized postcondition result after an allowed mutation', async () => {
    const records: AtribRecord[] = []
    const secret = 'customer prefers paper invoices'
    const result = await runMem0MutationAssurance({
      privateKey,
      contextId,
      runId: 'mem0-test',
      actionId: 'allowed-update',
      agentId: 'memory-agent',
      operation: 'update',
      args: {
        memory_id: 'memory-1',
        update: { text: secret, metadata: { category: 'billing' } },
      },
      execute: () => ({ message: 'Memory updated successfully!' }),
      summarizeResult: () => ({ mem0_reported_success: true }),
      verifyPostcondition: () => [
        { name: 'text_updated', passed: true },
        { name: 'identity_scope_preserved', passed: true },
      ],
      onRecord: (record) => {
        records.push(record)
      },
    })

    expect(result.state).toBe('allowed')
    expect(result.action_executed).toBe(true)
    expect(result.result?.postcondition.status).toBe('passed')
    expect(result.verification.valid).toBe(true)
    expect(records).toHaveLength(2)
    expect(JSON.stringify(records)).not.toContain(secret)
    expect(JSON.stringify(result.result)).not.toContain(secret)
  })

  it('surfaces a false success as a failed postcondition', async () => {
    const result = await runMem0MutationAssurance({
      privateKey,
      contextId,
      runId: 'mem0-test',
      actionId: 'stale-delete',
      agentId: 'memory-agent',
      operation: 'delete',
      args: { memory_id: 'memory-1' },
      execute: () => ({ message: 'Memory deleted successfully!' }),
      verifyPostcondition: () => [{ name: 'memory_absent', passed: false }],
    })

    expect(result.state).toBe('allowed')
    expect(result.outcome.entry.status).toBe('executed')
    expect(result.result?.postcondition.status).toBe('failed')
    expect(result.verification.valid).toBe(true)
  })

  it('does not treat a missing or failed state check as verified', async () => {
    const missing = await runMem0MutationAssurance({
      privateKey,
      contextId,
      runId: 'mem0-test',
      actionId: 'missing-postcondition',
      agentId: 'memory-agent',
      operation: 'reset',
      execute: () => undefined,
      verifyPostcondition: () => [],
    })
    const failed = await runMem0MutationAssurance({
      privateKey,
      contextId,
      runId: 'mem0-test',
      actionId: 'failed-postcondition',
      agentId: 'memory-agent',
      operation: 'reset',
      execute: () => undefined,
      verifyPostcondition: () => {
        throw new TypeError('private verifier detail')
      },
    })

    expect(missing.result?.postcondition).toEqual({
      status: 'failed',
      checks: [{ name: 'postcondition_defined', passed: false }],
    })
    expect(failed.result?.postcondition).toEqual({
      status: 'failed',
      checks: [{ name: 'postcondition_check_completed', passed: false }],
      error: { name: 'TypeError' },
    })
    expect(JSON.stringify(failed.result)).not.toContain('private verifier detail')
  })

  it('keeps a summary error separate from mutation execution', async () => {
    const result = await runMem0MutationAssurance({
      privateKey,
      contextId,
      runId: 'mem0-test',
      actionId: 'summary-error',
      agentId: 'memory-agent',
      operation: 'update',
      execute: () => ({ message: 'Memory updated successfully!' }),
      summarizeResult: () => {
        throw new RangeError('private summary detail')
      },
      verifyPostcondition: () => [{ name: 'text_updated', passed: true }],
    })

    expect(result.action_executed).toBe(true)
    expect(result.outcome.entry.status).toBe('executed')
    expect(result.result?.execution.summary).toEqual({
      summary_completed: false,
      summary_error_name: 'RangeError',
    })
    expect(JSON.stringify(result.result)).not.toContain('private summary detail')
  })

  it('finds only identity fields inside freeform metadata', () => {
    expect(
      findProtectedIdentityKeys({
        update: {
          metadata: {
            actor_id: 'actor-a',
            category: 'billing',
            run_id: 'run-a',
          },
        },
      }),
    ).toEqual(['actor_id', 'run_id'])
    expect(findProtectedIdentityKeys({ metadata: { category: 'billing' } })).toEqual([])
  })
})
