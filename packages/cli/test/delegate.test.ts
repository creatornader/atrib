// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import {
  base64urlDecode,
  base64urlEncode,
  delegationCertErrors,
  getPublicKey,
} from '@atrib/mcp'
import type { DelegationCertificate } from '@atrib/mcp'

const HERE = dirname(fileURLToPath(import.meta.url))
const CLI = resolve(HERE, '../dist/cli.js')
const CONTEXT_ID = '4bf92f3577b34da6a3ce929d0e0e4736'
const NOT_BEFORE = 1_767_225_600_000

interface Run {
  status: number
  stdout: string
  stderr: string
}

function runCli(args: string[]): Run {
  const result = spawnSync('node', [CLI, ...args], { encoding: 'utf-8' })
  return {
    status: result.status ?? -1,
    stdout: result.stdout,
    stderr: result.stderr,
  }
}

function createFixture(scope: Record<string, unknown>): {
  directory: string
  keyFile: string
  principalSeed: Uint8Array
  scopeFile: string
} {
  const directory = mkdtempSync(join(tmpdir(), 'atrib-delegate-test-'))
  const principalSeed = new Uint8Array(32).fill(19)
  const keyFile = join(directory, 'principal.b64')
  const scopeFile = join(directory, 'scope.json')
  writeFileSync(keyFile, base64urlEncode(principalSeed))
  writeFileSync(scopeFile, JSON.stringify(scope))
  return { directory, keyFile, principalSeed, scopeFile }
}

function envValue(stdout: string, name: string): string {
  const prefix = `${name}=`
  const line = stdout.split('\n').find((candidate) => candidate.startsWith(prefix))
  if (!line) throw new Error(`missing ${name} in CLI output`)
  return line.slice(prefix.length)
}

describe('atrib delegate', () => {
  it('issues a scoped §1.11 certificate for a new run key', async () => {
    const fixture = createFixture({
      tool_names: ['search', 'read_file'],
      event_types: ['https://atrib.dev/v1/types/tool_call'],
    })
    try {
      const result = runCli([
        'delegate',
        '--key-file',
        fixture.keyFile,
        '--scope',
        fixture.scopeFile,
        '--ttl',
        '3600',
        '--context',
        CONTEXT_ID,
        '--not-before',
        String(NOT_BEFORE),
      ])

      expect(result.status, result.stderr).toBe(0)
      const runSeed = base64urlDecode(envValue(result.stdout, 'ATRIB_KEY'))
      expect(runSeed).toHaveLength(32)

      const certificateJson = new TextDecoder().decode(
        base64urlDecode(envValue(result.stdout, 'ATRIB_DELEGATION_CERT')),
      )
      const certificate = JSON.parse(certificateJson) as DelegationCertificate
      expect(certificate.cert_type).toBe('atrib/delegation-cert/v1')
      expect(certificate.context_id).toBe(CONTEXT_ID)
      expect(certificate.not_before).toBe(NOT_BEFORE)
      expect(certificate.not_after).toBe(NOT_BEFORE + 3_600_000)
      expect(certificate.scope).toEqual({
        tool_names: ['search', 'read_file'],
        event_types: ['https://atrib.dev/v1/types/tool_call'],
      })
      expect(certificate.run_pubkey).toBe(base64urlEncode(await getPublicKey(runSeed)))
      expect(certificate.principal_key).toBe(
        base64urlEncode(await getPublicKey(fixture.principalSeed)),
      )
      expect(await delegationCertErrors(certificate)).toEqual([])
    } finally {
      rmSync(fixture.directory, { recursive: true, force: true })
    }
  })

  it('requires a non-empty scope', () => {
    const fixture = createFixture({})
    try {
      const result = runCli([
        'delegate',
        '--key-file',
        fixture.keyFile,
        '--scope',
        fixture.scopeFile,
        '--ttl',
        '0',
      ])
      expect(result.status).not.toBe(0)
      expect(result.stderr).toContain('--scope must contain at least one')
    } finally {
      rmSync(fixture.directory, { recursive: true, force: true })
    }
  })

  it('requires a positive TTL', () => {
    const fixture = createFixture({ tool_names: ['search'] })
    try {
      const result = runCli([
        'delegate',
        '--key-file',
        fixture.keyFile,
        '--scope',
        fixture.scopeFile,
        '--ttl',
        '0',
      ])
      expect(result.status).not.toBe(0)
      expect(result.stderr).toContain('--ttl must be an integer greater than or equal to 1')
    } finally {
      rmSync(fixture.directory, { recursive: true, force: true })
    }
  })

  it('rejects unknown scope fields before issuing a key', () => {
    const fixture = createFixture({ tool_names: ['search'], surprise: true })
    try {
      const result = runCli([
        'delegate',
        '--key-file',
        fixture.keyFile,
        '--scope',
        fixture.scopeFile,
        '--ttl',
        '300',
      ])
      expect(result.status).not.toBe(0)
      expect(result.stderr).toContain('--scope contains unknown field(s): surprise')
    } finally {
      rmSync(fixture.directory, { recursive: true, force: true })
    }
  })
})
