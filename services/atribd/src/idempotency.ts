// SPDX-License-Identifier: Apache-2.0

import { promises as fs, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { createJsonCommitment } from '@atrib/mcp'
import type { CallToolRequest, CallToolResult } from '@modelcontextprotocol/sdk/types.js'

export const IDEMPOTENCY_META_KEY = 'dev.atrib/idempotencyKey'
export const IDEMPOTENCY_SCHEMA = 'atrib.mcp-write-idempotency.v1'
export const DEFAULT_IDEMPOTENCY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000
export const DEFAULT_IDEMPOTENCY_MAX_ENTRIES = 10_000

interface PendingEntry {
  key_hash: string
  binding: string
  status: 'pending'
  created_at: string
  updated_at: string
}

interface CompletedEntry {
  key_hash: string
  binding: string
  status: 'completed'
  created_at: string
  updated_at: string
  result: CallToolResult
}

type IdempotencyEntry = PendingEntry | CompletedEntry

interface IdempotencyState {
  schema: typeof IDEMPOTENCY_SCHEMA
  profile: string
  entries: Record<string, IdempotencyEntry>
}

export type IdempotencyBeginResult =
  | { kind: 'owner'; keyHash: string; binding: string }
  | { kind: 'replay'; result: CallToolResult }
  | { kind: 'binding-mismatch' }
  | { kind: 'indeterminate' }

export interface WriteIdempotencyStore {
  begin(key: string, binding: string): Promise<IdempotencyBeginResult>
  complete(keyHash: string, binding: string, result: CallToolResult): Promise<void>
  report(): {
    schema: typeof IDEMPOTENCY_SCHEMA
    window_ms: number
    max_entries: number
    pending: number
    completed: number
  }
  flush(): Promise<void>
}

export interface WriteIdempotencyStoreOptions {
  profile?: string
  stateFile?: string | false
  windowMs?: number
  maxEntries?: number
  now?: () => number
}

function safeProfile(profile: string): string {
  return profile.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 64) || 'unknown'
}

function defaultStateFile(profile: string): string {
  return join(homedir(), '.atrib', 'state', `atribd-idempotency-${safeProfile(profile)}.json`)
}

function freshState(profile: string): IdempotencyState {
  return { schema: IDEMPOTENCY_SCHEMA, profile, entries: {} }
}

function isEntry(value: unknown): value is IdempotencyEntry {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const entry = value as Partial<IdempotencyEntry>
  return (
    typeof entry.key_hash === 'string' &&
    typeof entry.binding === 'string' &&
    typeof entry.created_at === 'string' &&
    typeof entry.updated_at === 'string' &&
    (entry.status === 'pending' ||
      (entry.status === 'completed' &&
        entry.result !== null &&
        typeof entry.result === 'object' &&
        !Array.isArray(entry.result)))
  )
}

function loadState(path: string, profile: string): IdempotencyState {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<IdempotencyState>
    if (
      parsed.schema === IDEMPOTENCY_SCHEMA &&
      parsed.profile === profile &&
      parsed.entries &&
      typeof parsed.entries === 'object' &&
      !Array.isArray(parsed.entries) &&
      Object.values(parsed.entries).every(isEntry)
    ) {
      return parsed as IdempotencyState
    }
  } catch {
    // Missing or malformed operational state starts empty.
  }
  return freshState(profile)
}

function hashKey(key: string): string {
  return createJsonCommitment(key, 'plain-sha256').hash
}

export function validateIdempotencyKey(value: unknown): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value.length < 16 || value.length > 128) {
    throw new TypeError('atribd: idempotency key must be a 16-128 character string')
  }
  for (const character of value) {
    const code = character.charCodeAt(0)
    if (code < 33 || code > 126) {
      throw new TypeError('atribd: idempotency key must contain visible ASCII characters only')
    }
  }
  return value
}

export function idempotencyKeyFromRequest(params: CallToolRequest['params']): string | undefined {
  const meta = params._meta
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return undefined
  return validateIdempotencyKey((meta as Record<string, unknown>)[IDEMPOTENCY_META_KEY])
}

export function writeActionBinding(
  params: CallToolRequest['params'],
  resolvedContextId?: string,
): string {
  return createJsonCommitment(
    {
      context_id:
        resolvedContextId ??
        (params.arguments &&
        typeof params.arguments === 'object' &&
        !Array.isArray(params.arguments)
          ? ((params.arguments as Record<string, unknown>)['context_id'] ?? null)
          : null),
      tool: params.name,
      arguments: params.arguments ?? {},
    },
    'plain-sha256',
  ).hash
}

export function createWriteIdempotencyStore(
  options: WriteIdempotencyStoreOptions = {},
): WriteIdempotencyStore {
  const profile = safeProfile(options.profile ?? 'unknown')
  const now = options.now ?? Date.now
  const windowMs = options.windowMs ?? DEFAULT_IDEMPOTENCY_WINDOW_MS
  const maxEntries = options.maxEntries ?? DEFAULT_IDEMPOTENCY_MAX_ENTRIES
  const stateFile =
    options.stateFile === false ? undefined : (options.stateFile ?? defaultStateFile(profile))
  const state = stateFile ? loadState(stateFile, profile) : freshState(profile)
  let persistence = Promise.resolve()

  async function persist(): Promise<void> {
    if (!stateFile) return
    const snapshot = `${JSON.stringify(state, null, 2)}\n`
    persistence = persistence.then(async () => {
      await fs.mkdir(dirname(stateFile), { recursive: true })
      const temp = `${stateFile}.tmp-${process.pid}`
      await fs.writeFile(temp, snapshot, { mode: 0o600 })
      await fs.rename(temp, stateFile)
    })
    await persistence
  }

  function pruneCompleted(): void {
    const cutoff = now() - windowMs
    const completed = Object.values(state.entries)
      .filter((entry): entry is CompletedEntry => entry.status === 'completed')
      .sort((left, right) => Date.parse(left.updated_at) - Date.parse(right.updated_at))
    for (const entry of completed) {
      if (
        Date.parse(entry.updated_at) < cutoff ||
        Object.keys(state.entries).length >= maxEntries
      ) {
        delete state.entries[entry.key_hash]
      }
    }
  }

  return {
    async begin(key, binding) {
      const keyHash = hashKey(key)
      pruneCompleted()
      const prior = state.entries[keyHash]
      if (prior) {
        if (prior.binding !== binding) return { kind: 'binding-mismatch' }
        if (prior.status === 'completed') {
          return { kind: 'replay', result: structuredClone(prior.result) }
        }
        return { kind: 'indeterminate' }
      }
      if (Object.keys(state.entries).length >= maxEntries) {
        throw new Error('atribd: idempotency store is full of unresolved pending entries')
      }
      const timestamp = new Date(now()).toISOString()
      state.entries[keyHash] = {
        key_hash: keyHash,
        binding,
        status: 'pending',
        created_at: timestamp,
        updated_at: timestamp,
      }
      await persist()
      return { kind: 'owner', keyHash, binding }
    },
    async complete(keyHash, binding, result) {
      const prior = state.entries[keyHash]
      if (!prior || prior.binding !== binding) {
        throw new Error('atribd: idempotency completion has no matching pending entry')
      }
      state.entries[keyHash] = {
        key_hash: keyHash,
        binding,
        status: 'completed',
        created_at: prior.created_at,
        updated_at: new Date(now()).toISOString(),
        result: structuredClone(result),
      }
      await persist()
    },
    report() {
      const entries = Object.values(state.entries)
      return {
        schema: IDEMPOTENCY_SCHEMA,
        window_ms: windowMs,
        max_entries: maxEntries,
        pending: entries.filter((entry) => entry.status === 'pending').length,
        completed: entries.filter((entry) => entry.status === 'completed').length,
      }
    },
    flush: () => persistence,
  }
}
