// SPDX-License-Identifier: Apache-2.0

/**
 * Checkpoint and witness verification for spec §2.9.
 *
 * Trust roots are caller supplied. The log and witness HTTP endpoints never
 * become trust authorities merely because they publish a key.
 */

import * as ed from '@noble/ed25519'
import { sha512 } from '@noble/hashes/sha2.js'
import { nodeHash, sha256 } from '@atrib/mcp'

ed.hashes.sha512 = sha512
ed.hashes.sha512Async = (message) => Promise.resolve(sha512(message))

const encoder = new TextEncoder()
const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/

export interface TrustedCheckpointKey {
  name: string
  publicKey: Uint8Array | string
}

export interface ParsedCheckpointNote {
  body: string
  origin: string
  treeSize: number
  rootHash: Uint8Array
  signatureLines: string[]
}

export interface OperatorCheckpointVerification {
  valid: boolean
  checkpoint?: ParsedCheckpointNote
  reason?: string
}

export interface WitnessCosignatureVerification {
  name: string
  keyId: string
  timestampSeconds?: number
  valid: boolean
  reason?: string
}

export interface WitnessThresholdVerification {
  operator: OperatorCheckpointVerification
  witnesses: WitnessCosignatureVerification[]
  validWitnesses: number
  requiredWitnesses: number
  thresholdMet: boolean
}

export interface VerifyWitnessThresholdOptions {
  operatorKey: TrustedCheckpointKey
  witnessKeys: readonly TrustedCheckpointKey[]
  requiredWitnesses?: number
  nowSeconds?: number
  maxAgeSeconds?: number
  futureSkewSeconds?: number
}

export interface CreateWitnessCosignatureOptions {
  checkpointBody: string
  witnessName: string
  privateKey: Uint8Array
  timestampSeconds?: number
}

export interface CheckpointView {
  treeSize: number
  rootHash: Uint8Array
}

export function checkpointKeyId(name: string, publicKey: Uint8Array): Uint8Array {
  if (name.length === 0 || name.includes('\n')) {
    throw new Error('checkpoint key name must be non-empty and single-line')
  }
  if (publicKey.length !== 32) {
    throw new Error('checkpoint public key must be 32 bytes')
  }
  const nameBytes = encoder.encode(name)
  const input = new Uint8Array(nameBytes.length + 34)
  input.set(nameBytes, 0)
  input[nameBytes.length] = 0x0a
  input[nameBytes.length + 1] = 0x01
  input.set(publicKey, nameBytes.length + 2)
  return sha256(input).slice(0, 4)
}

export function parseCheckpointNote(note: string): ParsedCheckpointNote {
  const separator = note.indexOf('\n\n')
  if (separator < 0) throw new Error('checkpoint note omitted the signature separator')

  const body = note.slice(0, separator + 1)
  const bodyLines = body.split('\n')
  if (bodyLines.length !== 4 || bodyLines[3] !== '') {
    throw new Error('checkpoint body must contain exactly three newline-terminated lines')
  }
  const [origin, treeSizeText, rootHashText] = bodyLines
  if (!origin || origin.includes('\r')) throw new Error('checkpoint origin is malformed')
  if (!/^(0|[1-9]\d*)$/.test(treeSizeText ?? '')) {
    throw new Error('checkpoint tree size is malformed')
  }
  const treeSize = Number(treeSizeText)
  if (!Number.isSafeInteger(treeSize) || treeSize < 1) {
    throw new Error('checkpoint tree size is outside the supported range')
  }
  const rootHash = decodeBase64(rootHashText ?? '', 32, 'checkpoint root hash')
  const signatureText = note.slice(separator + 2)
  if (!signatureText.endsWith('\n')) {
    throw new Error('checkpoint signature block must end with a newline')
  }
  const signatureLines = signatureText.slice(0, -1).split('\n')
  if (signatureLines.some((line) => line.length === 0)) {
    throw new Error('checkpoint signature block contains a blank line')
  }
  if (signatureLines.length === 0) throw new Error('checkpoint note has no signatures')

  return { body, origin, treeSize, rootHash, signatureLines }
}

export async function verifyOperatorCheckpoint(
  note: string,
  trustedKey: TrustedCheckpointKey,
): Promise<OperatorCheckpointVerification> {
  try {
    const checkpoint = parseCheckpointNote(note)
    if (checkpoint.origin !== trustedKey.name) {
      return { valid: false, reason: 'checkpoint origin does not match the pinned log name' }
    }
    const publicKey = normalizePublicKey(trustedKey.publicKey)
    const expectedKeyId = checkpointKeyId(trustedKey.name, publicKey)
    const candidates = checkpoint.signatureLines
      .map(parseSignatureLine)
      .filter(
        (line): line is ParsedSignatureLine => line !== undefined && line.payload.length === 68,
      )
    const candidate = candidates.find(
      (line) =>
        line.name === trustedKey.name && bytesEqual(line.payload.slice(0, 4), expectedKeyId),
    )
    if (!candidate) {
      return { valid: false, reason: 'checkpoint has no signature from the pinned log key' }
    }
    const valid = await ed.verifyAsync(
      candidate.payload.slice(4),
      encoder.encode(checkpoint.body),
      publicKey,
    )
    return valid
      ? { valid: true, checkpoint }
      : { valid: false, reason: 'checkpoint operator signature is invalid' }
  } catch (error) {
    return { valid: false, reason: error instanceof Error ? error.message : String(error) }
  }
}

export async function createWitnessCosignature(
  options: CreateWitnessCosignatureOptions,
): Promise<string> {
  const checkpoint = parseCheckpointBodyOnly(options.checkpointBody)
  void checkpoint
  if (options.privateKey.length !== 32) {
    throw new Error('witness private key must be a 32-byte Ed25519 seed')
  }
  const timestampSeconds = options.timestampSeconds ?? Math.floor(Date.now() / 1000)
  if (!Number.isSafeInteger(timestampSeconds) || timestampSeconds < 0) {
    throw new Error('witness timestamp must be a non-negative safe integer')
  }
  const publicKey = await ed.getPublicKeyAsync(options.privateKey)
  const keyId = checkpointKeyId(options.witnessName, publicKey)
  const signingInput = witnessCosignatureInput(options.checkpointBody, timestampSeconds)
  const signature = await ed.signAsync(signingInput, options.privateKey)
  const payload = new Uint8Array(76)
  payload.set(keyId, 0)
  new DataView(payload.buffer).setBigUint64(4, BigInt(timestampSeconds), false)
  payload.set(signature, 12)
  return `\u2014 ${options.witnessName} ${Buffer.from(payload).toString('base64')}\n`
}

export async function verifyCheckpointWitnessThreshold(
  note: string,
  options: VerifyWitnessThresholdOptions,
): Promise<WitnessThresholdVerification> {
  const requiredWitnesses = options.requiredWitnesses ?? 1
  if (!Number.isInteger(requiredWitnesses) || requiredWitnesses < 0) {
    throw new Error('requiredWitnesses must be a non-negative integer')
  }
  const operator = await verifyOperatorCheckpoint(note, options.operatorKey)
  if (!operator.valid || !operator.checkpoint) {
    return {
      operator,
      witnesses: [],
      validWitnesses: 0,
      requiredWitnesses,
      thresholdMet: false,
    }
  }

  const nowSeconds = options.nowSeconds ?? Math.floor(Date.now() / 1000)
  const maxAgeSeconds = options.maxAgeSeconds ?? 24 * 60 * 60
  const futureSkewSeconds = options.futureSkewSeconds ?? 5 * 60
  if (!Number.isSafeInteger(nowSeconds) || nowSeconds < 0) {
    throw new Error('nowSeconds must be a non-negative safe integer')
  }
  if (!Number.isSafeInteger(maxAgeSeconds) || maxAgeSeconds < 0) {
    throw new Error('maxAgeSeconds must be a non-negative safe integer')
  }
  if (!Number.isSafeInteger(futureSkewSeconds) || futureSkewSeconds < 0) {
    throw new Error('futureSkewSeconds must be a non-negative safe integer')
  }
  const trustedByIdentity = new Map<string, { key: TrustedCheckpointKey; publicKey: Uint8Array }>()
  for (const key of options.witnessKeys) {
    const publicKey = normalizePublicKey(key.publicKey)
    const keyId = Buffer.from(checkpointKeyId(key.name, publicKey)).toString('hex')
    trustedByIdentity.set(`${key.name}:${keyId}`, { key, publicKey })
  }

  const witnesses: WitnessCosignatureVerification[] = []
  const counted = new Set<string>()
  for (const line of operator.checkpoint.signatureLines) {
    const parsed = parseSignatureLine(line)
    if (!parsed || parsed.payload.length !== 76) continue
    const keyId = Buffer.from(parsed.payload.slice(0, 4)).toString('hex')
    const identity = `${parsed.name}:${keyId}`
    const trusted = trustedByIdentity.get(identity)
    if (!trusted) {
      witnesses.push({ name: parsed.name, keyId, valid: false, reason: 'untrusted witness key' })
      continue
    }
    const timestampBig = new DataView(
      parsed.payload.buffer,
      parsed.payload.byteOffset + 4,
      8,
    ).getBigUint64(0, false)
    if (timestampBig > BigInt(Number.MAX_SAFE_INTEGER)) {
      witnesses.push({ name: parsed.name, keyId, valid: false, reason: 'timestamp is too large' })
      continue
    }
    const timestampSeconds = Number(timestampBig)
    let reason: string | undefined
    if (timestampSeconds > nowSeconds + futureSkewSeconds)
      reason = 'witness timestamp is in the future'
    else if (nowSeconds - timestampSeconds > maxAgeSeconds) reason = 'witness cosignature is stale'
    else if (counted.has(identity)) reason = 'duplicate witness signature'

    const signatureValid =
      reason === undefined &&
      (await ed.verifyAsync(
        parsed.payload.slice(12),
        witnessCosignatureInput(operator.checkpoint.body, timestampSeconds),
        trusted.publicKey,
      ))
    if (!signatureValid && reason === undefined) reason = 'witness signature is invalid'
    if (reason === undefined) counted.add(identity)
    witnesses.push({
      name: parsed.name,
      keyId,
      timestampSeconds,
      valid: reason === undefined,
      ...(reason ? { reason } : {}),
    })
  }

  return {
    operator,
    witnesses,
    validWitnesses: counted.size,
    requiredWitnesses,
    thresholdMet: operator.valid && counted.size >= requiredWitnesses,
  }
}

export function witnessCosignatureInput(
  checkpointBody: string,
  timestampSeconds: number,
): Uint8Array {
  parseCheckpointBodyOnly(checkpointBody)
  if (!Number.isSafeInteger(timestampSeconds) || timestampSeconds < 0) {
    throw new Error('witness timestamp must be a non-negative safe integer')
  }
  return encoder.encode(`cosignature/v1\n${timestampSeconds}\n\n${checkpointBody}`)
}

/**
 * Compute an RFC 6962 root from hashes that have already passed through the
 * leaf domain separator. This is the form returned by a level-zero hash tile.
 */
export function checkpointRootFromLeafHashes(leafHashes: readonly Uint8Array[]): Uint8Array {
  if (leafHashes.length === 0) return sha256(new Uint8Array(0))
  for (const hash of leafHashes) {
    if (hash.length !== 32) throw new Error('checkpoint leaf hash must be 32 bytes')
  }
  return merkleHashFromLeafHashes(leafHashes)
}

/**
 * Verify a later tile snapshot against both the pinned prior checkpoint and
 * the new checkpoint. Matching both roots proves that the old leaf prefix was
 * preserved in the later view.
 */
export function verifyCheckpointConsistencyFromLeafHashes(
  prior: CheckpointView | undefined,
  current: CheckpointView,
  currentLeafHashes: readonly Uint8Array[],
): boolean {
  if (
    !Number.isSafeInteger(current.treeSize) ||
    current.treeSize < 1 ||
    current.rootHash.length !== 32 ||
    currentLeafHashes.length !== current.treeSize
  ) {
    return false
  }
  if (!bytesEqual(checkpointRootFromLeafHashes(currentLeafHashes), current.rootHash)) return false
  if (!prior) return true
  if (
    !Number.isSafeInteger(prior.treeSize) ||
    prior.treeSize < 1 ||
    prior.treeSize > current.treeSize ||
    prior.rootHash.length !== 32
  ) {
    return false
  }
  return bytesEqual(
    checkpointRootFromLeafHashes(currentLeafHashes.slice(0, prior.treeSize)),
    prior.rootHash,
  )
}

interface ParsedSignatureLine {
  name: string
  payload: Uint8Array
}

function parseSignatureLine(line: string): ParsedSignatureLine | undefined {
  const match = line.match(/^— (\S+) (\S+)$/)
  if (!match) return undefined
  try {
    return { name: match[1] as string, payload: decodeBase64(match[2] as string) }
  } catch {
    return undefined
  }
}

function parseCheckpointBodyOnly(body: string): void {
  if (!body.endsWith('\n') || body.includes('\n\n')) {
    throw new Error('checkpoint body must end in one newline and contain no blank line')
  }
  const lines = body.split('\n')
  const treeSize = Number(lines[1])
  if (
    lines.length !== 4 ||
    !lines[0] ||
    lines[0].includes('\r') ||
    !/^(0|[1-9]\d*)$/.test(lines[1] ?? '') ||
    !Number.isSafeInteger(treeSize) ||
    treeSize < 1 ||
    decodeBase64(lines[2] ?? '', 32, 'checkpoint root hash').length !== 32
  ) {
    throw new Error('checkpoint body is malformed')
  }
}

function normalizePublicKey(value: Uint8Array | string): Uint8Array {
  if (value instanceof Uint8Array) {
    if (value.length !== 32) throw new Error('checkpoint public key must be 32 bytes')
    return value
  }
  if (!/^[A-Za-z0-9_-]{43}$/.test(value)) {
    throw new Error('checkpoint public key must be canonical unpadded base64url')
  }
  const bytes = Buffer.from(value, 'base64url')
  if (bytes.length !== 32) throw new Error('checkpoint public key must decode to 32 bytes')
  return new Uint8Array(bytes)
}

function decodeBase64(value: string, length?: number, label = 'base64 value'): Uint8Array {
  if (!BASE64_PATTERN.test(value) || value.length % 4 !== 0) {
    throw new Error(`${label} is not canonical base64`)
  }
  const bytes = new Uint8Array(Buffer.from(value, 'base64'))
  if (Buffer.from(bytes).toString('base64') !== value) {
    throw new Error(`${label} is not canonical base64`)
  }
  if (length !== undefined && bytes.length !== length) {
    throw new Error(`${label} must decode to ${length} bytes`)
  }
  return bytes
}

function largestPowerOfTwoLessThan(value: number): number {
  let power = 1
  while (power * 2 < value) power *= 2
  return power
}

function merkleHashFromLeafHashes(hashes: readonly Uint8Array[]): Uint8Array {
  if (hashes.length === 1) return hashes[0] as Uint8Array
  const split = largestPowerOfTwoLessThan(hashes.length)
  return nodeHash(
    merkleHashFromLeafHashes(hashes.slice(0, split)),
    merkleHashFromLeafHashes(hashes.slice(split)),
  )
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false
  let difference = 0
  for (let index = 0; index < left.length; index += 1) {
    difference |= (left[index] as number) ^ (right[index] as number)
  }
  return difference === 0
}
