// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import {
  evaluateAuthority,
  minAuthority,
  type AuthorityLevel,
  type AuthorityPolicy,
  type AuthorityRecord,
} from '../src/index.js'

const SELF = `sha256:${'11'.repeat(32)}`
const PARENT = `sha256:${'22'.repeat(32)}`
const GRANDPARENT = `sha256:${'33'.repeat(32)}`
const OTHER = `sha256:${'44'.repeat(32)}`
const MISSING = `sha256:${'ff'.repeat(32)}`

function record(record_hash: string, informed_by?: string[]): AuthorityRecord {
  return {
    record_hash,
    ...(informed_by !== undefined ? { informed_by } : {}),
  }
}

function policy(
  authorities: ReadonlyMap<string, AuthorityLevel>,
  maxDepth?: number,
): AuthorityPolicy {
  return {
    originAuthority: (candidate) => authorities.get(candidate.record_hash) ?? 'untrusted',
    ...(maxDepth !== undefined ? { maxDepth } : {}),
  }
}

describe('evaluateAuthority', () => {
  it('returns origin authority for a record with no lineage', () => {
    const subject = record(SELF)
    const result = evaluateAuthority(
      subject,
      new Map(),
      policy(new Map([[SELF, 'agent']])),
    )

    expect(result).toEqual({
      authority: 'agent',
      ownAuthority: 'agent',
      loweredByLineage: false,
      limitingRecord: SELF,
      visited: [SELF],
      unresolved: [],
      truncated: false,
    })
  })

  it('blocks summarization laundering by inheriting untrusted authority', () => {
    const source = record(PARENT)
    const subject = record(SELF, [PARENT])
    const result = evaluateAuthority(
      subject,
      new Map([[PARENT, source]]),
      policy(
        new Map([
          [SELF, 'agent'],
          [PARENT, 'untrusted'],
        ]),
      ),
    )

    expect(result.authority).toBe('untrusted')
    expect(result.ownAuthority).toBe('agent')
    expect(result.loweredByLineage).toBe(true)
    expect(result.limitingRecord).toBe(PARENT)
  })

  it('blocks tool-echo laundering even when the tool origin is trusted', () => {
    const source = record(PARENT)
    const subject = record(SELF, [PARENT])
    const result = evaluateAuthority(
      subject,
      new Map([[PARENT, source]]),
      policy(
        new Map([
          [SELF, 'trusted'],
          [PARENT, 'untrusted'],
        ]),
      ),
    )

    expect(result.authority).toBe('untrusted')
    expect(result.loweredByLineage).toBe(true)
    expect(result.limitingRecord).toBe(PARENT)
  })

  it('propagates the minimum authority transitively across three records', () => {
    const source = record(GRANDPARENT)
    const intermediate = record(PARENT, [GRANDPARENT])
    const subject = record(SELF, [PARENT])
    const graph = new Map([
      [PARENT, intermediate],
      [GRANDPARENT, source],
    ])
    const result = evaluateAuthority(
      subject,
      graph,
      policy(
        new Map([
          [SELF, 'trusted'],
          [PARENT, 'agent'],
          [GRANDPARENT, 'untrusted'],
        ]),
      ),
    )

    expect(result.authority).toBe('untrusted')
    expect(result.limitingRecord).toBe(GRANDPARENT)
    expect(result.visited).toEqual([SELF, PARENT, GRANDPARENT])
  })

  it('does not elevate authority when multiple untrusted ancestors corroborate', () => {
    const subject = record(SELF, [PARENT, OTHER])
    const graph = new Map([
      [PARENT, record(PARENT)],
      [OTHER, record(OTHER)],
    ])
    const result = evaluateAuthority(
      subject,
      graph,
      policy(
        new Map([
          [SELF, 'trusted'],
          [PARENT, 'untrusted'],
          [OTHER, 'untrusted'],
        ]),
      ),
    )

    expect(result.authority).toBe('untrusted')
    expect(result.loweredByLineage).toBe(true)
  })

  it('terminates safely when lineage contains a cycle', () => {
    const subject = record(SELF, [PARENT])
    const ancestor = record(PARENT, [SELF])
    const result = evaluateAuthority(
      subject,
      new Map([
        [SELF, subject],
        [PARENT, ancestor],
      ]),
      policy(
        new Map([
          [SELF, 'trusted'],
          [PARENT, 'agent'],
        ]),
      ),
    )

    expect(result.authority).toBe('agent')
    expect(result.visited).toEqual([SELF, PARENT])
    expect(result.truncated).toBe(false)
  })

  it('lowers unresolved lineage to untrusted and reports the missing ref', () => {
    const subject = record(SELF, [MISSING])
    const result = evaluateAuthority(
      subject,
      new Map(),
      policy(new Map([[SELF, 'trusted']])),
    )

    expect(result.authority).toBe('untrusted')
    expect(result.loweredByLineage).toBe(true)
    expect(result.limitingRecord).toBe(MISSING)
    expect(result.unresolved).toEqual([MISSING])
  })

  it('lowers depth-truncated lineage to untrusted and marks truncation', () => {
    const subject = record(SELF, [PARENT])
    const ancestor = record(PARENT, [GRANDPARENT])
    const result = evaluateAuthority(
      subject,
      new Map([
        [PARENT, ancestor],
        [GRANDPARENT, record(GRANDPARENT)],
      ]),
      policy(
        new Map([
          [SELF, 'trusted'],
          [PARENT, 'trusted'],
          [GRANDPARENT, 'trusted'],
        ]),
        1,
      ),
    )

    expect(result.authority).toBe('untrusted')
    expect(result.loweredByLineage).toBe(true)
    expect(result.limitingRecord).toBe(GRANDPARENT)
    expect(result.visited).toEqual([SELF, PARENT])
    expect(result.truncated).toBe(true)
  })

  it('returns byte-identical results for the same inputs', () => {
    const subject = record(SELF, [PARENT])
    const graph = new Map([[PARENT, record(PARENT)]])
    const authorityPolicy = policy(
      new Map([
        [SELF, 'trusted'],
        [PARENT, 'agent'],
      ]),
    )

    const first = evaluateAuthority(subject, graph, authorityPolicy)
    const second = evaluateAuthority(subject, graph, authorityPolicy)

    expect(second).toEqual(first)
    expect(JSON.stringify(second)).toBe(JSON.stringify(first))
  })

  it('keeps a trusted record trusted when all resolved lineage is trusted', () => {
    const subject = record(SELF, [PARENT, OTHER])
    const graph = new Map([
      [PARENT, record(PARENT, [GRANDPARENT])],
      [OTHER, record(OTHER)],
      [GRANDPARENT, record(GRANDPARENT)],
    ])
    const result = evaluateAuthority(
      subject,
      graph,
      policy(
        new Map([
          [SELF, 'trusted'],
          [PARENT, 'trusted'],
          [OTHER, 'trusted'],
          [GRANDPARENT, 'trusted'],
        ]),
      ),
    )

    expect(result.authority).toBe('trusted')
    expect(result.loweredByLineage).toBe(false)
    expect(result.limitingRecord).toBe(SELF)
  })
})

describe('minAuthority', () => {
  it('returns the lower member of the authority lattice', () => {
    expect(minAuthority('trusted', 'agent')).toBe('agent')
    expect(minAuthority('agent', 'untrusted')).toBe('untrusted')
    expect(minAuthority('trusted', 'trusted')).toBe('trusted')
  })
})
