// SPDX-License-Identifier: Apache-2.0

/**
 * Deterministic current-state projection over signed revision lineages.
 *
 * This is a read model over existing observation and revision records. It
 * adds no event type and changes no signed bytes. A view accepts records
 * whose signatures verify and whose signer and context satisfy the caller's
 * policy. Forks remain forks: the projector returns every active head and
 * never invents a winner.
 */

import { verifyRecord } from '@atrib/mcp'
import { revisionTarget, type LoadedRecord } from './aggregations.js'

const REVISION_EVENT_TYPE = 'https://atrib.dev/v1/types/revision'
const RECORD_HASH_PATTERN = /^sha256:[0-9a-f]{64}$/
const DEFAULT_CELL_LIMIT = 100
const MAX_CELL_LIMIT = 1_000
const DEFAULT_HEAD_LIMIT = 100
const MAX_HEAD_LIMIT = 1_000
const MAX_EXCLUSION_DETAILS = 1_000

export interface StateProjectionOptions {
  root_record_hashes?: string[]
  trusted_creator_keys?: string[]
  allowed_context_ids?: string[]
  include_content?: boolean
  limit?: number
  head_limit?: number
}

export type StateExclusionReason =
  | 'signature_invalid'
  | 'creator_not_trusted'
  | 'context_not_allowed'
  | 'target_missing'
  | 'target_not_accepted'

export interface StateRecordView {
  record_hash: string
  creator_key: string
  context_id: string
  event_type: string
  timestamp: number
  content_available: boolean
  content?: unknown
}

export interface StateCell {
  root: StateRecordView
  status: 'resolved' | 'conflict'
  active_heads: StateRecordView[]
  total_active_heads: number
  active_heads_truncated: boolean
  revision_count: number
  excluded_revision_count: number
}

export interface StateExcludedRevision {
  record_hash: string
  target_record_hash?: string
  reason: StateExclusionReason
}

export interface StateProjection {
  schema: 'atrib.state-projection.v1'
  acceptance_basis: {
    signature_verification: 'local_ed25519'
    creator_policy: 'caller_trust_set' | 'all_verified_local_signers'
    context_policy: 'caller_allowlist' | 'all_contexts'
    log_inclusion_verified: false
  }
  warnings: string[]
  total_cells: number
  returned_cells: number
  truncated: boolean
  conflict_count: number
  unresolved_root_hashes: string[]
  total_excluded_revisions: number
  excluded_revisions_truncated: boolean
  excluded_revisions: StateExcludedRevision[]
  cells: StateCell[]
}

function boundedLimit(
  value: number | undefined,
  defaultValue: number,
  maximum: number,
  label: string,
): number {
  if (value === undefined) return defaultValue
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`${label} must be a positive safe integer`)
  }
  return Math.min(value, maximum)
}

function sortedUnique(values: string[] | undefined): string[] {
  return [...new Set(values ?? [])].sort()
}

function recordView(record: LoadedRecord, includeContent: boolean): StateRecordView {
  return {
    record_hash: record.record_hash,
    creator_key: record.record.creator_key,
    context_id: record.record.context_id,
    event_type: record.record.event_type,
    timestamp: record.record.timestamp,
    content_available: record.content !== undefined,
    ...(includeContent && record.content !== undefined ? { content: record.content } : {}),
  }
}

function exclusionReason(
  record: LoadedRecord,
  signatureValid: boolean,
  trustedCreatorKeys: ReadonlySet<string> | null,
  allowedContextIds: ReadonlySet<string> | null,
): StateExclusionReason | null {
  if (!signatureValid) return 'signature_invalid'
  if (trustedCreatorKeys && !trustedCreatorKeys.has(record.record.creator_key)) {
    return 'creator_not_trusted'
  }
  if (allowedContextIds && !allowedContextIds.has(record.record.context_id)) {
    return 'context_not_allowed'
  }
  return null
}

function compareRecordOrder(a: LoadedRecord, b: LoadedRecord): number {
  return a.record.timestamp - b.record.timestamp || a.record_hash.localeCompare(b.record_hash)
}

export async function projectAcceptedState(
  loaded: LoadedRecord[],
  options: StateProjectionOptions = {},
): Promise<StateProjection> {
  const includeContent = options.include_content !== false
  const limit = boundedLimit(
    options.limit,
    DEFAULT_CELL_LIMIT,
    MAX_CELL_LIMIT,
    'state projection limit',
  )
  const headLimit = boundedLimit(
    options.head_limit,
    DEFAULT_HEAD_LIMIT,
    MAX_HEAD_LIMIT,
    'state projection head_limit',
  )
  const requestedRoots = sortedUnique(options.root_record_hashes)
  for (const root of requestedRoots) {
    if (!RECORD_HASH_PATTERN.test(root)) {
      throw new TypeError(`invalid state root record hash: ${root}`)
    }
  }

  const trustedKeys = sortedUnique(options.trusted_creator_keys)
  const allowedContexts = sortedUnique(options.allowed_context_ids)
  const trustedCreatorKeys = trustedKeys.length > 0 ? new Set(trustedKeys) : null
  const allowedContextIds = allowedContexts.length > 0 ? new Set(allowedContexts) : null
  const byHash = new Map(loaded.map((entry) => [entry.record_hash, entry]))
  const uniqueLoaded = [...byHash.values()]
  const revisions = uniqueLoaded.filter((entry) => entry.record.event_type === REVISION_EVENT_TYPE)
  const candidateHashes = new Set(requestedRoots)
  for (const revision of revisions) {
    candidateHashes.add(revision.record_hash)
    const target = revisionTarget(revision)
    if (target) candidateHashes.add(target)
  }

  const signatureValidity = new Map<string, boolean>()
  await Promise.all(
    [...candidateHashes].map(async (hash) => {
      const entry = byHash.get(hash)
      if (entry) signatureValidity.set(hash, await verifyRecord(entry.record))
    }),
  )

  const accepted = new Map<string, LoadedRecord>()
  for (const hash of candidateHashes) {
    const entry = byHash.get(hash)
    if (!entry || entry.record.event_type === REVISION_EVENT_TYPE) continue
    const reason = exclusionReason(
      entry,
      signatureValidity.get(hash) === true,
      trustedCreatorKeys,
      allowedContextIds,
    )
    if (reason === null) accepted.set(hash, entry)
  }

  const children = new Map<string, string[]>()
  const parent = new Map<string, string>()
  const allExcludedRevisions: StateExcludedRevision[] = []
  const pendingRevisions: Array<{ revision: LoadedRecord; target: string }> = []
  for (const revision of revisions) {
    const target = revisionTarget(revision)
    const signatureValid = signatureValidity.get(revision.record_hash) === true
    const ownReason = exclusionReason(
      revision,
      signatureValid,
      trustedCreatorKeys,
      allowedContextIds,
    )
    if (ownReason !== null) {
      allExcludedRevisions.push({
        record_hash: revision.record_hash,
        ...(target ? { target_record_hash: target } : {}),
        reason: ownReason,
      })
      continue
    }
    if (!target || !byHash.has(target)) {
      allExcludedRevisions.push({
        record_hash: revision.record_hash,
        ...(target ? { target_record_hash: target } : {}),
        reason: 'target_missing',
      })
      continue
    }
    pendingRevisions.push({ revision, target })
  }

  pendingRevisions.sort((a, b) => compareRecordOrder(a.revision, b.revision))
  let madeProgress = true
  while (madeProgress && pendingRevisions.length > 0) {
    madeProgress = false
    for (let index = pendingRevisions.length - 1; index >= 0; index -= 1) {
      const pending = pendingRevisions[index]!
      if (!accepted.has(pending.target)) continue
      accepted.set(pending.revision.record_hash, pending.revision)
      const targetChildren = children.get(pending.target) ?? []
      targetChildren.push(pending.revision.record_hash)
      children.set(pending.target, targetChildren)
      parent.set(pending.revision.record_hash, pending.target)
      pendingRevisions.splice(index, 1)
      madeProgress = true
    }
  }
  for (const pending of pendingRevisions) {
    allExcludedRevisions.push({
      record_hash: pending.revision.record_hash,
      target_record_hash: pending.target,
      reason: 'target_not_accepted',
    })
  }

  for (const hashes of children.values()) {
    hashes.sort((a, b) => compareRecordOrder(accepted.get(a)!, accepted.get(b)!))
  }

  const unresolvedRootHashes = requestedRoots.filter((hash) => !accepted.has(hash))
  const rootHashes =
    requestedRoots.length > 0
      ? requestedRoots.filter((hash) => accepted.has(hash))
      : [...children.keys()].filter((hash) => !parent.has(hash))
  rootHashes.sort((a, b) => {
    const left = accepted.get(a)!
    const right = accepted.get(b)!
    return compareRecordOrder(right, left)
  })

  const cells: StateCell[] = []
  for (const rootHash of rootHashes) {
    const root = accepted.get(rootHash)
    if (!root) continue
    const component = new Set<string>()
    const stack = [rootHash]
    while (stack.length > 0) {
      const hash = stack.pop()!
      if (component.has(hash)) continue
      component.add(hash)
      for (const child of children.get(hash) ?? []) stack.push(child)
    }
    const headHashes = [...component].filter((hash) => (children.get(hash)?.length ?? 0) === 0)
    headHashes.sort((a, b) => compareRecordOrder(accepted.get(a)!, accepted.get(b)!))
    const excludedRevisionCount = allExcludedRevisions.filter(
      (entry) => entry.target_record_hash && component.has(entry.target_record_hash),
    ).length
    const returnedHeadHashes = headHashes.slice(0, headLimit)
    cells.push({
      root: recordView(root, includeContent),
      status: headHashes.length === 1 ? 'resolved' : 'conflict',
      active_heads: returnedHeadHashes.map((hash) =>
        recordView(accepted.get(hash)!, includeContent),
      ),
      total_active_heads: headHashes.length,
      active_heads_truncated: headHashes.length > returnedHeadHashes.length,
      revision_count: component.size - 1,
      excluded_revision_count: excludedRevisionCount,
    })
  }

  allExcludedRevisions.sort(
    (left, right) =>
      left.record_hash.localeCompare(right.record_hash) ||
      (left.target_record_hash ?? '').localeCompare(right.target_record_hash ?? '') ||
      left.reason.localeCompare(right.reason),
  )
  const excludedRevisions = allExcludedRevisions.slice(0, MAX_EXCLUSION_DETAILS)
  const returnedCells = cells.slice(0, limit)
  const warnings: string[] = []
  if (trustedCreatorKeys === null) {
    warnings.push(
      'No trusted_creator_keys policy was supplied; every locally verified signer was accepted into this view.',
    )
  }
  warnings.push(
    'This projection verifies local signatures, not public-log inclusion. Treat it as local accepted state unless a separate proof policy verifies inclusion.',
  )

  return {
    schema: 'atrib.state-projection.v1',
    acceptance_basis: {
      signature_verification: 'local_ed25519',
      creator_policy: trustedCreatorKeys ? 'caller_trust_set' : 'all_verified_local_signers',
      context_policy: allowedContextIds ? 'caller_allowlist' : 'all_contexts',
      log_inclusion_verified: false,
    },
    warnings,
    total_cells: cells.length,
    returned_cells: returnedCells.length,
    truncated: cells.length > returnedCells.length,
    conflict_count: cells.filter((cell) => cell.status === 'conflict').length,
    unresolved_root_hashes: unresolvedRootHashes,
    total_excluded_revisions: allExcludedRevisions.length,
    excluded_revisions_truncated: allExcludedRevisions.length > excludedRevisions.length,
    excluded_revisions: excludedRevisions,
    cells: returnedCells,
  }
}
