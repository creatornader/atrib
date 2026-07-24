#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0

/**
 * atrib CLI entry point (§5.6.1).
 *
 * Subcommands:
 *   keygen [--keychain] [--service NAME]    Generate an Ed25519 keypair.
 *   export-pubkey --keychain [--service NAME]   Print the pubkey for a Keychain entry.
 *   delete-key --keychain [--service NAME]   Remove a Keychain entry.
 *   delegate [--keychain [--service NAME] | --key-file PATH] --scope PATH --ttl SECONDS
 *            [--context HEX] [--not-before UNIX_MS]
 *                                            Issue a §1.11 certificate for
 *                                            a new ephemeral run key.
 *   publish-claim --keychain [--service NAME] [--display-name NAME] [--organization ORG] [--email EMAIL] [--url URL]
 *                  [--directory URL] [--capabilities-file PATH] [--tool-names CSV] [--event-types CSV]
 *                  [--max-amount-currency USD --max-amount-value 100] [--counterparties CSV] [--expires-at ISO8601]
 *                                            Publish an IdentityClaim (§6.1) to the
 *                                            directory, optionally with a §6.7 capability
 *                                            envelope. Reads the seed from Keychain.
 *   identity init --principal NAME --workspace NAME --agent NAME
 *                 [--profile NAME] [--principal-kind human|organization]
 *                 [--scope PATH] [--ttl SECONDS] [--context HEX] [--log URL] [--publish]
 *                                            Create or recover a named identity
 *                                            profile and issue an ephemeral run.
 *   identity show [--profile NAME]            Inspect and verify a named profile.
 */

import {
  isKeychainSupported,
  KeychainError,
  KeychainNotSupportedError,
  loadSeed,
  resolveServiceAccount,
  storeSeed,
  deleteSeed,
} from './keychain.js'
import { keygen, printKeypair } from './keygen.js'
import {
  base64urlDecode,
  base64urlEncode,
  canonicalRecord,
  genesisChainRoot,
  getPublicKey,
  hexEncode,
  issueDelegationCertificate,
  sha256,
  signRecord,
} from '@atrib/mcp'
import type { AtribRecord, DelegationScope } from '@atrib/mcp'
import { signClaim } from '@atrib/directory'
import type { IdentityClaim, CapabilityEnvelope } from '@atrib/directory'
import { readFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { resolve } from 'node:path'
import {
  createIdentityProfile,
  identityProfileErrors,
  identityProfileExists,
  identityProfilePath,
  identityRevokedKeys,
  issueIdentityRun,
  loadIdentityProfile,
  rotateIdentityRun,
  saveIdentityProfile,
  withIdentityProfileLock,
} from './identity.js'
import type { IdentityKeySource, IdentityProfile, PrincipalKind } from './identity.js'

const VERSION = '0.2.1'

const HELP = `atrib CLI v${VERSION}

Usage:
  atrib keygen [--keychain] [--service NAME]
      Generate an Ed25519 keypair. Without --keychain, prints both keys to
      stdout in env-var format. With --keychain (macOS only), the seed is
      stored in the Keychain and only the public key is printed.

  atrib export-pubkey --keychain [--service NAME]
      Read a seed from Keychain and print the derived public key only.

  atrib delete-key --keychain [--service NAME]
      Remove a Keychain entry.

  atrib delegate [--keychain [--service NAME] | --key-file PATH] --scope PATH --ttl SECONDS [--context HEX] [--not-before UNIX_MS]
      Generate an ephemeral run key and issue a §1.11 delegation certificate
      signed by the principal key. The principal defaults to the macOS
      Keychain service "atrib-creator"; --key-file is the fallback. Prints
      ATRIB_KEY with the run seed and ATRIB_DELEGATION_CERT with the base64url-
      encoded certificate JSON for injection into the delegated process.

  atrib revoke {--keychain [--service NAME] | --key-file PATH} --reason {rotation|retirement|compromise} [--successor PUBKEY] [--log URL] [--context-id HEX] [--dry-run]
      Submit a §1.9 key_revocation record signed by the key being retired.
      --reason rotation requires --successor (the new active key).
      The retired key remains valid for any record with log_index < the
      revocation's log_index; later records signed by it are flagged
      'revoked_after_revocation' by §1.9.3-aware verifiers.

  atrib publish-claim {--keychain [--service NAME] | --key-file PATH} [options]
      Publish an IdentityClaim (§6.1) to a directory, optionally with a
      §6.7 capability envelope (D051). Reads the signing seed from
      Keychain or a base64url-encoded file. Subject options:
          --display-name NAME      Human-readable name (most common)
          --organization ORG       Organization name
          --email EMAIL            Contact email
          --url URL                Homepage URL
          --handle HANDLE          Social handle (e.g., @atrib)
      Capability envelope options (all optional):
          --capabilities-file PATH JSON file with the full envelope
          --tool-names CSV         Comma-separated allowed tool names
          --event-types CSV        Comma-separated allowed event types
          --counterparties CSV     Comma-separated counterparty keys
          --max-amount-currency C  Currency code (e.g., USD)
          --max-amount-value N     Numeric amount (requires --max-amount-currency)
          --expires-at ISO8601     Capability expiration (e.g., 2027-01-01T00:00:00Z)
      Where to publish:
          --directory URL          Default: https://directory.atrib.dev/v6
          --dry-run                Print the signed claim without POSTing

  atrib identity init --principal NAME --workspace NAME --agent NAME [options]
      Create or recover a named principal, workspace, and agent profile, then
      issue a fresh context-bound run key and §1.11 certificate. The principal
      seed stays in Keychain. The output carries a signed identity claim plus
      the ephemeral run credentials for process injection.
          --profile NAME           Local profile name (default: default)
          --principal-kind KIND    human or organization (default: human)
          --scope PATH             Optional §6.7 run-scope JSON
          --ttl SECONDS            Run lifetime (default: 3600)
          --context HEX            Optional 32-hex context (generated by default)
          --log URL                Revocation log for repeat runs
                                   (default: https://log.atrib.dev/v1)
          --publish                Publish the signed principal claim
          --directory URL          Default: https://directory.atrib.dev/v6
          --profile-dir PATH       Override local profile directory

  atrib identity show [--profile NAME] [--profile-dir PATH]
      Print the named identity, role chain, signed-claim state, and local key
      match. The profile file contains no private key.

  atrib help                  Show this help message
  atrib --version             Show version

Defaults:
  --service defaults to "atrib-creator". Use a custom name when running
  multiple agents on one machine, or for merchant/witness keys.

Notes:
  Keychain mode shells out to /usr/bin/security and is currently macOS-only.
  Linux users can integrate libsecret via the callback-mode keystore (see
  @atrib/mcp middleware options).
`

interface Flags {
  keychain: boolean
  service?: string
  keyFile?: string
  // publish-claim flags
  displayName?: string
  // revoke flags
  reason?: string
  successor?: string
  log?: string
  contextId?: string
  // publish-claim flags continued
  organization?: string
  email?: string
  url?: string
  handle?: string
  directory?: string
  capabilitiesFile?: string
  toolNames?: string
  eventTypes?: string
  counterparties?: string
  maxAmountCurrency?: string
  maxAmountValue?: string
  expiresAt?: string
  scope?: string
  ttl?: string
  context?: string
  notBefore?: string
  principal?: string
  principalKind?: string
  workspace?: string
  agent?: string
  profile?: string
  profileDir?: string
  publish?: boolean
  dryRun?: boolean
}

type StringFlagKey = Exclude<keyof Flags, 'keychain' | 'publish' | 'dryRun'>

function parseFlags(args: string[]): Flags {
  const flags: Flags = { keychain: false }
  const stringFlags: Array<{ flag: string; key: StringFlagKey }> = [
    { flag: '--service', key: 'service' },
    { flag: '--key-file', key: 'keyFile' },
    { flag: '--reason', key: 'reason' },
    { flag: '--successor', key: 'successor' },
    { flag: '--log', key: 'log' },
    { flag: '--context-id', key: 'contextId' },
    { flag: '--display-name', key: 'displayName' },
    { flag: '--organization', key: 'organization' },
    { flag: '--email', key: 'email' },
    { flag: '--url', key: 'url' },
    { flag: '--handle', key: 'handle' },
    { flag: '--directory', key: 'directory' },
    { flag: '--capabilities-file', key: 'capabilitiesFile' },
    { flag: '--tool-names', key: 'toolNames' },
    { flag: '--event-types', key: 'eventTypes' },
    { flag: '--counterparties', key: 'counterparties' },
    { flag: '--max-amount-currency', key: 'maxAmountCurrency' },
    { flag: '--max-amount-value', key: 'maxAmountValue' },
    { flag: '--expires-at', key: 'expiresAt' },
    { flag: '--scope', key: 'scope' },
    { flag: '--ttl', key: 'ttl' },
    { flag: '--context', key: 'context' },
    { flag: '--not-before', key: 'notBefore' },
    { flag: '--principal', key: 'principal' },
    { flag: '--principal-kind', key: 'principalKind' },
    { flag: '--workspace', key: 'workspace' },
    { flag: '--agent', key: 'agent' },
    { flag: '--profile', key: 'profile' },
    { flag: '--profile-dir', key: 'profileDir' },
  ]
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--keychain') {
      flags.keychain = true
      continue
    }
    if (arg === '--dry-run') {
      flags.dryRun = true
      continue
    }
    if (arg === '--publish') {
      flags.publish = true
      continue
    }
    const sf = stringFlags.find((s) => s.flag === arg)
    if (sf) {
      const value = args[i + 1]
      if (!value) throw new Error(`${arg} requires a value`)
      flags[sf.key] = value
      i++
      continue
    }
  }
  return flags
}

async function runKeygen(flags: Flags): Promise<void> {
  const keys = await keygen()
  if (!flags.keychain) {
    printKeypair(keys)
    return
  }
  if (!isKeychainSupported()) {
    throw new KeychainNotSupportedError(
      'Keychain integration is currently macOS-only. Run without --keychain.',
    )
  }
  storeSeed(keys.privateKey, flags.service ? { service: flags.service } : {})
  const { service, account } = resolveServiceAccount(
    flags.service ? { service: flags.service } : {},
  )
  // Print only the pubkey + Keychain location. The seed never leaves
  // the call to storeSeed.
  console.log(`ATRIB_PUBLIC_KEY=${keys.publicKey}`)
  console.log(`# Seed stored in macOS Keychain (service=${service}, account=${account})`)
  console.log(
    `# Retrieve with: atrib export-pubkey --keychain${flags.service ? ` --service ${service}` : ''}`,
  )
}

async function runExportPubkey(flags: Flags): Promise<void> {
  if (!flags.keychain) {
    throw new Error('export-pubkey currently requires --keychain.')
  }
  const seed = loadSeed(flags.service ? { service: flags.service } : {})
  if (!seed) {
    const { service, account } = resolveServiceAccount(
      flags.service ? { service: flags.service } : {},
    )
    throw new Error(`No Keychain entry found for service=${service} account=${account}.`)
  }
  const seedBytes = base64urlDecode(seed)
  if (seedBytes.length !== 32) {
    throw new Error(`Stored seed is not 32 bytes (got ${seedBytes.length}). Re-run keygen.`)
  }
  const pub = await getPublicKey(seedBytes)
  console.log(`ATRIB_PUBLIC_KEY=${base64urlEncode(pub)}`)
  // Zero the seed bytes after use.
  seedBytes.fill(0)
}

function buildClaimSubject(flags: Flags): Record<string, unknown> {
  const subject: Record<string, unknown> = {}
  if (flags.displayName) subject.display_name = flags.displayName
  if (flags.organization) subject.organization = flags.organization
  if (flags.email) subject.email = flags.email
  if (flags.url) subject.url = flags.url
  if (flags.handle) subject.handle = flags.handle
  if (Object.keys(subject).length === 0) {
    throw new Error(
      'publish-claim needs at least one of: --display-name, --organization, --email, --url, --handle',
    )
  }
  return subject
}

function buildCapabilities(flags: Flags): CapabilityEnvelope | undefined {
  // File takes precedence and replaces all other capability flags.
  if (flags.capabilitiesFile) {
    const raw = readFileSync(flags.capabilitiesFile, 'utf-8')
    return JSON.parse(raw) as CapabilityEnvelope
  }
  const env: CapabilityEnvelope = {}
  if (flags.toolNames)
    env.tool_names = flags.toolNames
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  if (flags.eventTypes)
    env.event_types = flags.eventTypes
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  if (flags.counterparties)
    env.counterparties = flags.counterparties
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  if (flags.maxAmountCurrency || flags.maxAmountValue) {
    if (!flags.maxAmountCurrency || !flags.maxAmountValue) {
      throw new Error('--max-amount-currency and --max-amount-value must be set together')
    }
    const value = Number(flags.maxAmountValue)
    if (!Number.isFinite(value))
      throw new Error(`--max-amount-value not a number: ${flags.maxAmountValue}`)
    env.max_amount = { currency: flags.maxAmountCurrency, value }
  }
  if (flags.expiresAt) {
    const ts = Date.parse(flags.expiresAt)
    if (Number.isNaN(ts))
      throw new Error(`--expires-at not a valid ISO8601 timestamp: ${flags.expiresAt}`)
    env.expires_at = ts
  }
  return Object.keys(env).length > 0 ? env : undefined
}

async function loadSigningSeed(flags: Flags): Promise<Uint8Array> {
  if (flags.keychain) {
    const seed = loadSeed(flags.service ? { service: flags.service } : {})
    if (!seed) {
      const { service, account } = resolveServiceAccount(
        flags.service ? { service: flags.service } : {},
      )
      throw new Error(`No Keychain entry for service=${service} account=${account}.`)
    }
    const bytes = base64urlDecode(seed)
    if (bytes.length !== 32) throw new Error(`Stored seed is not 32 bytes (got ${bytes.length}).`)
    return bytes
  }
  if (flags.keyFile) {
    const raw = readFileSync(flags.keyFile, 'utf-8').trim()
    const bytes = base64urlDecode(raw)
    if (bytes.length !== 32)
      throw new Error(`Key file ${flags.keyFile} did not decode to 32 bytes (got ${bytes.length}).`)
    return bytes
  }
  throw new Error('Signing needs --keychain (with optional --service NAME) or --key-file PATH.')
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readStringList(
  source: Record<string, unknown>,
  field: 'tool_names' | 'event_types' | 'counterparties',
): string[] | undefined {
  const value = source[field]
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string' || !entry)) {
    throw new Error(`--scope ${field} must be an array of non-empty strings`)
  }
  return value as string[]
}

function readDelegationScope(path: string): DelegationScope {
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf-8'))
  if (!isPlainObject(parsed)) {
    throw new Error('--scope must contain a JSON object')
  }
  const allowed = new Set([
    'tool_names',
    'event_types',
    'max_amount',
    'counterparties',
    'expires_at',
    'cost_policy',
  ])
  const unknown = Object.keys(parsed).filter((field) => !allowed.has(field))
  if (unknown.length > 0) {
    throw new Error(`--scope contains unknown field(s): ${unknown.sort().join(', ')}`)
  }

  const scope: DelegationScope = {}
  const toolNames = readStringList(parsed, 'tool_names')
  const eventTypes = readStringList(parsed, 'event_types')
  const counterparties = readStringList(parsed, 'counterparties')
  if (toolNames) scope.tool_names = toolNames
  if (eventTypes) scope.event_types = eventTypes
  if (counterparties) scope.counterparties = counterparties

  if (parsed.max_amount !== undefined) {
    if (!isPlainObject(parsed.max_amount)) {
      throw new Error('--scope max_amount must be an object')
    }
    const currency = parsed.max_amount.currency
    const value = parsed.max_amount.value
    if (typeof currency !== 'string' || !currency) {
      throw new Error('--scope max_amount.currency must be a non-empty string')
    }
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      throw new Error('--scope max_amount.value must be a non-negative number')
    }
    scope.max_amount = { currency, value }
  }

  if (parsed.expires_at !== undefined) {
    if (!Number.isInteger(parsed.expires_at) || (parsed.expires_at as number) < 0) {
      throw new Error('--scope expires_at must be a non-negative Unix-ms integer')
    }
    scope.expires_at = parsed.expires_at as number
  }
  if (parsed.cost_policy !== undefined) {
    if (!isPlainObject(parsed.cost_policy)) {
      throw new Error('--scope cost_policy must be an object')
    }
    const costPolicy: NonNullable<DelegationScope['cost_policy']> = {}
    if (parsed.cost_policy.model_tiers !== undefined) {
      if (
        !Array.isArray(parsed.cost_policy.model_tiers) ||
        parsed.cost_policy.model_tiers.some((entry) => typeof entry !== 'string' || !entry)
      ) {
        throw new Error('--scope cost_policy.model_tiers must be an array of non-empty strings')
      }
      costPolicy.model_tiers = parsed.cost_policy.model_tiers as string[]
    }
    if (parsed.cost_policy.max_tokens !== undefined) {
      if (
        !Number.isSafeInteger(parsed.cost_policy.max_tokens) ||
        (parsed.cost_policy.max_tokens as number) < 0
      ) {
        throw new Error('--scope cost_policy.max_tokens must be a non-negative integer')
      }
      costPolicy.max_tokens = parsed.cost_policy.max_tokens as number
    }
    if (Object.keys(costPolicy).length === 0) {
      throw new Error('--scope cost_policy must contain model_tiers or max_tokens')
    }
    scope.cost_policy = costPolicy
  }
  if (Object.keys(scope).length === 0) {
    throw new Error('--scope must contain at least one §6.7 capability constraint')
  }
  return scope
}

function parseIntegerFlag(value: string, flag: string, minimum: number): number {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < minimum) {
    throw new Error(`${flag} must be an integer greater than or equal to ${minimum}`)
  }
  return parsed
}

async function runDelegate(flags: Flags): Promise<void> {
  if (!flags.scope) throw new Error('delegate requires --scope PATH')
  if (!flags.ttl) throw new Error('delegate requires --ttl SECONDS')
  if (flags.keychain && flags.keyFile) {
    throw new Error('delegate accepts either --keychain or --key-file, not both')
  }
  if (flags.context && !/^[0-9a-f]{32}$/.test(flags.context)) {
    throw new Error('--context must be 32 lowercase hex chars')
  }

  const scope = readDelegationScope(flags.scope)
  const ttlSeconds = parseIntegerFlag(flags.ttl, '--ttl', 1)
  const notBefore = flags.notBefore
    ? parseIntegerFlag(flags.notBefore, '--not-before', 0)
    : undefined
  const validityStart = notBefore ?? Date.now()
  const notAfter = validityStart + ttlSeconds * 1000
  if (!Number.isSafeInteger(notAfter)) {
    throw new Error('--ttl and --not-before produce an unsafe not_after timestamp')
  }

  const principalSeed = await loadSigningSeed(flags.keyFile ? flags : { ...flags, keychain: true })
  const runSeed = new Uint8Array(randomBytes(32))
  try {
    const runPubkey = base64urlEncode(await getPublicKey(runSeed))
    const certificate = await issueDelegationCertificate(principalSeed, {
      run_pubkey: runPubkey,
      not_after: notAfter,
      ...(notBefore !== undefined ? { not_before: notBefore } : {}),
      ...(flags.context ? { context_id: flags.context } : {}),
      scope,
    })
    const encodedCertificate = base64urlEncode(
      new TextEncoder().encode(JSON.stringify(certificate)),
    )
    console.log(`ATRIB_KEY=${base64urlEncode(runSeed)}`)
    console.log(`ATRIB_DELEGATION_CERT=${encodedCertificate}`)
  } finally {
    principalSeed.fill(0)
    runSeed.fill(0)
  }
}

type KeyRevocationRecord = AtribRecord & {
  revoked_key: string
  revocation_reason: 'rotation' | 'retirement' | 'compromise'
  successor_key?: string
}

async function runRevoke(flags: Flags): Promise<void> {
  const reason = flags.reason
  if (reason !== 'rotation' && reason !== 'retirement' && reason !== 'compromise') {
    throw new Error('--reason must be one of: rotation, retirement, compromise')
  }
  if (reason === 'rotation' && !flags.successor) {
    throw new Error('--reason rotation requires --successor PUBKEY (43-char base64url)')
  }
  if (flags.successor && !/^[A-Za-z0-9_-]{43}$/.test(flags.successor)) {
    throw new Error('--successor must be a 43-char base64url Ed25519 pubkey')
  }
  const seedBytes = await loadSigningSeed(flags)
  const pub = await getPublicKey(seedBytes)
  const creatorKey = base64urlEncode(pub)

  // Per §1.9.2: standard revocation is signed by the key being retired.
  // creator_key === revoked_key in that case. Compromise + emergency-key
  // path is V2, not exposed here.
  const revokedKey = creatorKey

  // Use the supplied --context-id or generate a fresh one. Revocation
  // records form their own session for traceability per §1.9.
  const contextId = flags.contextId ?? randomBytes(16).toString('hex')
  if (!/^[0-9a-f]{32}$/.test(contextId)) {
    throw new Error('--context-id must be 32 hex chars')
  }

  const unsigned: KeyRevocationRecord = {
    spec_version: 'atrib/1.0' as const,
    content_id:
      'sha256:' + hexEncode(sha256(Buffer.from(`revoke:${revokedKey}:${reason}:${Date.now()}`))),
    creator_key: creatorKey,
    chain_root: genesisChainRoot(contextId),
    event_type: 'https://atrib.dev/v1/types/key_revocation',
    context_id: contextId,
    timestamp: Date.now(),
    revoked_key: revokedKey,
    revocation_reason: reason,
    ...(flags.successor ? { successor_key: flags.successor } : {}),
    signature: '',
  }
  const signed = (await signRecord(unsigned, seedBytes)) as KeyRevocationRecord
  seedBytes.fill(0)

  const recordHash = 'sha256:' + hexEncode(sha256(canonicalRecord(signed)))

  if (flags.dryRun) {
    console.log(JSON.stringify(signed, null, 2))
    return
  }

  const logEndpoint = flags.log ?? 'https://log.atrib.dev/v1'
  const submitUrl = `${logEndpoint.replace(/\/$/, '')}/entries`
  const res = await fetch(submitUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(signed),
  })
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok) {
    throw new Error(`log submit failed (${res.status}): ${JSON.stringify(body)}`)
  }
  console.log(`# Revoked key ${revokedKey}`)
  console.log(`# reason: ${reason}${flags.successor ? `, successor: ${flags.successor}` : ''}`)
  console.log(`# log_index: ${String(body.log_index)}`)
  console.log(`# record_hash: ${recordHash}`)
  console.log(`# context_id: ${contextId}`)
  console.log(
    `# Records signed by ${revokedKey} with log_index >= ${String(body.log_index)} are now`,
  )
  console.log(`# flagged 'revoked_after_revocation' by §1.9.3-aware verifiers.`)
}

async function runPublishClaim(flags: Flags): Promise<void> {
  const seedBytes = await loadSigningSeed(flags)
  const pub = await getPublicKey(seedBytes)
  const creatorKey = base64urlEncode(pub)

  const subject = buildClaimSubject(flags)
  const capabilities = buildCapabilities(flags)

  const unsigned: Omit<IdentityClaim, 'signature'> = {
    creator_key: creatorKey,
    claim_type: 'self_attested',
    claim_method: 'self',
    claim_subject: subject,
    ...(capabilities ? { capabilities } : {}),
  }

  const claim = await signClaim(unsigned, seedBytes)
  // Zero seed bytes after signing
  seedBytes.fill(0)

  if (flags.dryRun) {
    console.log(JSON.stringify(claim, null, 2))
    return
  }

  const directory = flags.directory ?? 'https://directory.atrib.dev/v6'
  const endpoint = `${directory.replace(/\/$/, '')}/publish`
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(claim),
  })
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok) {
    throw new Error(`directory publish failed (${res.status}): ${JSON.stringify(body)}`)
  }
  console.log(`# Published identity claim for ${creatorKey}`)
  console.log(`# directory: ${directory}`)
  console.log(`# epoch: ${String(body.epoch)}`)
  console.log(`# root_hash: ${String(body.root_hash)}`)
  if (body.anchor && typeof body.anchor === 'object') {
    const a = body.anchor as Record<string, unknown>
    if (a.submitted) console.log(`# anchored: record_hash=${String(a.record_hash)}`)
    else if (a.error) console.log(`# anchor error: ${String(a.error)}`)
  }
}

async function publishIdentityClaim(
  claim: IdentityClaim,
  flags: Flags,
): Promise<Record<string, unknown>> {
  const directory = flags.directory ?? 'https://directory.atrib.dev/v6'
  const endpoint = `${directory.replace(/\/$/, '')}/publish`
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(claim),
  })
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok) {
    throw new Error(`directory publish failed (${res.status}): ${JSON.stringify(body)}`)
  }
  return { directory, ...body }
}

function profilePathForFlags(flags: Flags): string {
  return identityProfilePath(flags.profile ?? 'default', flags.profileDir)
}

function flagsFromKeySource(source: IdentityKeySource): Flags {
  if (source.kind === 'macos-keychain') {
    return { keychain: true, service: source.service }
  }
  return { keychain: false, keyFile: source.path }
}

async function loadOrCreateIdentityPrincipal(
  flags: Flags,
  profileName: string,
  existing?: IdentityProfile,
): Promise<{
  created: boolean
  keySource: IdentityKeySource
  seed: Uint8Array
}> {
  if (flags.keychain && flags.keyFile) {
    throw new Error('identity init accepts either --keychain or --key-file, not both')
  }
  if (existing && !flags.keyFile && !flags.service) {
    const seed = await loadSigningSeed(flagsFromKeySource(existing.key_source))
    return { created: false, keySource: existing.key_source, seed }
  }
  if (flags.keyFile) {
    const path = resolve(flags.keyFile)
    const seed = await loadSigningSeed({ keychain: false, keyFile: path })
    return {
      created: false,
      keySource: { kind: 'key-file', path },
      seed,
    }
  }
  if (!isKeychainSupported()) {
    throw new KeychainNotSupportedError(
      'identity init creates principals in macOS Keychain by default. On this platform, supply an existing 32-byte seed with --key-file PATH.',
    )
  }
  const service = flags.service ?? `atrib-identity-${profileName}`
  const location = resolveServiceAccount({ service })
  const stored = loadSeed({ service })
  if (stored) {
    const seed = base64urlDecode(stored)
    if (seed.length !== 32) {
      throw new Error(`Stored seed is not 32 bytes (got ${seed.length}).`)
    }
    return {
      created: false,
      keySource: { kind: 'macos-keychain', ...location },
      seed,
    }
  }
  const keys = await keygen()
  storeSeed(keys.privateKey, { service })
  return {
    created: true,
    keySource: { kind: 'macos-keychain', ...location },
    seed: base64urlDecode(keys.privateKey),
  }
}

function existingValue(
  supplied: string | undefined,
  existing: string | undefined,
  flag: string,
): string {
  if (supplied && existing && supplied !== existing) {
    throw new Error(
      `${flag} does not match the existing profile. Use another --profile name instead of silently changing identity.`,
    )
  }
  const value = supplied ?? existing
  if (!value) throw new Error(`identity init requires ${flag} NAME for a new profile`)
  return value
}

async function runIdentityInit(flags: Flags): Promise<void> {
  const profileName = flags.profile ?? 'default'
  const path = profilePathForFlags(flags)
  await withIdentityProfileLock(path, async () => {
    const existing = identityProfileExists(path) ? loadIdentityProfile(path) : undefined
    const principalKind = (flags.principalKind ??
      existing?.principal.kind ??
      'human') as PrincipalKind
    if (principalKind !== 'human' && principalKind !== 'organization') {
      throw new Error('--principal-kind must be human or organization')
    }
    if (flags.principalKind && existing && principalKind !== existing.principal.kind) {
      throw new Error(
        '--principal-kind does not match the existing profile. Use another --profile name instead of silently changing identity.',
      )
    }
    const principalName = existingValue(flags.principal, existing?.principal.name, '--principal')
    const workspaceName = existingValue(flags.workspace, existing?.workspace.name, '--workspace')
    const agentName = existingValue(flags.agent, existing?.agent.name, '--agent')
    const principal = await loadOrCreateIdentityPrincipal(flags, profileName, existing)

    try {
      if (existing) {
        const existingErrors = await identityProfileErrors(existing, principal.seed)
        if (existingErrors.length > 0) {
          throw new Error(
            `existing identity profile failed verification: ${existingErrors.join(', ')}`,
          )
        }
      }
      const baseProfile = await createIdentityProfile({
        profileName,
        principalKind,
        principalName,
        workspaceName,
        agentName,
        principalSeed: principal.seed,
        keySource: principal.keySource,
        ...(existing ? { createdAtMs: existing.created_at_ms } : {}),
      })
      const contextId = flags.context ?? randomBytes(16).toString('hex')
      const ttlSeconds = flags.ttl ? parseIntegerFlag(flags.ttl, '--ttl', 1) : 3600
      const scope = flags.scope ? readDelegationScope(flags.scope) : undefined
      const run = await issueIdentityRun(baseProfile, principal.seed, {
        contextId,
        ttlSeconds,
        ...(scope ? { scope } : {}),
      })
      try {
        const rotation = await rotateIdentityRun(
          {
            ...baseProfile,
            ...(existing?.active_run ? { active_run: existing.active_run } : {}),
            ...(existing?.revoked_runs ? { revoked_runs: existing.revoked_runs } : {}),
          },
          principal.seed,
          run,
          {
            logEndpoint: flags.log ?? 'https://log.atrib.dev/v1',
          },
        )
        const profile: IdentityProfile = {
          ...baseProfile,
          active_run: rotation.active_run,
          revoked_runs: [
            ...(existing?.revoked_runs ?? []),
            ...(rotation.revocation ? [rotation.revocation] : []),
          ],
        }
        const errors = await identityProfileErrors(profile, principal.seed)
        if (errors.length > 0) {
          throw new Error(`generated identity profile failed verification: ${errors.join(', ')}`)
        }

        let directoryResult: Record<string, unknown> | undefined
        if (flags.publish) {
          directoryResult = await publishIdentityClaim(profile.signed_claim, flags)
        }
        saveIdentityProfile(path, profile)

        const encodedCertificate = base64urlEncode(
          new TextEncoder().encode(JSON.stringify(run.certificate)),
        )
        const encodedClaim = base64urlEncode(
          new TextEncoder().encode(JSON.stringify(profile.signed_claim)),
        )
        console.log(`# identity_profile: ${profile.profile_name}`)
        console.log(`# principal: ${profile.principal.name} (${profile.principal.kind})`)
        console.log(`# workspace: ${profile.workspace.name} (${profile.workspace.id})`)
        console.log(`# agent: ${profile.agent.name} (${profile.agent.id}, role=agent)`)
        console.log(`# principal_key: ${profile.principal.public_key}`)
        console.log(`# principal_key_state: ${principal.created ? 'created' : 'recovered'}`)
        console.log(`# profile_path: ${path}`)
        console.log(
          `# identity_resolution: ${flags.publish ? 'directory-published-and-carried' : 'signed-claim-carried'}`,
        )
        if (rotation.revocation) {
          console.log(`# rotated_run_key: ${rotation.revocation.revoked_key}`)
          console.log(`# rotation_log_index: ${rotation.revocation.log_index}`)
          console.log(`# rotation_record_hash: ${rotation.revocation.record_hash}`)
        }
        if (directoryResult) {
          console.log(`# directory: ${String(directoryResult.directory)}`)
          if (directoryResult.epoch !== undefined) {
            console.log(`# directory_epoch: ${String(directoryResult.epoch)}`)
          }
          if (directoryResult.root_hash !== undefined) {
            console.log(`# directory_root: ${String(directoryResult.root_hash)}`)
          }
        }
        console.log(`ATRIB_IDENTITY_PROFILE=${profile.profile_name}`)
        console.log(`ATRIB_IDENTITY_PROFILE_PATH=${path}`)
        console.log(`ATRIB_PRINCIPAL_KEY=${profile.principal.public_key}`)
        console.log(`ATRIB_WORKSPACE_ID=${profile.workspace.id}`)
        console.log(`ATRIB_AGENT_ID=${profile.agent.id}`)
        console.log(`ATRIB_CONTEXT_ID=${run.context_id}`)
        console.log(`ATRIB_KEY=${base64urlEncode(run.run_seed)}`)
        console.log(`ATRIB_DELEGATION_CERT=${encodedCertificate}`)
        console.log(`ATRIB_IDENTITY_CLAIM=${encodedClaim}`)
        console.log(`ATRIB_REVOKED_KEYS=${[...identityRevokedKeys(profile)].join(',')}`)
      } finally {
        run.run_seed.fill(0)
      }
    } finally {
      principal.seed.fill(0)
    }
  })
}

async function runIdentityShow(flags: Flags): Promise<void> {
  const path = profilePathForFlags(flags)
  if (!identityProfileExists(path)) {
    throw new Error(`identity profile not found: ${path}`)
  }
  const profile = loadIdentityProfile(path)
  let seed: Uint8Array | undefined
  let keySourceState = 'unavailable'
  try {
    seed = await loadSigningSeed(flagsFromKeySource(profile.key_source))
    keySourceState = 'available'
  } catch (error) {
    if (error instanceof KeychainNotSupportedError) {
      keySourceState = 'unsupported-on-this-platform'
    } else if (error instanceof Error && error.message.startsWith('No Keychain entry')) {
      keySourceState = 'missing'
    } else {
      throw error
    }
  }
  try {
    const errors = await identityProfileErrors(profile, seed)
    console.log(
      JSON.stringify(
        {
          profile: profile.profile_name,
          principal: profile.principal,
          workspace: profile.workspace,
          agent: profile.agent,
          role_chain: ['principal', 'workspace', 'agent', 'run'],
          signed_claim_valid: !errors.includes('identity_claim_signature_invalid'),
          active_run: profile.active_run ?? null,
          revoked_run_keys: [...identityRevokedKeys(profile)],
          key_source_state: keySourceState,
          key_source_matches_principal:
            seed === undefined ? null : !errors.includes('key_source_principal_mismatch'),
          errors,
          profile_path: path,
        },
        null,
        2,
      ),
    )
    if (errors.length > 0) process.exitCode = 1
  } finally {
    seed?.fill(0)
  }
}

async function runIdentity(args: string[]): Promise<void> {
  const action = args[0]
  const flags = parseFlags(args.slice(1))
  if (action === 'init') {
    await runIdentityInit(flags)
    return
  }
  if (action === 'show') {
    await runIdentityShow(flags)
    return
  }
  throw new Error('identity requires one of: init, show')
}

function runDeleteKey(flags: Flags): void {
  if (!flags.keychain) {
    throw new Error('delete-key currently requires --keychain.')
  }
  const removed = deleteSeed(flags.service ? { service: flags.service } : {})
  const { service, account } = resolveServiceAccount(
    flags.service ? { service: flags.service } : {},
  )
  if (removed) {
    console.log(`# Removed Keychain entry service=${service} account=${account}`)
  } else {
    console.log(`# No Keychain entry found for service=${service} account=${account}`)
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const command = args[0]

  if (!command || command === 'help' || command === '--help' || command === '-h') {
    console.log(HELP)
    return
  }

  if (command === '--version' || command === '-v') {
    console.log(VERSION)
    return
  }

  if (command === 'identity') {
    try {
      await runIdentity(args.slice(1))
    } catch (err) {
      if (err instanceof KeychainNotSupportedError) {
        console.error(`atrib: ${err.message}`)
        process.exitCode = 2
        return
      }
      if (err instanceof KeychainError) {
        console.error(`atrib: keychain error (status ${err.status}): ${err.message}`)
        if (err.stderr) console.error(err.stderr)
        process.exitCode = 3
        return
      }
      console.error(`atrib: ${err instanceof Error ? err.message : String(err)}`)
      process.exitCode = 1
    }
    return
  }

  const tail = args.slice(1)
  let flags: Flags
  try {
    flags = parseFlags(tail)
  } catch (err) {
    console.error(`atrib: ${err instanceof Error ? err.message : String(err)}`)
    process.exitCode = 1
    return
  }

  try {
    if (command === 'keygen') {
      await runKeygen(flags)
      return
    }
    if (command === 'export-pubkey') {
      await runExportPubkey(flags)
      return
    }
    if (command === 'delete-key') {
      runDeleteKey(flags)
      return
    }
    if (command === 'delegate') {
      await runDelegate(flags)
      return
    }
    if (command === 'publish-claim') {
      await runPublishClaim(flags)
      return
    }
    if (command === 'revoke') {
      await runRevoke(flags)
      return
    }
  } catch (err) {
    if (err instanceof KeychainNotSupportedError) {
      console.error(`atrib: ${err.message}`)
      process.exitCode = 2
      return
    }
    if (err instanceof KeychainError) {
      console.error(`atrib: keychain error (status ${err.status}): ${err.message}`)
      if (err.stderr) console.error(err.stderr)
      process.exitCode = 3
      return
    }
    console.error(`atrib: ${err instanceof Error ? err.message : String(err)}`)
    process.exitCode = 1
    return
  }

  console.error(`Unknown command: ${command}`)
  console.error('Run "atrib help" for usage.')
  process.exitCode = 1
}

main().catch((err) => {
  console.error('atrib: fatal error', err)
  process.exitCode = 1
})
