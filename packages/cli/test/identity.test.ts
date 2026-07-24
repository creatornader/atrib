// SPDX-License-Identifier: Apache-2.0

import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { verifyClaimSignature } from '@atrib/directory'
import { base64urlDecode, base64urlEncode, delegationCertErrors, getPublicKey } from '@atrib/mcp'
import type { DelegationCertificate } from '@atrib/mcp'
import {
  createIdentityProfile,
  identityProfileErrors,
  issueIdentityRun,
  loadIdentityProfile,
  saveIdentityProfile,
} from '../src/identity.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const CLI = resolve(HERE, '../dist/cli.js')
const CONTEXT_ID = '4bf92f3577b34da6a3ce929d0e0e4736'

function envValue(stdout: string, name: string): string {
  const prefix = `${name}=`
  const line = stdout.split('\n').find((candidate) => candidate.startsWith(prefix))
  if (!line) throw new Error(`missing ${name} in CLI output`)
  return line.slice(prefix.length)
}

async function runCli(args: string[]): Promise<{
  status: number | null
  stdout: string
  stderr: string
}> {
  return new Promise((resolveRun, reject) => {
    const child = spawn('node', args)
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk
    })
    child.on('error', reject)
    child.on('close', (status) => resolveRun({ status, stdout, stderr }))
  })
}

describe('named identity profile', () => {
  it('binds names and roles in a principal-signed portable claim', async () => {
    const seed = new Uint8Array(32).fill(41)
    const profile = await createIdentityProfile({
      profileName: 'support',
      principalKind: 'organization',
      principalName: 'Example Operations',
      workspaceName: 'Incident Response',
      agentName: 'Triage Agent',
      principalSeed: seed,
      keySource: { kind: 'key-file', path: '/tmp/test-only-key' },
      nowMs: 1_767_225_600_000,
    })

    expect(profile.workspace.id).toMatch(/^atrw_[A-Za-z0-9_-]{22}$/)
    expect(profile.agent.id).toMatch(/^atra_[A-Za-z0-9_-]{22}$/)
    expect(profile.signed_claim.claim_subject).toEqual({
      identity_profile: 'atrib.identity-profile.v1',
      principal: {
        kind: 'organization',
        name: 'Example Operations',
      },
      workspace: {
        id: profile.workspace.id,
        name: 'Incident Response',
      },
      agent: {
        id: profile.agent.id,
        name: 'Triage Agent',
        role: 'agent',
      },
    })
    expect(await verifyClaimSignature(profile.signed_claim)).toBe(true)
    expect(await identityProfileErrors(profile, seed)).toEqual([])
  })

  it('writes no secret to the profile and recovers deterministic ids', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'atrib-identity-profile-'))
    const seed = new Uint8Array(32).fill(42)
    try {
      const input = {
        profileName: 'default',
        principalKind: 'human' as const,
        principalName: 'Nader',
        workspaceName: 'atrib',
        agentName: 'Codex',
        principalSeed: seed,
        keySource: { kind: 'key-file' as const, path: '/tmp/principal.b64' },
        nowMs: 1_767_225_600_000,
      }
      const first = await createIdentityProfile(input)
      const second = await createIdentityProfile({
        ...input,
        nowMs: 1_767_225_700_000,
        createdAtMs: first.created_at_ms,
      })
      expect(second.workspace.id).toBe(first.workspace.id)
      expect(second.agent.id).toBe(first.agent.id)

      const path = join(directory, 'default.json')
      saveIdentityProfile(path, first)
      const serialized = readFileSync(path, 'utf8')
      expect(serialized).not.toContain(base64urlEncode(seed))
      expect(loadIdentityProfile(path)).toEqual(first)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('rejects unsigned outer-label changes around a valid signed claim', async () => {
    const seed = new Uint8Array(32).fill(46)
    const profile = await createIdentityProfile({
      profileName: 'default',
      principalKind: 'human',
      principalName: 'Nader',
      workspaceName: 'atrib',
      agentName: 'Codex',
      principalSeed: seed,
      keySource: { kind: 'key-file', path: '/tmp/principal.b64' },
    })
    const tampered = {
      ...profile,
      agent: { ...profile.agent, name: 'Impostor' },
    }
    expect(await identityProfileErrors(tampered, seed)).toContain('profile_claim_subject_mismatch')
  })

  it('issues a context-bound ephemeral run certificate', async () => {
    const principalSeed = new Uint8Array(32).fill(43)
    const runSeed = new Uint8Array(32).fill(44)
    const profile = await createIdentityProfile({
      profileName: 'default',
      principalKind: 'human',
      principalName: 'Nader',
      workspaceName: 'atrib',
      agentName: 'Codex',
      principalSeed,
      keySource: { kind: 'key-file', path: '/tmp/principal.b64' },
      nowMs: 1_767_225_600_000,
    })
    const run = await issueIdentityRun(profile, principalSeed, {
      contextId: CONTEXT_ID,
      ttlSeconds: 900,
      notBeforeMs: 1_767_225_600_000,
      scope: { tool_names: ['search'] },
      runSeed,
    })

    expect(run.certificate.principal_key).toBe(profile.principal.public_key)
    expect(run.certificate.run_pubkey).toBe(base64urlEncode(await getPublicKey(runSeed)))
    expect(run.certificate.context_id).toBe(CONTEXT_ID)
    expect(run.certificate.scope).toEqual({ tool_names: ['search'] })
    expect(await delegationCertErrors(run.certificate)).toEqual([])
  })
})

describe('atrib identity CLI', () => {
  it('creates and then recovers one named profile while issuing fresh runs', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'atrib-identity-cli-'))
    const profileDirectory = join(directory, 'profiles')
    const keyFile = join(directory, 'principal.b64')
    const scopeFile = join(directory, 'scope.json')
    const principalSeed = new Uint8Array(32).fill(45)
    const submittedRevocations: unknown[] = []
    const logServer = createServer((request, response) => {
      let body = ''
      request.setEncoding('utf8')
      request.on('data', (chunk) => {
        body += chunk
      })
      request.on('end', () => {
        submittedRevocations.push(JSON.parse(body))
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ log_index: 7 }))
      })
    })
    writeFileSync(keyFile, base64urlEncode(principalSeed))
    writeFileSync(scopeFile, JSON.stringify({ tool_names: ['search'] }))

    const args = [
      CLI,
      'identity',
      'init',
      '--profile',
      'support',
      '--profile-dir',
      profileDirectory,
      '--key-file',
      keyFile,
      '--principal',
      'Example Operations',
      '--principal-kind',
      'organization',
      '--workspace',
      'Incident Response',
      '--agent',
      'Triage Agent',
      '--scope',
      scopeFile,
      '--ttl',
      '900',
      '--context',
      CONTEXT_ID,
    ]
    try {
      await new Promise<void>((resolveListen) => {
        logServer.listen(0, '127.0.0.1', resolveListen)
      })
      const address = logServer.address() as AddressInfo
      const logEndpoint = `http://127.0.0.1:${address.port}/v1`
      const first = spawnSync('node', args, { encoding: 'utf8' })
      expect(first.status, first.stderr).toBe(0)
      const profile = loadIdentityProfile(join(profileDirectory, 'support.json'))
      expect(await identityProfileErrors(profile, principalSeed)).toEqual([])
      expect(envValue(first.stdout, 'ATRIB_PRINCIPAL_KEY')).toBe(profile.principal.public_key)
      expect(envValue(first.stdout, 'ATRIB_WORKSPACE_ID')).toBe(profile.workspace.id)
      expect(envValue(first.stdout, 'ATRIB_AGENT_ID')).toBe(profile.agent.id)
      expect(envValue(first.stdout, 'ATRIB_CONTEXT_ID')).toBe(CONTEXT_ID)

      const certificate = JSON.parse(
        new TextDecoder().decode(base64urlDecode(envValue(first.stdout, 'ATRIB_DELEGATION_CERT'))),
      ) as DelegationCertificate
      expect(certificate.principal_key).toBe(profile.principal.public_key)
      expect(certificate.context_id).toBe(CONTEXT_ID)
      expect(certificate.scope).toEqual({ tool_names: ['search'] })

      const firstRunKey = profile.active_run?.run_pubkey
      const second = await runCli([
        CLI,
        'identity',
        'init',
        '--profile',
        'support',
        '--profile-dir',
        profileDirectory,
        '--log',
        logEndpoint,
      ])
      expect(second.status, second.stderr).toBe(0)
      expect(second.stdout).toContain('# principal_key_state: recovered')
      expect(envValue(second.stdout, 'ATRIB_PRINCIPAL_KEY')).toBe(profile.principal.public_key)
      expect(envValue(second.stdout, 'ATRIB_KEY')).not.toBe(envValue(first.stdout, 'ATRIB_KEY'))
      const rotated = loadIdentityProfile(join(profileDirectory, 'support.json'))
      expect(rotated.active_run?.run_pubkey).not.toBe(firstRunKey)
      expect(rotated.revoked_runs).toHaveLength(1)
      expect(rotated.revoked_runs?.[0]).toMatchObject({
        revoked_key: firstRunKey,
        successor_run_pubkey: rotated.active_run?.run_pubkey,
        log_index: 7,
        log_endpoint: logEndpoint,
      })
      expect(submittedRevocations).toHaveLength(1)
      expect(submittedRevocations[0]).toMatchObject({
        creator_key: profile.principal.public_key,
        revoked_key: firstRunKey,
        revocation_reason: 'retirement',
      })
      expect(submittedRevocations[0]).not.toHaveProperty('successor_key')
      expect(envValue(second.stdout, 'ATRIB_REVOKED_KEYS')).toBe(firstRunKey)

      const shown = spawnSync(
        'node',
        [CLI, 'identity', 'show', '--profile', 'support', '--profile-dir', profileDirectory],
        { encoding: 'utf8' },
      )
      expect(shown.status, shown.stderr).toBe(0)
      const status = JSON.parse(shown.stdout) as {
        signed_claim_valid: boolean
        key_source_matches_principal: boolean
        role_chain: string[]
      }
      expect(status.signed_claim_valid).toBe(true)
      expect(status.key_source_matches_principal).toBe(true)
      expect(status.role_chain).toEqual(['principal', 'workspace', 'agent', 'run'])
    } finally {
      await new Promise<void>((resolveClose) => logServer.close(() => resolveClose()))
      rmSync(directory, { recursive: true, force: true })
    }
  }, 15_000)
})
