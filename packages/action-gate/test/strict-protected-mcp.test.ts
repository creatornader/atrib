// SPDX-License-Identifier: Apache-2.0
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  createProtectedMcpExecutor,
  createMemoryProtectedMcpPermitStore,
  runGatedAction,
} from '../src/index.js'
import {
  base64urlEncode,
  getPublicKey,
  createJsonCommitment,
  EVIDENCE_TYPES,
  DECLARED_METHOD,
  HOST_CAPTURE_METHOD,
  signRecord,
  commitEvidenceBody,
} from '@atrib/mcp'
import { verifyEvidenceSet, hostCaptureSourceVerifier } from '@atrib/verify'
const dirs: string[] = []
afterEach(async () => {
  await Promise.all(dirs.map((path) => rm(path, { recursive: true, force: true })))
})
async function setup() {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'atrib-strict-host-')))
  dirs.push(dir)
  const mirrorPath = join(dir, 'mirror.jsonl')
  const request = { name: 'write', arguments: { text: 'before' } }
  const action = { run_id: 'run', action_id: 'action', agent_id: 'host' }
  const source = { namespace: 'urn:host:', id: 'fixture' }
  const strictEvidence = {
    mirrorPath,
    source,
    authoritySnapshot: {
      version: 'fixture:1',
      revoked: false,
      not_before: 0,
      expires_at: Number.MAX_SAFE_INTEGER,
    },
    identify: () => ({
      subject: { namespace: 'urn:action:', id: 'action' },
      execution: { namespace: 'urn:run:', id: 'run' },
      native_invocation: { namespace: 'urn:invoke:', id: 'invocation' },
      delivery: { namespace: 'urn:delivery:', id: 'delivery' },
    }),
    describe: (request: typeof request) => ({
      service: 'urn:mcp:',
      operation: request.name,
      resource: { namespace: 'urn:file:', id: 'fixture' },
      parameters: request.arguments,
    }),
  }
  return { dir, mirrorPath, request, action, strictEvidence }
}
describe('strict evidence on the existing protected MCP host', () => {
  it('rejects strictEvidence on the legacy generic API before evaluation or execution', async () => {
    let calls = 0
    await expect(
      Reflect.apply(runGatedAction, undefined, [
        {
          privateKey: new Uint8Array(32).fill(23),
          contextId: 'a'.repeat(32),
          action: {
            run_id: 'run',
            action_id: 'action',
            agent_id: 'agent',
            surface: 'mcp',
            tool_name: 'write',
          },
          strictEvidence: {},
          evaluate: () => {
            calls++
            return { outcome: 'allow', policy_id: 'fixture', policy_version: '1' }
          },
          execute: () => {
            calls++
            return 'unreachable'
          },
        },
      ]),
    ).rejects.toThrow(/createProtectedMcpExecutor/)
    expect(calls).toBe(0)
  })
  it('uses a pre-pinned stable authority document with a live clock', async () => {
    const f = await setup()
    const key = new Uint8Array(32).fill(23)
    const signer = base64urlEncode(await getPublicKey(key))
    const start = Date.now()
    const authoritySnapshot = {
      version: 'fixture:1',
      revoked: false,
      not_before: start - 1000,
      expires_at: start + 60_000,
    }
    const authorityHash = createJsonCommitment(authoritySnapshot, 'plain-sha256').hash
    const policy = {
      id: 'pre-pinned-live-clock',
      required: ['source', 'binding', 'authority'],
      rules: ['request', 'authorization', 'observation'].map((kind) => ({
        type: EVIDENCE_TYPES[kind],
        signer_keys: [signer],
        source_keys: [signer],
        source: f.strictEvidence.source,
        methods: [kind === 'observation' ? HOST_CAPTURE_METHOD : DECLARED_METHOD],
        subject_namespace: 'urn:action:',
        max_age_ms: 60_000,
        authority_versions: ['fixture:1'],
        authorized_descriptors: [f.strictEvidence.describe(f.request)],
        authority_basis: [authorityHash],
      })),
    }
    const policyPath = join(f.dir, 'pre-pinned-policy.json')
    await writeFile(policyPath, JSON.stringify(policy))
    const executor = createProtectedMcpExecutor({
      privateKey: key,
      contextId: 'a'.repeat(32),
      strictEvidence: { ...f.strictEvidence, authoritySnapshot },
      evaluate: () => ({ outcome: 'allow', policy_id: 'fixture', policy_version: '1' }),
      executeUpstream: () => 'response',
    })
    const result = await executor.authorizeAndExecute({ action: f.action, request: f.request })
    const units = [result.request, result.authorization, ...result.observations]
    const verified = await verifyEvidenceSet({
      records: units.map((unit) => unit.record),
      openings: new Map(units.map((unit) => [unit.record_hash, unit.opening])),
      artifacts: new Map(
        units.flatMap((unit) => unit.artifacts.map((artifact) => [artifact.hash, artifact.bytes])),
      ),
      policy: JSON.parse(await readFile(policyPath, 'utf8')),
      evaluation: {
        purpose: 'historical',
        evaluated_at: Date.now(),
        dispatch_record: result.observations[0].record_hash,
      },
      requestHash: result.request.record_hash,
      sourceVerifiers: { [HOST_CAPTURE_METHOD]: hostCaptureSourceVerifier },
    })
    expect(verified.request.dimensions.authority.state).toBe('supported')
    expect(result.authorization.opening.basis[0].hash).toBe(authorityHash)
  })
  it('refuses evaluator errors without manufacturing a deny authorization', async () => {
    const f = await setup()
    let evaluations = 0
    const options = {
      privateKey: new Uint8Array(32).fill(23),
      contextId: 'a'.repeat(32),
      strictEvidence: f.strictEvidence,
      evaluate: () => {
        evaluations++
        throw new Error('policy database offline')
      },
      executeUpstream: () => {
        throw new Error('unreachable')
      },
    }
    const result = await createProtectedMcpExecutor(options).authorizeAndExecute({
      action: f.action,
      request: f.request,
    })
    expect(result.status).toBe('refused')
    expect(result.gaps).toContain('policy_invalid')
    expect(result.authorization).toBeUndefined()
    const retained = (await readFile(f.mirrorPath, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
    expect(retained).toHaveLength(2)
    expect(retained[1].record.event_type).toBe(EVIDENCE_TYPES.report)
    expect(retained[1]._local.evidence.opening.source.kind).toBe('declared')
    const replay = await createProtectedMcpExecutor(options).authorizeAndExecute({
      action: f.action,
      request: f.request,
    })
    expect(replay.status).toBe('refused')
    expect(replay.replayed).toBe(true)
    expect(replay.gaps).toContain('policy_invalid')
    expect(evaluations).toBe(1)
  })
  it('does not retry an in-flight reservation that has not retained authorization', async () => {
    const f = await setup()
    let entered!: () => void
    const started = new Promise<void>((resolve) => {
      entered = resolve
    })
    let release!: () => void
    const pending = new Promise<void>((resolve) => {
      release = resolve
    })
    let calls = 0
    const options = {
      privateKey: new Uint8Array(32).fill(23),
      contextId: 'a'.repeat(32),
      strictEvidence: f.strictEvidence,
      evaluate: async () => {
        entered()
        await pending
        return { outcome: 'allow' as const, policy_id: 'fixture', policy_version: '1' }
      },
      executeUpstream: () => {
        calls++
        return 'response'
      },
    }
    const first = createProtectedMcpExecutor(options).authorizeAndExecute({
      action: f.action,
      request: f.request,
    })
    await started
    try {
      const replay = await createProtectedMcpExecutor(options).authorizeAndExecute({
        action: f.action,
        request: f.request,
      })
      expect(replay.status).toBe('unknown')
      expect(replay.gaps).toContain('execution_already_reserved')
      expect(calls).toBe(0)
    } finally {
      release()
    }
    expect((await first).status).toBe('success')
    expect(calls).toBe(1)
  })
  it.each(['signer', 'target', 'subject', 'source', 'context'] as const)(
    'ignores a policy failure Report from a different %s',
    async (changed) => {
      const f = await setup()
      const options = {
        privateKey: new Uint8Array(32).fill(23),
        contextId: 'a'.repeat(32),
        strictEvidence: f.strictEvidence,
        evaluate: () => {
          throw new Error('offline')
        },
        executeUpstream: () => {
          throw new Error('unreachable')
        },
      }
      await createProtectedMcpExecutor(options).authorizeAndExecute({
        action: f.action,
        request: f.request,
      })
      const retained = (await readFile(f.mirrorPath, 'utf8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line))
      const report = retained[1]
      const opening = report._local.evidence.opening
      if (changed === 'target') opening.target.record_hash = `sha256:${'0'.repeat(64)}`
      if (changed === 'subject') opening.subject.id = 'different'
      if (changed === 'source') opening.source.identity.id = 'different'
      if (changed === 'context') report.record.context_id = 'b'.repeat(32)
      const key = new Uint8Array(32).fill(changed === 'signer' ? 24 : 23)
      report.record = await signRecord(
        {
          ...report.record,
          creator_key: base64urlEncode(await getPublicKey(key)),
          args_hash: commitEvidenceBody('report', opening),
        },
        key,
      )
      await writeFile(
        f.mirrorPath,
        retained.map((entry) => JSON.stringify(entry)).join('\n') + '\n',
      )
      const replay = await createProtectedMcpExecutor(options).authorizeAndExecute({
        action: f.action,
        request: f.request,
      })
      expect(replay.status).toBe('unknown')
      expect(replay.gaps).toContain('execution_already_reserved')
      expect(replay.gaps).not.toContain('policy_invalid')
    },
  )
  it('exposes bounded lock contention separately from retention corruption', async () => {
    const f = await setup()
    await writeFile(`${f.mirrorPath}.lock`, '', { mode: 0o600 })
    let calls = 0
    const options = {
      privateKey: new Uint8Array(32).fill(23),
      contextId: 'a'.repeat(32),
      strictEvidence: f.strictEvidence,
      evaluate: () => ({ outcome: 'allow' as const, policy_id: 'fixture', policy_version: '1' }),
      executeUpstream: () => {
        calls++
        return 'response'
      },
    }
    const busy = await createProtectedMcpExecutor(options).authorizeAndExecute({
      action: f.action,
      request: f.request,
    })
    expect(busy.status).toBe('refused')
    expect(busy.gaps).toContain('lock_busy')
    expect(busy.gaps).not.toContain('request_retention_failed')
    expect(calls).toBe(0)
    await rm(`${f.mirrorPath}.lock`)
    expect(
      (
        await createProtectedMcpExecutor(options).authorizeAndExecute({
          action: f.action,
          request: f.request,
        })
      ).status,
    ).toBe('success')
    expect(calls).toBe(1)
  })
  it('exposes lock contention after the effect without claiming the response was retained', async () => {
    const f = await setup()
    let calls = 0
    const executor = createProtectedMcpExecutor({
      privateKey: new Uint8Array(32).fill(23),
      contextId: 'a'.repeat(32),
      strictEvidence: f.strictEvidence,
      evaluate: () => ({ outcome: 'allow', policy_id: 'fixture', policy_version: '1' }),
      executeUpstream: async () => {
        calls++
        await vi.waitFor(async () => {
          expect((await readFile(f.mirrorPath, 'utf8')).trim().split('\n')).toHaveLength(3)
        })
        await writeFile(`${f.mirrorPath}.lock`, '', { mode: 0o600 })
        return 'response'
      },
    })
    const first = await executor.authorizeAndExecute({ action: f.action, request: f.request })
    expect(first.status).toBe('success')
    expect(first.gaps).toContain('lock_busy')
    expect(first.gaps).not.toContain('response_retention_failed')
    expect(first.observations).toHaveLength(1)
    await rm(`${f.mirrorPath}.lock`)
    const replay = await executor.authorizeAndExecute({ action: f.action, request: f.request })
    expect(replay.status).toBe('unknown')
    expect(calls).toBe(1)
  })
  it.each(['dispatch', 'response'] as const)(
    'reports an oversized native %s capture artifact',
    async (phase) => {
      const f = await setup()
      let calls = 0
      const executor = createProtectedMcpExecutor({
        privateKey: new Uint8Array(32).fill(23),
        contextId: 'a'.repeat(32),
        strictEvidence: {
          ...f.strictEvidence,
          capture: {
            method: HOST_CAPTURE_METHOD,
            nativeEvent: (observed) =>
              observed === phase ? { data: 'x'.repeat(1_048_576) } : undefined,
          },
        },
        evaluate: () => ({ outcome: 'allow', policy_id: 'fixture', policy_version: '1' }),
        executeUpstream: () => {
          calls++
          return 'response'
        },
      })
      const result = await executor.authorizeAndExecute({ action: f.action, request: f.request })
      expect(result.status).toBe(phase === 'dispatch' ? 'refused' : 'success')
      expect(result.gaps).toContain('capture_artifact_resource_limit')
      expect(result.observations).toHaveLength(phase === 'dispatch' ? 0 : 1)
      expect(calls).toBe(phase === 'dispatch' ? 0 : 1)
    },
  )
  it.each(['block', 'escalate'] as const)(
    'replays retained %s without reevaluation or execution',
    async (outcome) => {
      const f = await setup()
      let evaluations = 0
      let calls = 0
      const executor = createProtectedMcpExecutor({
        privateKey: new Uint8Array(32).fill(23),
        contextId: 'a'.repeat(32),
        strictEvidence: f.strictEvidence,
        evaluate: () => {
          evaluations++
          return { outcome, policy_id: 'fixture', policy_version: '1' }
        },
        executeUpstream: () => {
          calls++
          return 'unreachable'
        },
      })
      const first = await executor.authorizeAndExecute({ action: f.action, request: f.request })
      const replay = await executor.authorizeAndExecute({ action: f.action, request: f.request })
      expect(first.status).toBe('refused')
      expect(replay.status).toBe('refused')
      expect(replay.replayed).toBe(true)
      expect(replay.authorization.record_hash).toBe(first.authorization.record_hash)
      expect(evaluations).toBe(1)
      expect(calls).toBe(0)
    },
  )
  it('inherits the retained context tail for a second request', async () => {
    const f = await setup()
    const executor = createProtectedMcpExecutor({
      privateKey: new Uint8Array(32).fill(23),
      contextId: 'a'.repeat(32),
      strictEvidence: {
        ...f.strictEvidence,
        identify: (action) => ({
          ...f.strictEvidence.identify(),
          subject: { namespace: 'urn:action:', id: action.action_id },
        }),
      },
      evaluate: () => ({ outcome: 'allow', policy_id: 'fixture', policy_version: '1' }),
      executeUpstream: () => 'response',
    })
    const first = await executor.authorizeAndExecute({ action: f.action, request: f.request })
    const second = await executor.authorizeAndExecute({
      action: { ...f.action, action_id: 'second' },
      request: f.request,
    })
    expect(second.request.record.chain_root).toBe(first.observations.at(-1).record_hash)
  })
  it.each(['oversized', 'non-json'] as const)(
    'keeps observed success with bounded %s response capture',
    async (kind) => {
      const f = await setup()
      const value = kind === 'oversized' ? 'x'.repeat(2 * 1024 * 1024) : new Map([['answer', 42]])
      const executor = createProtectedMcpExecutor({
        privateKey: new Uint8Array(32).fill(23),
        contextId: 'a'.repeat(32),
        strictEvidence: f.strictEvidence,
        evaluate: () => ({ outcome: 'allow', policy_id: 'fixture', policy_version: '1' }),
        executeUpstream: () => value,
      })
      const result = await executor.authorizeAndExecute({ action: f.action, request: f.request })
      expect(result.status).toBe('success')
      expect(result.result).toBe(value)
      expect(result.gaps).toContain('response_payload_omitted')
      const response = result.observations.find(
        (unit) => unit.opening.assertion.phase === 'response',
      )
      expect(response.artifacts[0].bytes.length).toBeLessThan(1_048_576)
      const payload = response.artifacts.find((artifact) =>
        response.opening.basis.some(
          (ref) => ref.relation === 'captured' && ref.hash === artifact.hash,
        ),
      )
      const capture = JSON.parse(new TextDecoder().decode(payload.bytes))
      expect(capture.omitted).toBe(true)
      if (kind === 'oversized')
        expect(capture.hash).toBe(createJsonCommitment(value, 'plain-sha256').hash)
      const verified = await hostCaptureSourceVerifier.verify({
        record: response.record,
        body: response.opening,
        artifacts: new Map(response.artifacts.map((artifact) => [artifact.hash, artifact.bytes])),
        sourceKeys: [response.record.creator_key],
        evaluatedAt: Date.now(),
      })
      expect(verified.state).toBe('supported')
    },
  )
  it.each(['delete', 'replace', 'nested'] as const)(
    'pins strict mode and configuration after construction: %s',
    async (mutation) => {
      const f = await setup()
      let originalCalls = 0
      let changedCalls = 0
      const options = {
        privateKey: new Uint8Array(32).fill(23),
        contextId: 'a'.repeat(32),
        strictEvidence: f.strictEvidence,
        evaluate: () => ({ outcome: 'allow' as const, policy_id: 'fixture', policy_version: '1' }),
        executeUpstream: () => {
          originalCalls++
          return 'original'
        },
      }
      const executor = createProtectedMcpExecutor(options)
      if (mutation === 'delete') Reflect.deleteProperty(options, 'strictEvidence')
      else if (mutation === 'replace')
        options.strictEvidence = { ...f.strictEvidence, mirrorPath: join(f.dir, 'changed.jsonl') }
      else {
        options.strictEvidence.mirrorPath = join(f.dir, 'changed.jsonl')
        options.strictEvidence.source.id = 'changed'
      }
      options.executeUpstream = () => {
        changedCalls++
        return 'changed'
      }
      const result = await executor.authorizeAndExecute({ action: f.action, request: f.request })
      expect(result.status).toBe('success')
      expect(result.result).toBe('original')
      expect(result.request.opening.source.identity.id).toBe('fixture')
      expect((await readFile(f.mirrorPath, 'utf8')).trim().split('\n')).toHaveLength(4)
      expect(originalCalls).toBe(1)
      expect(changedCalls).toBe(0)
    },
  )
  it('pins selected strict executor inputs before its first asynchronous operation', async () => {
    const f = await setup()
    let originalCalls = 0
    const descriptor = f.strictEvidence.describe(f.request)
    const identity = f.strictEvidence.identify()
    const options = {
      privateKey: new Uint8Array(32).fill(23),
      contextId: 'a'.repeat(32),
      strictEvidence: {
        mirrorPath: f.mirrorPath,
        authoritySnapshot: f.strictEvidence.authoritySnapshot,
        source: f.strictEvidence.source,
        identify: () => identity,
        describe: () => ({ ...descriptor, parameters: { text: 'before' } }),
      },
      evaluate: () => ({
        outcome: 'allow' as 'allow' | 'block',
        policy_id: 'fixture',
        policy_version: '1',
      }),
      executeUpstream: () => {
        originalCalls++
        return 'original'
      },
    }
    const pending = createProtectedMcpExecutor(options).authorizeAndExecute({
      action: f.action,
      request: f.request,
    })
    options.contextId = 'b'.repeat(32)
    options.strictEvidence.source.id = 'changed'
    identity.subject.id = 'changed'
    f.request.arguments.text = 'changed'
    options.evaluate = () => ({ outcome: 'block', policy_id: 'changed', policy_version: '2' })
    options.executeUpstream = () => 'changed'
    const result = await pending
    expect(result.status).toBe('success')
    expect(result.result).toBe('original')
    expect(result.request.record.context_id).toBe('a'.repeat(32))
    expect(result.request.opening.source.identity.id).toBe('fixture')
    expect(result.request.opening.subject.id).toBe('action')
    expect(originalCalls).toBe(1)
  })
  it('captures the native dispatch frame before execution can mutate host metadata', async () => {
    const f = await setup()
    const frame = {
      event_id: 'invocation',
      position: 1,
      kind: 'mcp.tools.call',
      arguments: { text: 'before' },
    }
    const method = 'https://atrib.dev/evidence/v1/method/runtime-coverage/1'
    const executor = createProtectedMcpExecutor({
      privateKey: new Uint8Array(32).fill(23),
      contextId: 'a'.repeat(32),
      strictEvidence: {
        ...f.strictEvidence,
        capture: { method, nativeEvent: (phase) => (phase === 'dispatch' ? frame : undefined) },
      },
      evaluate: () => ({ outcome: 'allow', policy_id: 'fixture', policy_version: '1' }),
      executeUpstream: () => {
        frame.position = 99
        return 'response'
      },
    })
    const result = await executor.authorizeAndExecute({ action: f.action, request: f.request })
    expect(result.status).toBe('success')
    expect(result.observations[0].opening.source.method).toBe(method)
    const artifact = JSON.parse(new TextDecoder().decode(result.observations[0].artifacts[0].bytes))
    expect(artifact.position).toBe(1)
    expect(result.observations[1].opening.source.method).toBe(
      'https://atrib.dev/evidence/v1/method/host-capture/1',
    )
  })
  it.each(['allow', 'block'] as const)(
    'pins evaluated %s while authorization retention is pending',
    async (initial) => {
      const f = await setup()
      let calls = 0
      const decision = {
        outcome: initial as 'block' | 'allow',
        policy_id: 'fixture',
        policy_version: '1',
      }
      const executor = createProtectedMcpExecutor({
        privateKey: new Uint8Array(32).fill(23),
        contextId: 'a'.repeat(32),
        strictEvidence: f.strictEvidence,
        evaluate: () => {
          setTimeout(() => {
            decision.outcome = initial === 'allow' ? 'block' : 'allow'
            decision.policy_id = 'changed'
            decision.policy_version = '2'
          }, 0)
          return decision
        },
        executeUpstream: () => {
          calls++
          return 'result'
        },
      })
      const result = await executor.authorizeAndExecute({ action: f.action, request: f.request })
      expect(result.status).toBe(initial === 'allow' ? 'success' : 'refused')
      expect(calls).toBe(initial === 'allow' ? 1 : 0)
      expect(result.authorization.opening.assertion.authority_version).toBe('fixture:1')
      expect(result.authorization.opening.assertion.decision).toBe(
        initial === 'allow' ? 'allow' : 'deny',
      )
    },
  )
  it('pins dispatched arguments and durably retains Request and exact Authorization first', async () => {
    const f = await setup()
    let observed: unknown
    const executor = createProtectedMcpExecutor({
      privateKey: new Uint8Array(32).fill(23),
      contextId: 'a'.repeat(32),
      strictEvidence: f.strictEvidence,
      evaluate: async () => {
        f.request.arguments.text = 'mutated'
        return { outcome: 'allow', policy_id: 'fixture', policy_version: '1' }
      },
      executeUpstream: async (request) => {
        observed = request.arguments
        const units = (await readFile(f.mirrorPath, 'utf8'))
          .trim()
          .split('\n')
          .map((line) => JSON.parse(line))
        expect(units.map((unit) => unit.record.event_type)).toEqual([
          'https://atrib.dev/evidence/v1/request',
          'https://atrib.dev/evidence/v1/authorization',
        ])
        expect(units[1]._local.evidence.opening.target.record_hash).toBeDefined()
        return { accepted: true }
      },
    })
    const result = await executor.authorizeAndExecute({ action: f.action, request: f.request })
    expect(result.status).toBe('success')
    expect(observed).toEqual({ text: 'before' })
    expect(result.observations.map((unit) => unit.opening.assertion.phase)).toEqual([
      'dispatch',
      'response',
    ])
    expect(result.observations[0].opening.basis).toContainEqual({
      relation: 'authority',
      kind: 'record',
      hash: result.authorization.record_hash,
    })
    const repeat = await executor.authorizeAndExecute({
      action: f.action,
      request: { name: 'write', arguments: { text: 'before' } },
    })
    expect(repeat.status).toBe('success')
    expect(repeat.replayed).toBe(true)
    expect(repeat.result).toBeUndefined()
    expect(repeat.request.record_hash).toBe(result.request.record_hash)
    const conflict = await executor.authorizeAndExecute({ action: f.action, request: f.request })
    expect(conflict.status).toBe('refused')
    expect(conflict.gaps).toContain('execution_descriptor_conflict')
  })
  it('denies without an effect and never claims a response proves destination state', async () => {
    const f = await setup()
    let calls = 0
    const executor = createProtectedMcpExecutor({
      privateKey: new Uint8Array(32).fill(23),
      contextId: 'a'.repeat(32),
      strictEvidence: f.strictEvidence,
      evaluate: () => ({ outcome: 'block', policy_id: 'fixture', policy_version: '1' }),
      executeUpstream: () => {
        calls++
        return 'effect'
      },
    })
    const result = await executor.authorizeAndExecute({ action: f.action, request: f.request })
    expect(result.status).toBe('refused')
    expect(calls).toBe(0)
    expect(result.observations).toHaveLength(0)
  })
  it('refuses before policy or effect when retention is corrupt', async () => {
    const f = await setup()
    await writeFile(f.mirrorPath, '{', { mode: 0o600 })
    let calls = 0
    const executor = createProtectedMcpExecutor({
      privateKey: new Uint8Array(32).fill(23),
      contextId: 'a'.repeat(32),
      strictEvidence: f.strictEvidence,
      evaluate: () => {
        calls++
        return { outcome: 'allow', policy_id: 'fixture', policy_version: '1' }
      },
      executeUpstream: () => {
        calls++
        return 'effect'
      },
    })
    const result = await executor.authorizeAndExecute({ action: f.action, request: f.request })
    expect(result.status).toBe('refused')
    expect(result.gaps).toContain('request_retention_failed')
    expect(calls).toBe(0)
  })
  it('classifies a throwing dispatch as unknown and refuses restart redispatch', async () => {
    const f = await setup()
    let calls = 0
    const options = {
      privateKey: new Uint8Array(32).fill(23),
      contextId: 'a'.repeat(32),
      strictEvidence: f.strictEvidence,
      evaluate: () => ({ outcome: 'allow' as const, policy_id: 'fixture', policy_version: '1' }),
      executeUpstream: () => {
        calls++
        throw new Error('connection lost after write')
      },
    }
    expect(
      (
        await createProtectedMcpExecutor(options).authorizeAndExecute({
          action: f.action,
          request: f.request,
        })
      ).status,
    ).toBe('unknown')
    expect(
      (
        await createProtectedMcpExecutor(options).authorizeAndExecute({
          action: f.action,
          request: f.request,
        })
      ).status,
    ).toBe('unknown')
    expect(calls).toBe(1)
  })
  it('records no dispatch when authorization retention fails', async () => {
    const f = await setup()
    let calls = 0
    const executor = createProtectedMcpExecutor({
      privateKey: new Uint8Array(32).fill(23),
      contextId: 'a'.repeat(32),
      strictEvidence: f.strictEvidence,
      evaluate: async () => {
        await writeFile(f.mirrorPath, '{', { mode: 0o600 })
        return { outcome: 'allow', policy_id: 'fixture', policy_version: '1' }
      },
      executeUpstream: () => {
        calls++
        return 'unreachable'
      },
    })
    const result = await executor.authorizeAndExecute({ action: f.action, request: f.request })
    expect(result.status).toBe('refused')
    expect(result.gaps).toContain('authorization_retention_failed')
    expect(result.observations).toHaveLength(0)
    expect(calls).toBe(0)
  })
  it('rechecks expiry at the actual boundary after permit storage', async () => {
    const f = await setup()
    let time = 1000
    let calls = 0
    const store = createMemoryProtectedMcpPermitStore()
    const executor = createProtectedMcpExecutor({
      privateKey: new Uint8Array(32).fill(23),
      contextId: 'a'.repeat(32),
      now: () => time,
      strictEvidence: { ...f.strictEvidence, authorizationMaxAgeMs: 10 },
      permitStore: {
        issue: async (permit) => {
          await store.issue(permit)
          time += 11
        },
        consume: store.consume,
      },
      evaluate: () => ({ outcome: 'allow', policy_id: 'fixture', policy_version: '1' }),
      executeUpstream: () => {
        calls++
        return 'unreachable'
      },
    })
    const result = await executor.authorizeAndExecute({ action: f.action, request: f.request })
    expect(result.status).toBe('refused')
    expect(result.observations).toHaveLength(0)
    expect(calls).toBe(0)
  })
  it('refuses descriptor drift during permit storage before the upstream callback', async () => {
    const f = await setup()
    const store = createMemoryProtectedMcpPermitStore()
    let version = '1'
    let calls = 0
    const executor = createProtectedMcpExecutor({
      privateKey: new Uint8Array(32).fill(23),
      contextId: 'a'.repeat(32),
      strictEvidence: {
        ...f.strictEvidence,
        describe: (request) => ({ ...f.strictEvidence.describe(request), version }),
      },
      permitStore: {
        issue: async (permit) => {
          await store.issue(permit)
          version = '2'
        },
        consume: store.consume,
      },
      evaluate: () => ({ outcome: 'allow', policy_id: 'fixture', policy_version: '1' }),
      executeUpstream: () => {
        calls++
        return 'unreachable'
      },
    })
    const result = await executor.authorizeAndExecute({ action: f.action, request: f.request })
    expect(result.status).toBe('refused')
    expect(result.observations).toHaveLength(0)
    expect(calls).toBe(0)
  })
  it('refuses descriptor drift and normalizes before committing arguments', async () => {
    const f = await setup()
    let version = '1'
    let calls = 0
    const executor = createProtectedMcpExecutor({
      privateKey: new Uint8Array(32).fill(23),
      contextId: 'a'.repeat(32),
      strictEvidence: {
        ...f.strictEvidence,
        normalize: (request) => ({ ...request, arguments: { text: 'normalized' } }),
        describe: (request) => ({ ...f.strictEvidence.describe(request), version }),
      },
      evaluate: ({ action }) => {
        expect(action.args).toEqual({ text: 'normalized' })
        version = '2'
        return { outcome: 'allow', policy_id: 'fixture', policy_version: '1' }
      },
      executeUpstream: () => {
        calls++
        return 'unreachable'
      },
    })
    const result = await executor.authorizeAndExecute({ action: f.action, request: f.request })
    expect(result.status).toBe('refused')
    expect(result.gaps).toContain('dispatch_descriptor_mismatch')
    expect(calls).toBe(0)
  })
})
