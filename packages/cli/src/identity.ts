// SPDX-License-Identifier: Apache-2.0

/**
 * Named identity profiles for the operator CLI.
 *
 * A profile makes the existing atrib identity chain usable without changing
 * its trust model:
 *
 *   named principal/workspace/agent claim -> principal key -> run certificate
 *   -> ephemeral run key -> signed records
 *
 * The profile file contains no secret. Its semantic identity fields live in a
 * principal-signed IdentityClaim so a verifier can inspect them offline. The
 * key source only tells the local CLI where the principal seed is kept.
 */

import {
  closeSync,
  chmodSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { signClaim, verifyClaimSignature } from '@atrib/directory'
import type { IdentityClaim } from '@atrib/directory'
import {
  base64urlEncode,
  buildRunKeyRevocationRecord,
  canonicalRecord,
  delegationCertErrors,
  delegationCertHash,
  getPublicKey,
  hexEncode,
  issueDelegationCertificate,
  sha256,
  verifyRecord,
} from '@atrib/mcp'
import type { DelegationCertificate, DelegationScope, RunKeyRevocationRecord } from '@atrib/mcp'

export const IDENTITY_PROFILE_SCHEMA = 'atrib.identity-profile.v1'
const PROFILE_NAME_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/
const encoder = new TextEncoder()

export type PrincipalKind = 'human' | 'organization'

export type IdentityKeySource =
  | {
      kind: 'macos-keychain'
      service: string
      account: string
    }
  | {
      kind: 'key-file'
      path: string
    }

export interface NamedIdentity {
  id: string
  name: string
}

export interface IdentityProfile {
  schema: typeof IDENTITY_PROFILE_SCHEMA
  profile_name: string
  principal: {
    kind: PrincipalKind
    name: string
    public_key: string
  }
  workspace: NamedIdentity
  agent: NamedIdentity & { role: 'agent' }
  key_source: IdentityKeySource
  signed_claim: IdentityClaim
  active_run?: IdentityActiveRun
  revoked_runs?: IdentityRunRevocation[]
  created_at_ms: number
  updated_at_ms: number
}

export interface CreateIdentityProfileOptions {
  profileName: string
  principalKind: PrincipalKind
  principalName: string
  workspaceName: string
  agentName: string
  principalSeed: Uint8Array
  keySource: IdentityKeySource
  nowMs?: number
  createdAtMs?: number
}

export interface IdentityRun {
  context_id: string
  run_seed: Uint8Array
  certificate: DelegationCertificate
}

export interface IdentityActiveRun {
  run_pubkey: string
  context_id: string
  certificate: DelegationCertificate
  certificate_hash: string
  issued_at_ms: number
  not_after_ms: number
}

export type IdentityRunRevocationRecord = RunKeyRevocationRecord

export interface IdentityRunRevocation {
  revoked_key: string
  successor_run_pubkey: string
  certificate: DelegationCertificate
  certificate_hash: string
  record: IdentityRunRevocationRecord
  record_hash: string
  log_index: number
  log_endpoint: string
}

export interface IdentityRunRotation {
  active_run: IdentityActiveRun
  revocation?: IdentityRunRevocation
}

function requireNonEmpty(value: string, field: string): string {
  const normalized = value.trim()
  if (!normalized) throw new Error(`${field} must not be empty`)
  if (/[\u0000-\u001f\u007f]/.test(normalized)) {
    throw new Error(`${field} must not contain control characters`)
  }
  if (normalized.length > 256) {
    throw new Error(`${field} must not exceed 256 characters`)
  }
  return normalized
}

export function validateProfileName(value: string): string {
  if (!PROFILE_NAME_PATTERN.test(value)) {
    throw new Error(
      'profile name must start with a lowercase letter or digit and contain only lowercase letters, digits, ".", "_", or "-" (max 64 chars)',
    )
  }
  return value
}

function deriveNamedId(
  prefix: 'atrw' | 'atra',
  principalKey: string,
  parent: string,
  name: string,
): string {
  const digest = sha256(
    encoder.encode(
      `${IDENTITY_PROFILE_SCHEMA}\u0000${prefix}\u0000${principalKey}\u0000${parent}\u0000${name}`,
    ),
  )
  return `${prefix}_${base64urlEncode(digest).slice(0, 22)}`
}

export function identityProfileDirectory(): string {
  return resolve(homedir(), '.atrib', 'identities')
}

export function identityProfilePath(
  profileName: string,
  baseDirectory = identityProfileDirectory(),
): string {
  return resolve(baseDirectory, `${validateProfileName(profileName)}.json`)
}

export async function createIdentityProfile(
  options: CreateIdentityProfileOptions,
): Promise<IdentityProfile> {
  const profileName = validateProfileName(options.profileName)
  const principalName = requireNonEmpty(options.principalName, 'principal name')
  const workspaceName = requireNonEmpty(options.workspaceName, 'workspace name')
  const agentName = requireNonEmpty(options.agentName, 'agent name')
  if (!(options.principalSeed instanceof Uint8Array) || options.principalSeed.length !== 32) {
    throw new Error('principal seed must be a 32-byte Ed25519 seed')
  }

  const principalKey = base64urlEncode(await getPublicKey(options.principalSeed))
  const workspaceId = deriveNamedId('atrw', principalKey, principalName, workspaceName)
  const agentId = deriveNamedId('atra', principalKey, workspaceId, agentName)
  const signedClaim = await signClaim(
    {
      creator_key: principalKey,
      claim_type: 'self_attested',
      claim_method: 'self',
      claim_subject: {
        identity_profile: IDENTITY_PROFILE_SCHEMA,
        principal: {
          kind: options.principalKind,
          name: principalName,
        },
        workspace: {
          id: workspaceId,
          name: workspaceName,
        },
        agent: {
          id: agentId,
          name: agentName,
          role: 'agent',
        },
      },
    },
    options.principalSeed,
  )
  const nowMs = options.nowMs ?? Date.now()

  return {
    schema: IDENTITY_PROFILE_SCHEMA,
    profile_name: profileName,
    principal: {
      kind: options.principalKind,
      name: principalName,
      public_key: principalKey,
    },
    workspace: {
      id: workspaceId,
      name: workspaceName,
    },
    agent: {
      id: agentId,
      name: agentName,
      role: 'agent',
    },
    key_source: options.keySource,
    signed_claim: signedClaim,
    created_at_ms: options.createdAtMs ?? nowMs,
    updated_at_ms: nowMs,
  }
}

function assertIdentityProfile(value: unknown): asserts value is IdentityProfile {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('identity profile must be a JSON object')
  }
  const profile = value as Partial<IdentityProfile>
  if (profile.schema !== IDENTITY_PROFILE_SCHEMA) {
    throw new Error(`unsupported identity profile schema: ${String(profile.schema)}`)
  }
  validateProfileName(String(profile.profile_name))
  if (
    typeof profile.principal?.name !== 'string' ||
    (profile.principal.kind !== 'human' && profile.principal.kind !== 'organization') ||
    typeof profile.principal.public_key !== 'string' ||
    typeof profile.workspace?.id !== 'string' ||
    typeof profile.workspace.name !== 'string' ||
    typeof profile.agent?.id !== 'string' ||
    typeof profile.agent.name !== 'string' ||
    profile.agent.role !== 'agent' ||
    typeof profile.signed_claim !== 'object' ||
    profile.signed_claim === null
  ) {
    throw new Error('identity profile is missing required identity fields')
  }
  if (profile.key_source?.kind !== 'macos-keychain' && profile.key_source?.kind !== 'key-file') {
    throw new Error('identity profile has an unsupported key source')
  }
  if (profile.active_run !== undefined) {
    if (
      typeof profile.active_run.run_pubkey !== 'string' ||
      typeof profile.active_run.context_id !== 'string' ||
      typeof profile.active_run.certificate !== 'object' ||
      profile.active_run.certificate === null ||
      typeof profile.active_run.certificate_hash !== 'string' ||
      !Number.isSafeInteger(profile.active_run.issued_at_ms) ||
      !Number.isSafeInteger(profile.active_run.not_after_ms)
    ) {
      throw new Error('identity profile has a malformed active run')
    }
  }
  if (
    profile.revoked_runs !== undefined &&
    (!Array.isArray(profile.revoked_runs) ||
      profile.revoked_runs.some(
        (entry) =>
          typeof entry.revoked_key !== 'string' ||
          typeof entry.successor_run_pubkey !== 'string' ||
          typeof entry.certificate !== 'object' ||
          entry.certificate === null ||
          typeof entry.certificate_hash !== 'string' ||
          typeof entry.record !== 'object' ||
          entry.record === null ||
          typeof entry.record_hash !== 'string' ||
          !Number.isSafeInteger(entry.log_index) ||
          typeof entry.log_endpoint !== 'string',
      ))
  ) {
    throw new Error('identity profile has malformed run revocations')
  }
}

export function loadIdentityProfile(path: string): IdentityProfile {
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
  assertIdentityProfile(parsed)
  return parsed
}

export function identityProfileExists(path: string): boolean {
  return existsSync(path)
}

export function saveIdentityProfile(path: string, profile: IdentityProfile): void {
  assertIdentityProfile(profile)
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const temporaryPath = `${path}.tmp-${process.pid}`
  const fd = openSync(temporaryPath, 'w', 0o600)
  try {
    writeSync(fd, `${JSON.stringify(profile, null, 2)}\n`)
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
  chmodSync(temporaryPath, 0o600)
  renameSync(temporaryPath, path)
}

export async function withIdentityProfileLock<T>(
  path: string,
  operation: () => Promise<T>,
): Promise<T> {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const lockPath = `${path}.lock`
  let fd: number
  try {
    fd = openSync(lockPath, 'wx', 0o600)
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'EEXIST') {
      throw new Error(
        `identity profile is locked by another rotation: ${lockPath}. Remove a stale lock only after confirming no identity command is running.`,
      )
    }
    throw error
  }
  try {
    writeSync(fd, `${JSON.stringify({ pid: process.pid, started_at_ms: Date.now() })}\n`)
    fsyncSync(fd)
    return await operation()
  } finally {
    closeSync(fd)
    unlinkSync(lockPath)
  }
}

export async function identityProfileErrors(
  profile: IdentityProfile,
  principalSeed?: Uint8Array,
): Promise<string[]> {
  const errors: string[] = []
  if (!(await verifyClaimSignature(profile.signed_claim))) {
    errors.push('identity_claim_signature_invalid')
  }
  if (profile.signed_claim.creator_key !== profile.principal.public_key) {
    errors.push('claim_principal_mismatch')
  }
  const subject = profile.signed_claim.claim_subject
  const claimedPrincipal = subject.principal
  const claimedWorkspace = subject.workspace
  const claimedAgent = subject.agent
  if (
    !isRecord(claimedPrincipal) ||
    claimedPrincipal.kind !== profile.principal.kind ||
    claimedPrincipal.name !== profile.principal.name ||
    !isRecord(claimedWorkspace) ||
    claimedWorkspace.id !== profile.workspace.id ||
    claimedWorkspace.name !== profile.workspace.name ||
    !isRecord(claimedAgent) ||
    claimedAgent.id !== profile.agent.id ||
    claimedAgent.name !== profile.agent.name ||
    claimedAgent.role !== profile.agent.role ||
    subject.identity_profile !== profile.schema
  ) {
    errors.push('profile_claim_subject_mismatch')
  }
  const expectedWorkspaceId = deriveNamedId(
    'atrw',
    profile.principal.public_key,
    profile.principal.name,
    profile.workspace.name,
  )
  const expectedAgentId = deriveNamedId(
    'atra',
    profile.principal.public_key,
    expectedWorkspaceId,
    profile.agent.name,
  )
  if (profile.workspace.id !== expectedWorkspaceId || profile.agent.id !== expectedAgentId) {
    errors.push('derived_identity_id_mismatch')
  }
  if (principalSeed !== undefined) {
    if (principalSeed.length !== 32) {
      errors.push('principal_seed_malformed')
    } else {
      const derived = base64urlEncode(await getPublicKey(principalSeed))
      if (derived !== profile.principal.public_key) errors.push('key_source_principal_mismatch')
    }
  }
  if (profile.active_run !== undefined) {
    const certificateErrors = await delegationCertErrors(profile.active_run.certificate)
    if (certificateErrors.length > 0) errors.push('active_run_certificate_invalid')
    if (
      profile.active_run.certificate.principal_key !== profile.principal.public_key ||
      profile.active_run.certificate.run_pubkey !== profile.active_run.run_pubkey ||
      profile.active_run.certificate.context_id !== profile.active_run.context_id ||
      profile.active_run.certificate.not_after !== profile.active_run.not_after_ms ||
      delegationCertHash(profile.active_run.certificate) !== profile.active_run.certificate_hash
    ) {
      errors.push('active_run_certificate_mismatch')
    }
  }
  for (const revocation of profile.revoked_runs ?? []) {
    if (
      !(await verifyRecord(revocation.record)) ||
      (await delegationCertErrors(revocation.certificate)).length > 0 ||
      revocation.certificate.principal_key !== profile.principal.public_key ||
      revocation.certificate.run_pubkey !== revocation.revoked_key ||
      delegationCertHash(revocation.certificate) !== revocation.certificate_hash ||
      revocation.record.creator_key !== profile.principal.public_key ||
      revocation.record.revoked_key !== revocation.revoked_key ||
      revocation.record.revocation_reason !== 'retirement' ||
      revocation.record.delegation_cert_hash !== revocation.certificate_hash ||
      `sha256:${hexEncode(sha256(canonicalRecord(revocation.record)))}` !== revocation.record_hash
    ) {
      errors.push('run_revocation_invalid')
      break
    }
  }
  return errors
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export async function issueIdentityRun(
  profile: IdentityProfile,
  principalSeed: Uint8Array,
  options: {
    contextId: string
    ttlSeconds: number
    notBeforeMs?: number
    scope?: DelegationScope
    runSeed?: Uint8Array
  },
): Promise<IdentityRun> {
  const profileErrors = await identityProfileErrors(profile, principalSeed)
  if (profileErrors.length > 0) {
    throw new Error(`identity profile verification failed: ${profileErrors.join(', ')}`)
  }
  if (!/^[0-9a-f]{32}$/.test(options.contextId)) {
    throw new Error('contextId must be 32 lowercase hex chars')
  }
  if (!Number.isSafeInteger(options.ttlSeconds) || options.ttlSeconds < 1) {
    throw new Error('ttlSeconds must be a positive integer')
  }
  const notBefore = options.notBeforeMs ?? Date.now()
  const notAfter = notBefore + options.ttlSeconds * 1000
  if (!Number.isSafeInteger(notAfter)) {
    throw new Error('run validity window exceeds the safe integer range')
  }
  const runSeed = options.runSeed ?? crypto.getRandomValues(new Uint8Array(32))
  if (runSeed.length !== 32) throw new Error('run seed must be 32 bytes')
  const runPubkey = base64urlEncode(await getPublicKey(runSeed))
  const certificate = await issueDelegationCertificate(principalSeed, {
    run_pubkey: runPubkey,
    context_id: options.contextId,
    not_before: notBefore,
    not_after: notAfter,
    ...(options.scope ? { scope: options.scope } : {}),
  })
  return {
    context_id: options.contextId,
    run_seed: runSeed,
    certificate,
  }
}

export function identityActiveRun(run: IdentityRun): IdentityActiveRun {
  return {
    run_pubkey: run.certificate.run_pubkey,
    context_id: run.context_id,
    certificate: run.certificate,
    certificate_hash: delegationCertHash(run.certificate),
    issued_at_ms: run.certificate.not_before ?? 0,
    not_after_ms: run.certificate.not_after,
  }
}

export function identityRevokedKeys(profile: IdentityProfile): ReadonlySet<string> {
  return new Set((profile.revoked_runs ?? []).map((entry) => entry.revoked_key))
}

export function identityDelegationCertificates(
  profile: IdentityProfile,
): readonly DelegationCertificate[] {
  return [
    ...(profile.active_run ? [profile.active_run.certificate] : []),
    ...(profile.revoked_runs ?? []).map((entry) => entry.certificate),
  ]
}

export function identityRevocationEvidence(
  profile: IdentityProfile,
): ReadonlyArray<{ record: IdentityRunRevocationRecord; log_index: number }> {
  return (profile.revoked_runs ?? []).map((entry) => ({
    record: entry.record,
    log_index: entry.log_index,
  }))
}

export async function rotateIdentityRun(
  profile: IdentityProfile,
  principalSeed: Uint8Array,
  nextRun: IdentityRun,
  options: {
    logEndpoint: string
    nowMs?: number
    contextId?: string
    fetchImpl?: typeof fetch
  },
): Promise<IdentityRunRotation> {
  const activeRun = identityActiveRun(nextRun)
  const previous = profile.active_run
  if (previous === undefined) return { active_run: activeRun }
  if (previous.run_pubkey === activeRun.run_pubkey) {
    throw new Error('identity rotation requires a fresh successor run key')
  }

  const nowMs = options.nowMs ?? Date.now()
  const contextId = options.contextId ?? crypto.getRandomValues(new Uint8Array(16))
  const revocationContext = typeof contextId === 'string' ? contextId : hexEncode(contextId)
  if (!/^[0-9a-f]{32}$/.test(revocationContext)) {
    throw new Error('identity rotation context must be 32 lowercase hex chars')
  }
  const record = await buildRunKeyRevocationRecord(principalSeed, {
    certificate: previous.certificate,
    content_id: `sha256:${hexEncode(
      sha256(
        encoder.encode(
          `${IDENTITY_PROFILE_SCHEMA}\u0000retire-run\u0000${previous.run_pubkey}\u0000${activeRun.run_pubkey}`,
        ),
      ),
    )}`,
    context_id: revocationContext,
    timestamp: nowMs,
    revocation_reason: 'retirement',
  })
  const recordHash = `sha256:${hexEncode(sha256(canonicalRecord(record)))}`
  const endpoint = options.logEndpoint.replace(/\/$/, '')
  const response = await (options.fetchImpl ?? fetch)(`${endpoint}/entries`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(record),
  })
  const responseBody = (await response.json().catch(() => ({}))) as Record<string, unknown>
  if (!response.ok) {
    throw new Error(
      `identity run revocation submit failed (${response.status}): ${JSON.stringify(responseBody)}`,
    )
  }
  if (!Number.isSafeInteger(responseBody.log_index) || (responseBody.log_index as number) < 0) {
    throw new Error('identity run revocation response omitted a valid log_index')
  }
  return {
    active_run: activeRun,
    revocation: {
      revoked_key: previous.run_pubkey,
      successor_run_pubkey: activeRun.run_pubkey,
      certificate: previous.certificate,
      certificate_hash: previous.certificate_hash,
      record,
      record_hash: recordHash,
      log_index: responseBody.log_index as number,
      log_endpoint: endpoint,
    },
  }
}
