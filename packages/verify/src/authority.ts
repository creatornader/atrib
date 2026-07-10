// SPDX-License-Identifier: Apache-2.0

/** Ordered authority lattice. Lower ordinal is less authority. */
export type AuthorityLevel = 'untrusted' | 'agent' | 'trusted'

export interface AuthorityPolicy {
  /** Authority granted to a record based on its own signer/origin. Called for each record. */
  originAuthority: (record: AuthorityRecord) => AuthorityLevel
  /** Max lineage hops to walk. Default 16. Guards against pathological graphs. */
  maxDepth?: number
}

/** The minimal shape this module needs. */
export interface AuthorityRecord {
  record_hash: string
  informed_by?: string[]
}

export interface AuthorityResult {
  /** Effective authority after non-malleable propagation. */
  authority: AuthorityLevel
  /** Authority this record would have had from its own origin alone. */
  ownAuthority: AuthorityLevel
  /** True when lineage lowered the authority below ownAuthority. */
  loweredByLineage: boolean
  /** record_hash of the least-authoritative ancestor that set the result. Self if none lower. */
  limitingRecord: string
  /** Hashes walked, in visit order. Useful for explaining a verdict. */
  visited: string[]
  /** informed_by refs that could not be resolved in the supplied graph. */
  unresolved: string[]
  /** True when maxDepth stopped the walk before exhausting lineage. */
  truncated: boolean
}

const AUTHORITY_ORDINAL: Readonly<Record<AuthorityLevel, number>> = {
  untrusted: 0,
  agent: 1,
  trusted: 2,
}

export function minAuthority(a: AuthorityLevel, b: AuthorityLevel): AuthorityLevel {
  return AUTHORITY_ORDINAL[a] <= AUTHORITY_ORDINAL[b] ? a : b
}

interface QueueEntry {
  record: AuthorityRecord
  depth: number
}

export function evaluateAuthority(
  record: AuthorityRecord,
  graph: ReadonlyMap<string, AuthorityRecord>,
  policy: AuthorityPolicy,
): AuthorityResult {
  const ownAuthority = policy.originAuthority(record)
  const maxDepth = policy.maxDepth ?? 16
  const queue: QueueEntry[] = [{ record, depth: 0 }]
  const seen = new Set<string>([record.record_hash])
  const visited: string[] = []
  const unresolved: string[] = []

  let authority = ownAuthority
  let limitingRecord = record.record_hash
  let limitingDepth = 0
  let truncated = false

  const considerLimit = (level: AuthorityLevel, hash: string, depth: number): void => {
    const nextAuthority = minAuthority(authority, level)
    if (nextAuthority !== authority) {
      authority = nextAuthority
      limitingRecord = hash
      limitingDepth = depth
      return
    }

    // Self remains limiting whenever its own authority is already the minimum.
    if (
      level === authority &&
      ownAuthority !== authority &&
      depth > limitingDepth
    ) {
      limitingRecord = hash
      limitingDepth = depth
    }
  }

  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index]!
    visited.push(current.record.record_hash)

    if (current.depth > 0) {
      considerLimit(
        policy.originAuthority(current.record),
        current.record.record_hash,
        current.depth,
      )
    }

    for (const ancestorHash of current.record.informed_by ?? []) {
      if (seen.has(ancestorHash)) continue
      seen.add(ancestorHash)

      const ancestorDepth = current.depth + 1
      if (current.depth >= maxDepth) {
        truncated = true
        considerLimit('untrusted', ancestorHash, ancestorDepth)
        continue
      }

      const ancestor = graph.get(ancestorHash)
      if (ancestor === undefined) {
        unresolved.push(ancestorHash)
        considerLimit('untrusted', ancestorHash, ancestorDepth)
        continue
      }

      queue.push({ record: ancestor, depth: ancestorDepth })
    }
  }

  return {
    authority,
    ownAuthority,
    loweredByLineage: AUTHORITY_ORDINAL[authority] < AUTHORITY_ORDINAL[ownAuthority],
    limitingRecord,
    visited,
    unresolved,
    truncated,
  }
}
