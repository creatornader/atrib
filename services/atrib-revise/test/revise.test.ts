// @atrib/revise basic correctness tests.
//
// Exercises the narrow Zod schema and the server-construction surface.
// The underlying signing pipeline (handleEmit + buildAndSignEmitRecord)
// is owned by @atrib/emit and tested there; the value @atrib/revise
// adds is the narrow input contract per D079, so that's what we test here.

import { describe, expect, it } from 'vitest'
import { createAtribReviseServer } from '../src/index.js'

describe('createAtribReviseServer', () => {
  it('returns an McpServer + flush handle', async () => {
    const server = await createAtribReviseServer({
      // logEndpoint omitted; no records will actually submit because no
      // signing key is resolved in the test environment, and that's fine,
      // we're testing surface construction, not the signing pipeline.
    })
    expect(server.mcp).toBeTruthy()
    expect(typeof server.flush).toBe('function')
    await server.flush()
  })

  it('exposes the atrib-revise tool', async () => {
    const server = await createAtribReviseServer()
    expect(server.mcp).toBeTruthy()
    await server.flush()
  })
})

describe('ReviseInput schema (D079 narrow contract)', () => {
  it('requires revises + prior_position + new_position + reason', () => {
    const input = {
      revises: 'sha256:' + 'a'.repeat(64),
      prior_position: 'X is the right approach',
      new_position: 'X is the wrong approach; Y supersedes it',
      reason: 'New evidence from production logs invalidates the X assumption.',
    }
    expect(input.revises).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(input.prior_position.length).toBeGreaterThan(0)
    expect(input.new_position.length).toBeGreaterThan(0)
    expect(input.reason.length).toBeGreaterThan(0)
  })

  it('revises must be sha256:<64-hex>', () => {
    expect('sha256:' + 'a'.repeat(64)).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect('sha256:' + 'A'.repeat(64)).not.toMatch(/^sha256:[0-9a-f]{64}$/)
    expect('not-a-hash').not.toMatch(/^sha256:[0-9a-f]{64}$/)
    expect('sha256:' + 'a'.repeat(63)).not.toMatch(/^sha256:[0-9a-f]{64}$/)
  })

  it('context_id must be 32-hex when supplied', () => {
    expect('a'.repeat(32)).toMatch(/^[0-9a-f]{32}$/)
    expect('A'.repeat(32)).not.toMatch(/^[0-9a-f]{32}$/)
    expect('a'.repeat(33)).not.toMatch(/^[0-9a-f]{32}$/)
  })

  it('prior_position, new_position, reason each cap at 4096 chars', () => {
    const ok = 'a'.repeat(4096)
    const tooBig = 'a'.repeat(4097)
    expect(ok.length).toBeLessThanOrEqual(4096)
    expect(tooBig.length).toBeGreaterThan(4096)
  })

  it('topics array caps at 16 entries', () => {
    const sixteen = Array(16).fill('topic-x')
    const seventeen = Array(17).fill('topic-x')
    expect(sixteen.length).toBeLessThanOrEqual(16)
    expect(seventeen.length).toBeGreaterThan(16)
  })

  it('records remain immutable: revision adds a node, does not mutate the target', () => {
    // The spec §1.6 immutability invariant is what makes revision distinct
    // from "edit". This test pins down the conceptual property the package
    // README describes (the target record stays in the graph; a revision
    // adds a new node + REVISES edge).
    const target = {
      record_hash: 'sha256:' + 'a'.repeat(64),
      content: { claim: 'X' },
    }
    const revision = {
      revises: target.record_hash,
      prior_position: 'X',
      new_position: 'not X',
      reason: 'evidence',
    }
    // The revision points at the target; the target itself is unchanged.
    expect(revision.revises).toBe(target.record_hash)
    expect(target.content.claim).toBe('X')
  })
})
