// SPDX-License-Identifier: Apache-2.0

/**
 * Endpoint-aware witness acquisition for spec §2.9.
 *
 * A log checkpoint is trusted only after verification against the caller's
 * pinned log key. Witness cosignatures are then fetched from the caller's
 * pinned witness endpoints. Cosignatures included in the log response never
 * enter the composed note.
 */

import {
  parseCheckpointNote,
  verifyCheckpointWitnessThreshold,
  verifyOperatorCheckpoint,
} from './witness.js'
import type {
  TrustedCheckpointKey,
  VerifyWitnessThresholdOptions,
  WitnessCosignatureVerification,
  WitnessThresholdVerification,
} from './witness.js'

const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/
const DEFAULT_MAX_RESPONSE_BYTES = 16 * 1024
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000

export interface PinnedCheckpointLogEndpoint extends TrustedCheckpointKey {
  /** Exact HTTPS or HTTP URL for the log's `/v1/checkpoint` response. */
  checkpointUrl: string
}

export interface PinnedWitnessEndpoint extends TrustedCheckpointKey {
  /** HTTPS or HTTP base URL controlled by this witness. */
  baseUrl: string
}

export interface FetchCheckpointWitnessThresholdOptions {
  /** Caller-pinned log checkpoint endpoint and C2SP key. */
  log: PinnedCheckpointLogEndpoint
  /** Caller-pinned witness endpoint and key pairs. */
  witnesses: readonly PinnedWitnessEndpoint[]
  /** Minimum number of valid witness cosignatures. Defaults to one. */
  requiredWitnesses?: number
  /** Clock used for witness freshness verification. */
  nowSeconds?: number
  /** Maximum accepted witness cosignature age. */
  maxAgeSeconds?: number
  /** Maximum accepted future witness clock skew. */
  futureSkewSeconds?: number
  /** Abort the outbound requests. */
  signal?: AbortSignal
  /** Maximum accepted checkpoint or cosignature response size. Defaults to 16 KiB. */
  maxResponseBytes?: number
  /** Per-request timeout. Defaults to 10 seconds. */
  requestTimeoutMs?: number
  /** Override fetch for tests or a caller-owned transport. */
  fetchImpl?: typeof fetch
}

export type CheckpointEndpointTransportState =
  'fetched' | 'http_error' | 'transport_error' | 'invalid_url'

export interface CheckpointEndpointTransportOutcome {
  url: string
  state: CheckpointEndpointTransportState
  httpStatus?: number
  reason?: string
}

export type WitnessEndpointTransportState =
  'fetched' | 'missing' | 'http_error' | 'transport_error' | 'invalid_url' | 'not_requested'

export interface WitnessEndpointTransportOutcome {
  url?: string
  state: WitnessEndpointTransportState
  httpStatus?: number
  reason?: string
}

export interface WitnessEndpointVerificationOutcome {
  valid: boolean
  keyId?: string
  timestampSeconds?: number
  reason?: string
}

export interface WitnessEndpointOutcome {
  name: string
  baseUrl: string
  transport: WitnessEndpointTransportOutcome
  verification: WitnessEndpointVerificationOutcome
}

export interface FetchCheckpointWitnessThresholdResult {
  checkpoint: CheckpointEndpointTransportOutcome
  witnesses: WitnessEndpointOutcome[]
  threshold: WitnessThresholdVerification
}

export interface FetchWitnessCosignaturesForCheckpointOptions {
  /** Exact operator checkpoint note that the witness signatures must cover. */
  checkpointNote: string
  /** Caller-pinned key for the checkpoint operator. */
  operatorKey: TrustedCheckpointKey
  /** Caller-pinned witness endpoint and key pairs. */
  witnesses: readonly PinnedWitnessEndpoint[]
  requiredWitnesses?: number
  nowSeconds?: number
  maxAgeSeconds?: number
  futureSkewSeconds?: number
  signal?: AbortSignal
  maxResponseBytes?: number
  requestTimeoutMs?: number
  fetchImpl?: typeof fetch
}

export interface FetchWitnessCosignaturesForCheckpointResult {
  /** Operator-only note plus valid endpoint-returned cosignatures. */
  checkpointNote: string
  /** Valid endpoint-returned cosignature lines in witness option order. */
  cosignatures: string[]
  witnesses: WitnessEndpointOutcome[]
  threshold: WitnessThresholdVerification
}

/**
 * Fetch a checkpoint from a caller-pinned log endpoint and fetch one
 * cosignature from every caller-pinned witness endpoint.
 *
 * The returned threshold result is calculated from a fresh local note: the
 * verified operator signature plus only endpoint-bound witness lines. The
 * helper deliberately discards witness-looking lines that arrived with the
 * log checkpoint.
 */
export async function fetchCheckpointWitnessThreshold(
  options: FetchCheckpointWitnessThresholdOptions,
): Promise<FetchCheckpointWitnessThresholdResult> {
  const thresholdOptions = thresholdOptionsFor(options)
  const checkpointFetch = await fetchCheckpoint(options)
  if (!checkpointFetch.note) {
    return {
      checkpoint: checkpointFetch.transport,
      witnesses: unavailableWitnesses(options.witnesses, 'checkpoint could not be fetched'),
      threshold: await verifyCheckpointWitnessThreshold('', thresholdOptions),
    }
  }

  const result = await fetchWitnessCosignaturesForCheckpoint({
    checkpointNote: checkpointFetch.note,
    operatorKey: thresholdOptions.operatorKey,
    witnesses: options.witnesses,
    ...(options.requiredWitnesses === undefined
      ? {}
      : { requiredWitnesses: options.requiredWitnesses }),
    ...(options.nowSeconds === undefined ? {} : { nowSeconds: options.nowSeconds }),
    ...(options.maxAgeSeconds === undefined ? {} : { maxAgeSeconds: options.maxAgeSeconds }),
    ...(options.futureSkewSeconds === undefined
      ? {}
      : { futureSkewSeconds: options.futureSkewSeconds }),
    ...(options.signal ? { signal: options.signal } : {}),
    ...(options.maxResponseBytes === undefined
      ? {}
      : { maxResponseBytes: options.maxResponseBytes }),
    ...(options.requestTimeoutMs === undefined
      ? {}
      : { requestTimeoutMs: options.requestTimeoutMs }),
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
  })
  return {
    checkpoint: checkpointFetch.transport,
    witnesses: result.witnesses,
    threshold: result.threshold,
  }
}

/**
 * Fetch endpoint-bound witness cosignatures for one exact checkpoint note.
 *
 * Proof-bundle verification uses this form so a newer log checkpoint cannot
 * replace the historical checkpoint that covers the proved entry.
 */
export async function fetchWitnessCosignaturesForCheckpoint(
  options: FetchWitnessCosignaturesForCheckpointOptions,
): Promise<FetchWitnessCosignaturesForCheckpointResult> {
  const thresholdOptions: VerifyWitnessThresholdOptions = {
    operatorKey: options.operatorKey,
    witnessKeys: options.witnesses.map((witness) => ({
      name: witness.name,
      publicKey: witness.publicKey,
    })),
    ...(options.requiredWitnesses === undefined
      ? {}
      : { requiredWitnesses: options.requiredWitnesses }),
    ...(options.nowSeconds === undefined ? {} : { nowSeconds: options.nowSeconds }),
    ...(options.maxAgeSeconds === undefined ? {} : { maxAgeSeconds: options.maxAgeSeconds }),
    ...(options.futureSkewSeconds === undefined
      ? {}
      : { futureSkewSeconds: options.futureSkewSeconds }),
  }
  const operator = await verifyOperatorCheckpoint(
    options.checkpointNote,
    thresholdOptions.operatorKey,
  )
  if (!operator.valid || !operator.checkpoint) {
    return {
      checkpointNote: options.checkpointNote,
      cosignatures: [],
      witnesses: unavailableWitnesses(
        options.witnesses,
        `operator checkpoint did not verify: ${operator.reason ?? 'unknown failure'}`,
      ),
      threshold: await verifyCheckpointWitnessThreshold(options.checkpointNote, thresholdOptions),
    }
  }

  const checkpoint = operator.checkpoint
  const operatorNote = await operatorOnlyNote(checkpoint, thresholdOptions.operatorKey)
  if (!operatorNote) {
    return {
      checkpointNote: `${checkpoint.body}\n`,
      cosignatures: [],
      witnesses: unavailableWitnesses(
        options.witnesses,
        'verified operator signature could not be isolated from the checkpoint response',
      ),
      threshold: await verifyCheckpointWitnessThreshold(`${checkpoint.body}\n`, thresholdOptions),
    }
  }

  const rootHash = Buffer.from(checkpoint.rootHash).toString('base64url')
  const fetched = await Promise.all(
    options.witnesses.map((witness) =>
      fetchWitnessCosignature(
        witness,
        operatorNote,
        checkpoint.origin,
        rootHash,
        thresholdOptions,
        options,
      ),
    ),
  )

  const accepted = fetched.filter(
    (result): result is FetchedWitnessCosignature & { line: string } => result.line !== undefined,
  )
  const composed = appendWitnessLines(
    operatorNote,
    accepted.map((result) => result.line),
  )
  const threshold = await verifyCheckpointWitnessThreshold(composed, thresholdOptions)

  let verificationIndex = 0
  const witnesses = fetched.map((result) => {
    if (result.line === undefined) return result.outcome
    const verification = threshold.witnesses[verificationIndex]
    verificationIndex += 1
    return {
      ...result.outcome,
      verification: verification
        ? endpointVerification(verification)
        : {
            valid: false,
            reason: 'cosignature was omitted during threshold verification',
          },
    }
  })

  return {
    checkpointNote: composed,
    cosignatures: accepted.map((result) => result.line),
    witnesses,
    threshold,
  }
}

interface CheckpointFetch {
  note?: string
  transport: CheckpointEndpointTransportOutcome
}

async function fetchCheckpoint(
  options: FetchCheckpointWitnessThresholdOptions,
): Promise<CheckpointFetch> {
  const url = options.log.checkpointUrl
  try {
    assertHttpUrl(url)
  } catch (error) {
    return {
      transport: {
        url,
        state: 'invalid_url',
        reason: errorMessage(error),
      },
    }
  }

  try {
    const response = await fetchText(url, options)
    if (!response.ok) {
      return {
        transport: {
          url,
          state: 'http_error',
          httpStatus: response.status,
          reason: `log checkpoint endpoint returned ${response.status}`,
        },
      }
    }
    return {
      note: response.body,
      transport: { url, state: 'fetched', httpStatus: response.status },
    }
  } catch (error) {
    return {
      transport: {
        url,
        state: 'transport_error',
        reason: errorMessage(error),
      },
    }
  }
}

interface FetchedWitnessCosignature {
  line?: string
  outcome: WitnessEndpointOutcome
}

async function fetchWitnessCosignature(
  witness: PinnedWitnessEndpoint,
  operatorNote: string,
  logOrigin: string,
  rootHash: string,
  thresholdOptions: VerifyWitnessThresholdOptions,
  fetchOptions: Pick<
    FetchCheckpointWitnessThresholdOptions,
    'fetchImpl' | 'signal' | 'maxResponseBytes' | 'requestTimeoutMs'
  >,
): Promise<FetchedWitnessCosignature> {
  let url: string
  try {
    url = witnessCosignatureUrl(witness.baseUrl, logOrigin, rootHash)
  } catch (error) {
    return {
      outcome: witnessOutcome(witness, {
        state: 'invalid_url',
        reason: errorMessage(error),
      }),
    }
  }

  let response: BoundedTextResponse
  try {
    response = await fetchText(url, fetchOptions)
  } catch (error) {
    return {
      outcome: witnessOutcome(witness, {
        url,
        state: 'transport_error',
        reason: errorMessage(error),
      }),
    }
  }

  if (response.status === 404) {
    return {
      outcome: witnessOutcome(witness, {
        url,
        state: 'missing',
        httpStatus: response.status,
        reason: 'witness has not cosigned this checkpoint',
      }),
    }
  }
  if (!response.ok) {
    return {
      outcome: witnessOutcome(witness, {
        url,
        state: 'http_error',
        httpStatus: response.status,
        reason: `witness endpoint returned ${response.status}`,
      }),
    }
  }

  const line = response.body

  if (!isSingleWitnessCosignature(line)) {
    return {
      outcome: witnessOutcome(
        witness,
        { url, state: 'fetched', httpStatus: response.status },
        { valid: false, reason: 'witness endpoint returned an invalid cosignature line' },
      ),
    }
  }

  const individual = await verifyCheckpointWitnessThreshold(
    appendWitnessLines(operatorNote, [line]),
    {
      ...thresholdOptions,
      witnessKeys: [{ name: witness.name, publicKey: witness.publicKey }],
      requiredWitnesses: 1,
    },
  )
  const verification = individual.witnesses[0]
  if (!verification || !verification.valid) {
    return {
      outcome: witnessOutcome(
        witness,
        { url, state: 'fetched', httpStatus: response.status },
        endpointVerification(
          verification ?? {
            name: witness.name,
            keyId: '',
            valid: false,
            reason: 'witness endpoint returned an invalid cosignature line',
          },
        ),
      ),
    }
  }

  return {
    line,
    outcome: witnessOutcome(
      witness,
      { url, state: 'fetched', httpStatus: response.status },
      endpointVerification(verification),
    ),
  }
}

function thresholdOptionsFor(
  options: FetchCheckpointWitnessThresholdOptions,
): VerifyWitnessThresholdOptions {
  return {
    operatorKey: { name: options.log.name, publicKey: options.log.publicKey },
    witnessKeys: options.witnesses.map((witness) => ({
      name: witness.name,
      publicKey: witness.publicKey,
    })),
    ...(options.requiredWitnesses === undefined
      ? {}
      : { requiredWitnesses: options.requiredWitnesses }),
    ...(options.nowSeconds === undefined ? {} : { nowSeconds: options.nowSeconds }),
    ...(options.maxAgeSeconds === undefined ? {} : { maxAgeSeconds: options.maxAgeSeconds }),
    ...(options.futureSkewSeconds === undefined
      ? {}
      : { futureSkewSeconds: options.futureSkewSeconds }),
  }
}

async function operatorOnlyNote(
  checkpoint: ReturnType<typeof parseCheckpointNote>,
  operatorKey: TrustedCheckpointKey,
): Promise<string | undefined> {
  for (const line of checkpoint.signatureLines) {
    const candidate = `${checkpoint.body}\n${line}\n`
    const verification = await verifyOperatorCheckpoint(candidate, operatorKey)
    if (verification.valid) return candidate
  }
  return undefined
}

function appendWitnessLines(operatorNote: string, lines: readonly string[]): string {
  if (lines.length === 0) return operatorNote
  return `${operatorNote.trimEnd()}\n${lines.map((line) => line.trimEnd()).join('\n')}\n`
}

function witnessCosignatureUrl(baseUrl: string, logOrigin: string, rootHash: string): string {
  const url = new URL(baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`)
  assertHttpUrl(url.toString())
  return new URL(
    `v1/cosig/${encodeURIComponent(logOrigin)}/${encodeURIComponent(rootHash)}`,
    url,
  ).toString()
}

function assertHttpUrl(value: string): void {
  const url = new URL(value)
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('endpoint URL must use http or https')
  }
  if (url.username || url.password) {
    throw new Error('endpoint URL must not contain credentials')
  }
}

async function fetchText(
  url: string,
  options: Pick<
    FetchCheckpointWitnessThresholdOptions,
    'fetchImpl' | 'signal' | 'maxResponseBytes' | 'requestTimeoutMs'
  >,
): Promise<BoundedTextResponse> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  if (typeof fetchImpl !== 'function') throw new Error('fetch is unavailable')
  const maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES
  const requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
  if (!Number.isSafeInteger(maxResponseBytes) || maxResponseBytes < 1) {
    throw new Error('maxResponseBytes must be a positive safe integer')
  }
  if (!Number.isSafeInteger(requestTimeoutMs) || requestTimeoutMs < 1) {
    throw new Error('requestTimeoutMs must be a positive safe integer')
  }

  const controller = new AbortController()
  const abortFromCaller = (): void => controller.abort(options.signal?.reason)
  options.signal?.addEventListener('abort', abortFromCaller, { once: true })
  const timeout = setTimeout(
    () => controller.abort(new Error(`endpoint request exceeded ${requestTimeoutMs}ms`)),
    requestTimeoutMs,
  )
  try {
    if (options.signal?.aborted) controller.abort(options.signal.reason)
    const response = await fetchImpl(url, {
      method: 'GET',
      headers: { accept: 'text/plain' },
      credentials: 'omit',
      redirect: 'error',
      signal: controller.signal,
    })
    return {
      ok: response.ok,
      status: response.status,
      body: await readBoundedText(response, maxResponseBytes),
    }
  } finally {
    clearTimeout(timeout)
    options.signal?.removeEventListener('abort', abortFromCaller)
  }
}

interface BoundedTextResponse {
  ok: boolean
  status: number
  body: string
}

async function readBoundedText(response: Response, maxBytes: number): Promise<string> {
  const declaredLength = response.headers.get('content-length')
  if (declaredLength !== null) {
    const parsed = Number(declaredLength)
    if (Number.isFinite(parsed) && parsed > maxBytes) {
      await response.body?.cancel()
      throw new Error(`endpoint response exceeds ${maxBytes} bytes`)
    }
  }
  if (!response.body) return ''

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const next = await reader.read()
      if (next.done) break
      total += next.value.length
      if (total > maxBytes) {
        await reader.cancel()
        throw new Error(`endpoint response exceeds ${maxBytes} bytes`)
      }
      chunks.push(next.value)
    }
  } finally {
    reader.releaseLock()
  }
  return Buffer.concat(
    chunks.map((chunk) => Buffer.from(chunk)),
    total,
  ).toString('utf8')
}

function isSingleWitnessCosignature(line: string): boolean {
  const match = /^— \S+ ([A-Za-z0-9+/]+={0,2})\n$/.exec(line)
  if (!match || !BASE64_PATTERN.test(match[1]!) || match[1]!.length % 4 !== 0) return false
  const payload = new Uint8Array(Buffer.from(match[1]!, 'base64'))
  return payload.length === 76 && Buffer.from(payload).toString('base64') === match[1]
}

function unavailableWitnesses(
  witnesses: readonly PinnedWitnessEndpoint[],
  reason: string,
): WitnessEndpointOutcome[] {
  return witnesses.map((witness) => witnessOutcome(witness, { state: 'not_requested', reason }))
}

function witnessOutcome(
  witness: PinnedWitnessEndpoint,
  transport: WitnessEndpointTransportOutcome,
  verification: WitnessEndpointVerificationOutcome = {
    valid: false,
    ...(transport.reason ? { reason: transport.reason } : {}),
  },
): WitnessEndpointOutcome {
  return { name: witness.name, baseUrl: witness.baseUrl, transport, verification }
}

function endpointVerification(
  verification: WitnessCosignatureVerification,
): WitnessEndpointVerificationOutcome {
  return {
    valid: verification.valid,
    keyId: verification.keyId,
    ...(verification.timestampSeconds === undefined
      ? {}
      : { timestampSeconds: verification.timestampSeconds }),
    ...(verification.reason ? { reason: verification.reason } : {}),
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
