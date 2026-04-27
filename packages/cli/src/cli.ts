#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0

/**
 * atrib CLI entry point (§5.6.1).
 *
 * Subcommands:
 *   keygen [--keychain] [--service NAME]    Generate an Ed25519 keypair.
 *                                            Prints ATRIB_PRIVATE_KEY +
 *                                            ATRIB_PUBLIC_KEY by default.
 *                                            With --keychain, stores the seed
 *                                            in macOS Keychain and prints
 *                                            only the public key.
 *   export-pubkey --keychain [--service NAME]
 *                                            Read the seed from Keychain and
 *                                            print only the derived public
 *                                            key.
 *   delete-key --keychain [--service NAME]   Remove a Keychain entry.
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
}

function parseFlags(args: string[]): Flags {
  const flags: Flags = { keychain: false }
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--keychain') {
      flags.keychain = true
    } else if (arg === '--service') {
      const value = args[i + 1]
      if (!value) {
        throw new Error('--service requires a value')
      }
      flags.service = value
      i++
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
