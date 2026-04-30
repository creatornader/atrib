// T11: tests for new CLI subcommands publish-claim + revoke.
//
// We exercise the dry-run paths so we don't need a live directory or log.
// dry-run prints the signed payload to stdout; the test captures it and
// asserts the structure satisfies §6.1 (claim) or §1.9.1 (revocation).

import { describe, it, expect } from 'vitest'
import { writeFileSync, unlinkSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const CLI = resolve(HERE, '../dist/cli.js')

interface Run {
  status: number
  stdout: string
  stderr: string
}

function runCli(args: string[]): Run {
  const r = spawnSync('node', [CLI, ...args], { encoding: 'utf-8' })
  return { status: r.status ?? -1, stdout: r.stdout, stderr: r.stderr }
}

function makeKeyFile(): string {
  // 32 random bytes → base64url; written to a temp file
  const dir = mkdtempSync(join(tmpdir(), 'atrib-cli-test-'))
  const path = join(dir, 'key.b64')
  // Use a fixed test seed for deterministic testing
  const seed = Buffer.alloc(32)
  for (let i = 0; i < 32; i++) seed[i] = (i + 1) % 256
  writeFileSync(path, seed.toString('base64url'))
  return path
}

describe('atrib publish-claim (T11)', () => {
  it('dry-run prints a well-formed self_attested IdentityClaim', () => {
    const keyFile = makeKeyFile()
    try {
      const r = runCli([
        'publish-claim',
        '--key-file', keyFile,
        '--display-name', 'Test Claim',
        '--organization', 'TestOrg',
        '--dry-run',
      ])
      expect(r.status, r.stderr).toBe(0)
      const claim = JSON.parse(r.stdout) as {
        creator_key: string
        claim_type: string
        claim_method: string
        claim_subject: { display_name: string; organization: string }
        signature: string
      }
      expect(claim.claim_type).toBe('self_attested')
      expect(claim.claim_method).toBe('self')
      expect(claim.claim_subject.display_name).toBe('Test Claim')
      expect(claim.claim_subject.organization).toBe('TestOrg')
      expect(claim.creator_key).toMatch(/^[A-Za-z0-9_-]{43}$/)
      expect(claim.signature.length).toBeGreaterThan(0)
    } finally {
      unlinkSync(keyFile)
    }
  })

  it('rejects when no subject fields supplied', () => {
    const keyFile = makeKeyFile()
    try {
      const r = runCli(['publish-claim', '--key-file', keyFile, '--dry-run'])
      expect(r.status).not.toBe(0)
      expect(r.stderr).toMatch(/at least one of/)
    } finally {
      unlinkSync(keyFile)
    }
  })

  it('builds a capability envelope from CSV options', () => {
    const keyFile = makeKeyFile()
    try {
      const r = runCli([
        'publish-claim',
        '--key-file', keyFile,
        '--display-name', 'Capable Agent',
        '--tool-names', 'ToolA,ToolB,ToolC',
        '--event-types', 'tool_call,observation',
        '--max-amount-currency', 'USD',
        '--max-amount-value', '100',
        '--dry-run',
      ])
      expect(r.status, r.stderr).toBe(0)
      const claim = JSON.parse(r.stdout) as {
        capabilities?: { tool_names?: string[]; event_types?: string[]; max_amount?: { currency: string; value: number } }
      }
      expect(claim.capabilities?.tool_names).toEqual(['ToolA', 'ToolB', 'ToolC'])
      expect(claim.capabilities?.event_types).toEqual(['tool_call', 'observation'])
      expect(claim.capabilities?.max_amount).toEqual({ currency: 'USD', value: 100 })
    } finally {
      unlinkSync(keyFile)
    }
  })
})

describe('atrib revoke (T11)', () => {
  it('dry-run prints a well-formed §1.9.1 key_revocation record', () => {
    const keyFile = makeKeyFile()
    const successor = Buffer.alloc(32, 7).toString('base64url')
    try {
      const r = runCli([
        'revoke',
        '--key-file', keyFile,
        '--reason', 'rotation',
        '--successor', successor,
        '--dry-run',
      ])
      expect(r.status, r.stderr).toBe(0)
      const record = JSON.parse(r.stdout) as {
        spec_version: string
        event_type: string
        creator_key: string
        revoked_key: string
        revocation_reason: string
        successor_key: string
        signature: string
      }
      expect(record.spec_version).toBe('atrib/1.0')
      expect(record.event_type).toBe('https://atrib.dev/v1/types/key_revocation')
      expect(record.revoked_key).toBe(record.creator_key) // self-revocation per §1.9.2 case 1
      expect(record.revocation_reason).toBe('rotation')
      expect(record.successor_key).toBe(successor)
      expect(record.signature.length).toBeGreaterThan(0)
    } finally {
      unlinkSync(keyFile)
    }
  })

  it('rejects rotation without --successor', () => {
    const keyFile = makeKeyFile()
    try {
      const r = runCli([
        'revoke', '--key-file', keyFile, '--reason', 'rotation', '--dry-run',
      ])
      expect(r.status).not.toBe(0)
      expect(r.stderr).toMatch(/successor/)
    } finally {
      unlinkSync(keyFile)
    }
  })

  it('rejects unknown reason', () => {
    const keyFile = makeKeyFile()
    try {
      const r = runCli([
        'revoke', '--key-file', keyFile, '--reason', 'whoops', '--dry-run',
      ])
      expect(r.status).not.toBe(0)
      expect(r.stderr).toMatch(/--reason must be one of/)
    } finally {
      unlinkSync(keyFile)
    }
  })

  it('accepts retirement (no successor)', () => {
    const keyFile = makeKeyFile()
    try {
      const r = runCli([
        'revoke', '--key-file', keyFile, '--reason', 'retirement', '--dry-run',
      ])
      expect(r.status, r.stderr).toBe(0)
      const record = JSON.parse(r.stdout) as { revocation_reason: string; successor_key?: string }
      expect(record.revocation_reason).toBe('retirement')
      expect(record.successor_key).toBeUndefined()
    } finally {
      unlinkSync(keyFile)
    }
  })
})
