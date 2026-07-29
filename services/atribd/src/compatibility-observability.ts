// SPDX-License-Identifier: Apache-2.0

import { promises as fs, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export const MCP_COMPATIBILITY_SCHEMA = 'atrib.mcp-compatibility-observability.v1'
export const DEFAULT_LEGACY_ZERO_WINDOW_MS = 30 * 24 * 60 * 60 * 1000
const MAX_CLIENT_LABELS = 16
const MAX_PROTOCOL_LABELS = 8

interface LabelObservation {
  requests: number
  last_seen_at: string
}

interface CompatibilityState {
  schema: typeof MCP_COMPATIBILITY_SCHEMA
  profile: string
  observation_started_at: string
  updated_at: string
  modern_requests: number
  legacy_requests: number
  last_modern_at?: string
  last_legacy_at?: string
  legacy_after_modern_requests: number
  last_legacy_after_modern_at?: string
  clients: Record<string, LabelObservation>
  protocols: Record<string, LabelObservation>
}

export interface McpCompatibilityReport extends CompatibilityState {
  expected_modern: boolean
  privacy: {
    request_bodies_recorded: false
    context_ids_recorded: false
    network_identifiers_recorded: false
    client_labels_bounded: number
    protocol_labels_bounded: number
  }
  removal_policy: {
    sustained_zero_window_ms: number
    announcement_required: true
  }
  removal_readiness: {
    status: 'blocked' | 'observing' | 'eligible-for-announcement'
    zero_since: string
    observed_zero_ms: number
    remaining_ms: number
    reasons: string[]
  }
}

export interface McpCompatibilityObserver {
  observe(req: { headers: Record<string, unknown> }, body: unknown): void
  report(): McpCompatibilityReport
  flush(): Promise<void>
}

export interface McpCompatibilityObserverOptions {
  profile?: string
  expectedModern?: boolean
  stateFile?: string | false
  legacyZeroWindowMs?: number
  now?: () => number
  onPersistenceError?: (error: unknown) => void
  onLegacyAfterModern?: (event: {
    profile: string
    client: string
    protocol: string
    observedAt: string
    count: number
  }) => void
}

function cleanLabel(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const clean = [...value]
    .filter((character) => {
      const code = character.charCodeAt(0)
      return code > 31 && code !== 127
    })
    .join('')
    .trim()
  return clean ? clean.slice(0, maxLength) : undefined
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function headerValue(headers: Record<string, unknown>, name: string): string | undefined {
  const direct = headers[name]
  const value = Array.isArray(direct) ? direct[0] : direct
  return cleanLabel(value, 32)
}

function requestLabels(
  headers: Record<string, unknown>,
  body: unknown,
): { era: 'modern' | 'legacy'; client: string; protocol: string } {
  const request = recordValue(body)
  const params = recordValue(request?.params)
  const meta = recordValue(params?._meta)
  const modernClient = recordValue(meta?.['io.modelcontextprotocol/clientInfo'])
  const legacyClient = recordValue(params?.clientInfo)
  const clientInfo = modernClient ?? legacyClient
  const name = cleanLabel(clientInfo?.name, 64) ?? 'unknown'
  const version = cleanLabel(clientInfo?.version, 32)
  const headerProtocol = headerValue(headers, 'mcp-protocol-version')
  const declaredProtocol =
    headerProtocol ??
    cleanLabel(params?.protocolVersion, 32) ??
    cleanLabel(meta?.['io.modelcontextprotocol/protocolVersion'], 32)
  const era = headerProtocol === '2026-07-28' ? 'modern' : 'legacy'
  return {
    era,
    client: version ? `${name}@${version}` : name,
    protocol: declaredProtocol ?? 'legacy-unspecified',
  }
}

function addLabel(
  labels: Record<string, LabelObservation>,
  label: string,
  limit: number,
  observedAt: string,
): void {
  const hasCapacity = Boolean(labels[label]) || Object.keys(labels).length < limit
  const boundedLabel = hasCapacity ? label : 'other'
  const prior = labels[boundedLabel]
  labels[boundedLabel] = {
    requests: (prior?.requests ?? 0) + 1,
    last_seen_at: observedAt,
  }
}

function safeProfile(profile: string): string {
  return profile.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 64) || 'unknown'
}

function defaultStateFile(profile: string): string {
  return join(homedir(), '.atrib', 'state', `atribd-mcp-compat-${safeProfile(profile)}.json`)
}

function freshState(profile: string, now: number): CompatibilityState {
  const observedAt = new Date(now).toISOString()
  return {
    schema: MCP_COMPATIBILITY_SCHEMA,
    profile,
    observation_started_at: observedAt,
    updated_at: observedAt,
    modern_requests: 0,
    legacy_requests: 0,
    legacy_after_modern_requests: 0,
    clients: {},
    protocols: {},
  }
}

function loadState(path: string, profile: string, now: number): CompatibilityState {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<CompatibilityState>
    const valid =
      parsed.schema === MCP_COMPATIBILITY_SCHEMA &&
      parsed.profile === profile &&
      typeof parsed.observation_started_at === 'string' &&
      typeof parsed.updated_at === 'string' &&
      typeof parsed.modern_requests === 'number' &&
      typeof parsed.legacy_requests === 'number' &&
      typeof parsed.legacy_after_modern_requests === 'number' &&
      recordValue(parsed.clients) &&
      recordValue(parsed.protocols)
    if (valid) {
      return parsed as CompatibilityState
    }
  } catch {
    // Missing, stale, or malformed operational state starts a new observation window.
  }
  return freshState(profile, now)
}

export function createMcpCompatibilityObserver(
  options: McpCompatibilityObserverOptions = {},
): McpCompatibilityObserver {
  const now = options.now ?? Date.now
  const profile = cleanLabel(options.profile, 64) ?? 'unknown'
  const expectedModern = options.expectedModern ?? false
  const legacyZeroWindowMs = options.legacyZeroWindowMs ?? DEFAULT_LEGACY_ZERO_WINDOW_MS
  const stateFile =
    options.stateFile === false ? undefined : (options.stateFile ?? defaultStateFile(profile))
  const state = stateFile ? loadState(stateFile, profile, now()) : freshState(profile, now())
  let persistence = Promise.resolve()

  function persist(): void {
    if (!stateFile) return
    const snapshot = `${JSON.stringify(state, null, 2)}\n`
    persistence = persistence
      .then(async () => {
        await fs.mkdir(dirname(stateFile), { recursive: true })
        const temp = `${stateFile}.tmp-${process.pid}`
        await fs.writeFile(temp, snapshot, { mode: 0o600 })
        await fs.rename(temp, stateFile)
      })
      .catch((error: unknown) => {
        options.onPersistenceError?.(error)
      })
  }

  return {
    observe: (req, body) => {
      const labels = requestLabels(req.headers, body)
      const observedAt = new Date(now()).toISOString()
      const hadModernTraffic = state.modern_requests > 0
      state.updated_at = observedAt
      addLabel(state.clients, labels.client, MAX_CLIENT_LABELS, observedAt)
      addLabel(state.protocols, labels.protocol, MAX_PROTOCOL_LABELS, observedAt)
      if (labels.era === 'modern') {
        state.modern_requests += 1
        state.last_modern_at = observedAt
      } else {
        state.legacy_requests += 1
        state.last_legacy_at = observedAt
        if (hadModernTraffic) {
          state.legacy_after_modern_requests += 1
          state.last_legacy_after_modern_at = observedAt
          if (expectedModern) {
            options.onLegacyAfterModern?.({
              profile,
              client: labels.client,
              protocol: labels.protocol,
              observedAt,
              count: state.legacy_after_modern_requests,
            })
          }
        }
      }
      persist()
    },
    report: () => {
      const current = now()
      const zeroSince = Date.parse(state.last_legacy_at ?? state.observation_started_at)
      const observedZeroMs = Math.max(0, current - zeroSince)
      const reasons: string[] = []
      if (state.modern_requests === 0) reasons.push('no modern traffic observed')
      if (observedZeroMs < legacyZeroWindowMs) reasons.push('sustained-zero window incomplete')
      if (expectedModern && state.legacy_after_modern_requests > 0) {
        reasons.push('legacy traffic observed after modern traffic')
      }
      const status =
        reasons.length === 0
          ? 'eligible-for-announcement'
          : state.modern_requests === 0
            ? 'observing'
            : 'blocked'
      return {
        ...structuredClone(state),
        expected_modern: expectedModern,
        privacy: {
          request_bodies_recorded: false,
          context_ids_recorded: false,
          network_identifiers_recorded: false,
          client_labels_bounded: MAX_CLIENT_LABELS,
          protocol_labels_bounded: MAX_PROTOCOL_LABELS,
        },
        removal_policy: {
          sustained_zero_window_ms: legacyZeroWindowMs,
          announcement_required: true,
        },
        removal_readiness: {
          status,
          zero_since: new Date(zeroSince).toISOString(),
          observed_zero_ms: observedZeroMs,
          remaining_ms: Math.max(0, legacyZeroWindowMs - observedZeroMs),
          reasons,
        },
      }
    },
    flush: () => persistence,
  }
}
