// SPDX-License-Identifier: Apache-2.0

import * as secp from '@noble/secp256k1'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'
import { sha256 } from '@noble/hashes/sha2.js'

const HEX_32 = /^[0-9a-f]{64}$/
const HEX_64 = /^[0-9a-f]{128}$/
const CANONICAL_DECIMAL = /^(0|[1-9][0-9]*)$/

export interface NostrEvent {
  id: string
  pubkey: string
  created_at: number
  kind: number
  tags: string[][]
  content: string
  sig: string
}

export type NostrUnsignedEvent = Omit<NostrEvent, 'id' | 'sig'>

export interface NostrEventVerification {
  valid: boolean
  shape_valid: boolean
  event_id_valid: boolean
  signature_valid: boolean
  derived_event_id: string | null
  errors: string[]
}

export interface BuzzOwnerAttestationVerification {
  present: boolean
  valid: boolean
  owner_pubkey: string | null
  conditions: string | null
  conditions_valid: boolean
  conditions_satisfied: boolean
  signature_valid: boolean
  errors: string[]
  warnings: string[]
}

export interface BuzzEventVerification {
  valid: boolean
  event: NostrEventVerification
  owner_attestation: BuzzOwnerAttestationVerification
  errors: string[]
  warnings: string[]
}

export interface VerifyBuzzEventOptions {
  require_owner_attestation?: boolean
  expected_owner_pubkey?: string
}

function isSafeUint(value: unknown, max: number): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= max
}

function isTagList(value: unknown): value is string[][] {
  return (
    Array.isArray(value) &&
    value.every(
      (tag) =>
        Array.isArray(tag) && tag.length > 0 && tag.every((part) => typeof part === 'string'),
    )
  )
}

function validateUnsignedNostrEventShape(event: unknown): string[] {
  if (event === null || typeof event !== 'object' || Array.isArray(event)) {
    return ['event_shape']
  }
  const value = event as Record<string, unknown>
  const errors: string[] = []
  if (typeof value.pubkey !== 'string' || !HEX_32.test(value.pubkey)) {
    errors.push('author_pubkey_format')
  }
  if (!isSafeUint(value.created_at, 4_294_967_295)) errors.push('created_at_format')
  if (!isSafeUint(value.kind, 65_535)) errors.push('kind_format')
  if (!isTagList(value.tags)) errors.push('tags_format')
  if (typeof value.content !== 'string') errors.push('content_format')
  return errors
}

function validateNostrEventShape(event: unknown): string[] {
  const errors = validateUnsignedNostrEventShape(event)
  if (event === null || typeof event !== 'object' || Array.isArray(event)) return errors
  const value = event as Record<string, unknown>
  if (typeof value.id !== 'string' || !HEX_32.test(value.id)) errors.push('event_id_format')
  if (typeof value.sig !== 'string' || !HEX_64.test(value.sig)) errors.push('signature_format')
  return errors
}

/**
 * Derive a NIP-01 event ID from the exact six-field serialization.
 *
 * This accepts only a shape-valid event because JavaScript coercion would
 * otherwise make malformed values appear canonical.
 */
export function deriveNostrEventId(event: NostrUnsignedEvent): string {
  const shapeErrors = validateUnsignedNostrEventShape(event)
  if (shapeErrors.length > 0) {
    throw new Error(`invalid Nostr event shape: ${shapeErrors.join(',')}`)
  }
  const serialized = JSON.stringify([
    0,
    event.pubkey,
    event.created_at,
    event.kind,
    event.tags,
    event.content,
  ])
  return bytesToHex(sha256(new TextEncoder().encode(serialized)))
}

/** Verify NIP-01 shape, event ID, and BIP-340 Schnorr signature. */
export async function verifyNostrEvent(event: unknown): Promise<NostrEventVerification> {
  const errors = validateNostrEventShape(event)
  if (errors.length > 0) {
    return {
      valid: false,
      shape_valid: false,
      event_id_valid: false,
      signature_valid: false,
      derived_event_id: null,
      errors,
    }
  }

  const typed = event as NostrEvent
  const derivedEventId = deriveNostrEventId(typed)
  const eventIdValid = typed.id === derivedEventId
  if (!eventIdValid) errors.push('event_id_mismatch')

  let signatureValid = false
  if (eventIdValid) {
    try {
      signatureValid = await secp.schnorr.verifyAsync(
        hexToBytes(typed.sig),
        hexToBytes(typed.id),
        hexToBytes(typed.pubkey),
      )
    } catch {
      signatureValid = false
    }
  }
  if (!signatureValid) errors.push('signature_invalid')

  return {
    valid: errors.length === 0,
    shape_valid: true,
    event_id_valid: eventIdValid,
    signature_valid: signatureValid,
    derived_event_id: derivedEventId,
    errors,
  }
}

interface ParsedBuzzCondition {
  field: 'kind' | 'created_at'
  operator: '=' | '<' | '>'
  value: number
}

function parseBuzzConditions(conditions: string): {
  valid: boolean
  clauses: ParsedBuzzCondition[]
  errors: string[]
} {
  if (conditions === '') return { valid: true, clauses: [], errors: [] }
  if (!/^[\x21-\x7e]+$/.test(conditions)) {
    return { valid: false, clauses: [], errors: ['auth_conditions_ascii'] }
  }

  const clauses: ParsedBuzzCondition[] = []
  const errors: string[] = []
  for (const clause of conditions.split('&')) {
    if (clause === '') {
      errors.push('auth_condition_empty')
      continue
    }
    const match = /^(kind=|created_at<|created_at>)([0-9]+)$/.exec(clause)
    if (!match) {
      errors.push('auth_condition_unsupported')
      continue
    }
    const operator = match[1]!
    const encoded = match[2]!
    if (!CANONICAL_DECIMAL.test(encoded)) {
      errors.push('auth_condition_decimal')
      continue
    }
    const value = Number(encoded)
    if (!Number.isSafeInteger(value)) {
      errors.push('auth_condition_range')
      continue
    }
    if (operator === 'kind=') {
      if (value > 65_535) {
        errors.push('auth_condition_range')
      } else {
        clauses.push({ field: 'kind', operator: '=', value })
      }
    } else if (value > 4_294_967_295) {
      errors.push('auth_condition_range')
    } else {
      clauses.push({
        field: 'created_at',
        operator: operator === 'created_at<' ? '<' : '>',
        value,
      })
    }
  }
  return { valid: errors.length === 0, clauses, errors }
}

function buzzConditionsSatisfied(event: NostrEvent, clauses: ParsedBuzzCondition[]): boolean {
  return clauses.every((clause) => {
    const actual = clause.field === 'kind' ? event.kind : event.created_at
    if (clause.operator === '=') return actual === clause.value
    if (clause.operator === '<') return actual < clause.value
    return actual > clause.value
  })
}

/**
 * Verify Buzz NIP-OA owner attestation on an already shape-valid Nostr event.
 *
 * NIP-OA authorizes an independent agent key. It never changes event
 * authorship. Its created_at clauses constrain a signer-controlled event field,
 * not wall-clock time.
 */
export async function verifyBuzzOwnerAttestation(
  event: NostrEvent,
): Promise<BuzzOwnerAttestationVerification> {
  const authTags = event.tags.filter((tag) => tag[0] === 'auth')
  const absent: BuzzOwnerAttestationVerification = {
    present: false,
    valid: false,
    owner_pubkey: null,
    conditions: null,
    conditions_valid: false,
    conditions_satisfied: false,
    signature_valid: false,
    errors: [],
    warnings: [],
  }
  if (authTags.length === 0) return absent

  const errors: string[] = []
  const warnings = [
    'created_at conditions constrain the agent-declared event timestamp, not wall-clock time',
  ]
  if (authTags.length !== 1) {
    return {
      ...absent,
      present: true,
      errors: ['multiple_auth_tags'],
      warnings,
    }
  }

  const auth = authTags[0]!
  if (auth.length !== 4) {
    return {
      ...absent,
      present: true,
      errors: ['auth_tag_shape'],
      warnings,
    }
  }

  const ownerPubkey = auth[1]!
  const conditions = auth[2]!
  const ownerSignature = auth[3]!
  if (!HEX_32.test(ownerPubkey)) errors.push('owner_pubkey_format')
  if (ownerPubkey === event.pubkey) errors.push('owner_matches_agent')
  if (!HEX_64.test(ownerSignature)) errors.push('owner_signature_format')

  const parsed = parseBuzzConditions(conditions)
  errors.push(...parsed.errors)
  const conditionsSatisfied = parsed.valid && buzzConditionsSatisfied(event, parsed.clauses)
  if (parsed.valid && !conditionsSatisfied) errors.push('auth_conditions_unsatisfied')

  let signatureValid = false
  if (
    HEX_32.test(ownerPubkey) &&
    ownerPubkey !== event.pubkey &&
    HEX_64.test(ownerSignature) &&
    parsed.valid
  ) {
    const message = new TextEncoder().encode(`nostr:agent-auth:${event.pubkey}:${conditions}`)
    try {
      signatureValid = await secp.schnorr.verifyAsync(
        hexToBytes(ownerSignature),
        sha256(message),
        hexToBytes(ownerPubkey),
      )
    } catch {
      signatureValid = false
    }
  }
  if (!signatureValid) errors.push('owner_signature_invalid')

  return {
    present: true,
    valid: errors.length === 0,
    owner_pubkey: HEX_32.test(ownerPubkey) ? ownerPubkey : null,
    conditions,
    conditions_valid: parsed.valid,
    conditions_satisfied: conditionsSatisfied,
    signature_valid: signatureValid,
    errors: [...new Set(errors)],
    warnings,
  }
}

/**
 * Verify the cryptographic claims available from a Buzz event itself.
 *
 * Community admission, relay acceptance, audit-chain insertion, persistence,
 * observer completeness, and runtime execution are outside this input and are
 * intentionally not inferred from a valid event or owner attestation.
 */
export async function verifyBuzzEvent(
  event: unknown,
  options: VerifyBuzzEventOptions = {},
): Promise<BuzzEventVerification> {
  const eventVerification = await verifyNostrEvent(event)
  if (!eventVerification.shape_valid) {
    return {
      valid: false,
      event: eventVerification,
      owner_attestation: {
        present: false,
        valid: false,
        owner_pubkey: null,
        conditions: null,
        conditions_valid: false,
        conditions_satisfied: false,
        signature_valid: false,
        errors: ['event_shape'],
        warnings: [],
      },
      errors: [...eventVerification.errors],
      warnings: [],
    }
  }

  const ownerAttestation = await verifyBuzzOwnerAttestation(event as NostrEvent)
  const errors = [...eventVerification.errors]
  if (options.require_owner_attestation && !ownerAttestation.present) {
    errors.push('owner_attestation_missing')
  } else if (ownerAttestation.present && !ownerAttestation.valid) {
    errors.push(...ownerAttestation.errors)
  }
  if (
    options.expected_owner_pubkey !== undefined &&
    ownerAttestation.owner_pubkey !== options.expected_owner_pubkey
  ) {
    errors.push('owner_pubkey_mismatch')
  }

  const warnings = [...ownerAttestation.warnings]
  warnings.push(
    'event verification does not prove Buzz community admission, relay retention, audit inclusion, or runtime execution',
  )

  return {
    valid: errors.length === 0,
    event: eventVerification,
    owner_attestation: ownerAttestation,
    errors: [...new Set(errors)],
    warnings,
  }
}
