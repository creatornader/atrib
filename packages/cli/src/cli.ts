#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0

/**
 * atrib CLI entry point (§5.6.1).
 *
 * Subcommands:
 *   keygen [--keychain] [--service NAME]    Generate an Ed25519 keypair.
 *   export-pubkey --keychain [--service NAME]   Print the pubkey for a Keychain entry.
 *   delete-key --keychain [--service NAME]   Remove a Keychain entry.
 *   publish-claim --keychain [--service NAME] [--display-name NAME] [--organization ORG] [--email EMAIL] [--url URL]
 *                  [--directory URL] [--capabilities-file PATH] [--tool-names CSV] [--event-types CSV]
 *                  [--max-amount-currency USD --max-amount-value 100] [--counterparties CSV] [--expires-at ISO8601]
 *                                            Publish an IdentityClaim (§6.1) to the
 *                                            directory, optionally with a §6.7 capability
 *                                            envelope. Reads the seed from Keychain.
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
import { base64urlDecode, getPublicKey, base64urlEncode } from '@atrib/mcp'
import { signClaim } from '@atrib/directory'
import type { IdentityClaim, CapabilityEnvelope } from '@atrib/directory'
import { signRecord, genesisChainRoot, sha256, hexEncode, canonicalRecord } from '@atrib/mcp'
import { readFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'

const VERSION = '0.2.0'

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
  dryRun?: boolean
}

function parseFlags(args: string[]): Flags {
  const flags: Flags = { keychain: false }
  const stringFlags: Array<{ flag: string; key: keyof Flags }> = [
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
    const sf = stringFlags.find((s) => s.flag === arg)
    if (sf) {
      const value = args[i + 1]
      if (!value) throw new Error(`${arg} requires a value`)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(flags as any)[sf.key] = value
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
  console.log(`# Retrieve with: atrib export-pubkey --keychain${flags.service ? ` --service ${service}` : ''}`)
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
    throw new Error('publish-claim needs at least one of: --display-name, --organization, --email, --url, --handle')
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
  if (flags.toolNames) env.tool_names = flags.toolNames.split(',').map((s) => s.trim()).filter(Boolean)
  if (flags.eventTypes) env.event_types = flags.eventTypes.split(',').map((s) => s.trim()).filter(Boolean)
  if (flags.counterparties) env.counterparties = flags.counterparties.split(',').map((s) => s.trim()).filter(Boolean)
  if (flags.maxAmountCurrency || flags.maxAmountValue) {
    if (!flags.maxAmountCurrency || !flags.maxAmountValue) {
      throw new Error('--max-amount-currency and --max-amount-value must be set together')
    }
    const value = Number(flags.maxAmountValue)
    if (!Number.isFinite(value)) throw new Error(`--max-amount-value not a number: ${flags.maxAmountValue}`)
    env.max_amount = { currency: flags.maxAmountCurrency, value }
  }
  if (flags.expiresAt) {
    const ts = Date.parse(flags.expiresAt)
    if (Number.isNaN(ts)) throw new Error(`--expires-at not a valid ISO8601 timestamp: ${flags.expiresAt}`)
    env.expires_at = ts
  }
  return Object.keys(env).length > 0 ? env : undefined
}

async function loadSigningSeed(flags: Flags): Promise<Uint8Array> {
  if (flags.keychain) {
    const seed = loadSeed(flags.service ? { service: flags.service } : {})
    if (!seed) {
      const { service, account } = resolveServiceAccount(flags.service ? { service: flags.service } : {})
      throw new Error(`No Keychain entry for service=${service} account=${account}.`)
    }
    const bytes = base64urlDecode(seed)
    if (bytes.length !== 32) throw new Error(`Stored seed is not 32 bytes (got ${bytes.length}).`)
    return bytes
  }
  if (flags.keyFile) {
    const raw = readFileSync(flags.keyFile, 'utf-8').trim()
    const bytes = base64urlDecode(raw)
    if (bytes.length !== 32) throw new Error(`Key file ${flags.keyFile} did not decode to 32 bytes (got ${bytes.length}).`)
    return bytes
  }
  throw new Error('publish-claim needs --keychain (with optional --service NAME) or --key-file PATH.')
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
  // path is V2 — not exposed here.
  const revokedKey = creatorKey

  // Use the supplied --context-id or generate a fresh one. Revocation
  // records form their own session for traceability per §1.9.
  const contextId = flags.contextId ?? randomBytes(16).toString('hex')
  if (!/^[0-9a-f]{32}$/.test(contextId)) {
    throw new Error('--context-id must be 32 hex chars')
  }

  const unsigned = {
    spec_version: 'atrib/1.0' as const,
    content_id: 'sha256:' + hexEncode(sha256(Buffer.from(`revoke:${revokedKey}:${reason}:${Date.now()}`))),
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const signed = await signRecord(unsigned as any, seedBytes)
  seedBytes.fill(0)

  const recordHash = 'sha256:' + hexEncode(sha256(canonicalRecord(signed)))

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if ((flags as any).dryRun) {
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
  console.log(`# Records signed by ${revokedKey} with log_index >= ${String(body.log_index)} are now`)
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
