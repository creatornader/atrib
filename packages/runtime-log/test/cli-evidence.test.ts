// SPDX-License-Identifier: Apache-2.0
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { runRuntimeLogCli } from '../src/cli.js'
import { hashCanonical } from '../src/index.js'
import {
  base64urlEncode,
  getPublicKey,
  signRecord,
  genesisChainRoot,
  commitEvidenceBody,
  createEvidenceNonce,
  DECLARED_METHOD,
  EVIDENCE_TYPES,
  type EvidenceBody,
} from '@atrib/mcp'

const hash = `sha256:${'a'.repeat(64)}`
async function inspect(text: string, extra: string[] = []) {
  const dir = await mkdtemp(join(tmpdir(), 'atrib-inspect-'))
  const mirror = join(dir, 'mirror.jsonl')
  const policy = join(dir, 'policy.json')
  await writeFile(mirror, text)
  await writeFile(policy, JSON.stringify({ id: 'local', rules: [], required: ['source'] }))
  let stdout = ''
  let stderr = ''
  const code = await runRuntimeLogCli(
    [
      'inspect',
      '--mirror',
      mirror,
      '--policy',
      policy,
      '--request',
      hash,
      '--dispatch',
      hash,
      '--evaluated-at',
      '1000',
      ...extra,
    ],
    {
      stdout: (text) => {
        stdout += text
      },
      stderr: (text) => {
        stderr += text
      },
    },
  )
  return { code, stdout, stderr }
}

describe('retained evidence CLI', () => {
  it.each(['authorization', 'effect', 'coverage'] as const)(
    'lists an unopened %s record without inferring a request relationship',
    async (kind) => {
      const record = { event_type: EVIDENCE_TYPES[kind] }
      const recordHash = hashCanonical(record)
      const text = JSON.stringify({ record }) + '\n'
      const result = await inspect(text)
      expect(result.code).toBe(1)
      const diagnostic = `Unattributed ${kind} ${recordHash}: opening unavailable; no request relationship inferred.`
      expect(JSON.parse(result.stdout).gaps).toContain(diagnostic)
      const human = await inspect(text, ['--format', 'text'])
      expect(human.stdout).toContain(diagnostic)
    },
  )

  it('replaces terminal control characters in displayed claims while preserving Unicode', async () => {
    const codes = [
      ...Array.from({ length: 32 }, (_, i) => i),
      ...Array.from({ length: 33 }, (_, i) => i + 127),
    ]
    const injected = `begin${String.fromCharCode(...codes)}end😀`
    const expected = `begin${' '.repeat(codes.length)}end😀`
    const record = { event_type: EVIDENCE_TYPES.request, creator_key: injected }
    const result = await inspect(
      JSON.stringify({
        record,
        _local: {
          evidence: {
            opening: { assertion: { descriptor: { service: injected, operation: 'write' } } },
          },
        },
      }) + '\n',
      ['--request', hashCanonical(record), '--format', 'text'],
    )
    expect(result.code).toBe(1)
    expect(result.stdout).toContain(`Requested: ${expected} write.`)
    expect(result.stdout).toContain(`Request signer: ${expected}.`)
    for (const code of codes.filter((code) => code !== 10))
      expect(result.stdout).not.toContain(String.fromCharCode(code))
  })

  it('rejects a torn last mirror line without skipping it', async () => {
    const result = await inspect('{"record":{}}')
    expect(result.code).toBe(2)
    expect(result.stderr).toContain('truncated')
  })
  it('reports missing selected evidence as a failed partial inspection', async () => {
    const result = await inspect('')
    expect(result.code).toBe(1)
    const output = JSON.parse(result.stdout)
    expect(output.accepted).toBe(false)
    expect(output.inspections).toHaveLength(1)
    expect(output.inspections[0].verification.request).toBeNull()
  })
  it('rejects corrupt entries instead of accepting a later valid subset', async () => {
    const result = await inspect('{"record":{}}\ninvalid\n')
    expect(result.code).toBe(2)
    expect(result.stderr).toContain('line 2')
  })
  it('requires receiver policy and explicit evaluation time', async () => {
    let stderr = ''
    const code = await runRuntimeLogCli(['inspect', '--mirror', '/unused'], {
      stderr: (text) => {
        stderr += text
      },
    })
    expect(code).toBe(2)
    expect(stderr).toContain('--policy is required')
  })
  it('preserves a missing opening as unresolved and rejects a changed opening', async () => {
    const key = new Uint8Array(32).fill(9)
    const body: EvidenceBody = {
      nonce: createEvidenceNonce(),
      subject: { namespace: 'urn:request', id: 'request' },
      basis: [],
      source: {
        kind: 'declared',
        identity: { namespace: 'urn:host', id: 'host' },
        method: DECLARED_METHOD,
      },
      assertion: {
        descriptor: {
          service: 'urn:service',
          operation: 'write',
          resource: { namespace: 'urn:resource', id: 'local' },
          parameters: {},
        },
        execution: { namespace: 'urn:execution', id: 'execution' },
      },
    }
    const context = 'a'.repeat(32)
    const record = await signRecord(
      {
        spec_version: 'atrib/1.0',
        creator_key: base64urlEncode(await getPublicKey(key)),
        chain_root: genesisChainRoot(context),
        context_id: context,
        timestamp: 1000,
        event_type: EVIDENCE_TYPES.request,
        args_hash: commitEvidenceBody('request', body),
        signature: '',
      },
      key,
    )
    const recordHash = hashCanonical(record)
    const missing = await inspect(JSON.stringify({ record }) + '\n', ['--request', recordHash])
    expect(missing.code).toBe(1)
    const partial = JSON.parse(missing.stdout)
    expect(partial.gaps).toContain(`Missing opening for ${recordHash}.`)
    const statement = partial.inspections[0].verification.statements[0]
    expect(statement.dimensions.integrity.body.state).toBe('unresolved')

    const changed = { ...body, nonce: createEvidenceNonce() }
    const tampered = await inspect(
      JSON.stringify({ record, _local: { evidence: { opening: changed, artifacts: [] } } }) + '\n',
      ['--request', recordHash],
    )
    expect(tampered.code).toBe(1)
    expect(
      JSON.parse(tampered.stdout).inspections[0].verification.statements[0].dimensions.integrity
        .body.state,
    ).toBe('rejected')
  })
  it('rejects altered retained bytes even when no statement references them', async () => {
    const result = await inspect(
      JSON.stringify({
        record: {},
        _local: {
          evidence: {
            artifacts: [{ hash, base64: Buffer.from('changed').toString('base64') }],
          },
        },
      }) + '\n',
    )
    expect(result.code).toBe(2)
    expect(result.stderr).toContain('artifact hash mismatch')
  })
})
