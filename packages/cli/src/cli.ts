#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0

/**
 * atrib CLI entry point (§5.6.1).
 * Usage: npx @atrib/cli keygen
 */

import { keygen, printKeypair } from './keygen.js'

const VERSION = '0.1.0'

const HELP = `atrib CLI v${VERSION}

Usage:
  atrib keygen       Generate an Ed25519 keypair for attribution signing
  atrib help         Show this help message
  atrib --version    Show version

Key generation outputs environment variables ready for .env files:
  ATRIB_PRIVATE_KEY=<base64url-encoded 32-byte Ed25519 seed>
  ATRIB_PUBLIC_KEY=<base64url-encoded 32-byte Ed25519 public key>
`

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

  if (command === 'keygen') {
    const keys = await keygen()
    printKeypair(keys)
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
