// Key resolution chain for atrib-emit. Mirrors the wrapper's resolution order
// per the scope doc: env → file → macOS Keychain. atrib-emit signs records
// under the agent's identity (same key as the wrapper), so it must agree
// with whatever the wrapper resolves.

import { readFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { base64urlDecode } from '@atrib/mcp'

const KEYCHAIN_SERVICE = 'atrib-creator'

export interface ResolvedKey {
  privateKey: Uint8Array
  /** Source the key came from. Surfaced in startup logs so operators can confirm key provenance. */
  source: 'env' | 'file' | 'keychain'
}

/**
 * Resolve the agent's signing key. Ordered fallback so a development setup
 * (env var) takes precedence and Keychain is the production default on
 * macOS. Returns null when no key is available; callers run in pass-through
 * mode (per §5.8 degradation) and the emit tool returns a warning rather
 * than crashing.
 */
export async function resolveKey(): Promise<ResolvedKey | null> {
  const envSeed = process.env['ATRIB_PRIVATE_KEY']
  if (envSeed) {
    return { privateKey: decodeSeed(envSeed), source: 'env' }
  }

  const filePath = process.env['ATRIB_KEY_FILE']
  if (filePath) {
    const contents = (await readFile(filePath, 'utf-8')).trim()
    return { privateKey: decodeSeed(contents), source: 'file' }
  }

  if (process.platform === 'darwin') {
    const account = process.env['ATRIB_KEYCHAIN_ACCOUNT'] ?? KEYCHAIN_SERVICE
    const result = spawnSync(
      'security',
      ['find-generic-password', '-a', account, '-s', KEYCHAIN_SERVICE, '-w'],
      { encoding: 'utf-8' },
    )
    if (result.status === 0) {
      const seed = result.stdout.trim()
      if (seed.length > 0) return { privateKey: decodeSeed(seed), source: 'keychain' }
    }
  }

  return null
}

/**
 * Decode a base64url-encoded 32-byte Ed25519 seed. Throws if length wrong.
 * Per spec §1.4.1: atrib uses 32-byte seeds, not the 64-byte NaCl format.
 */
function decodeSeed(b64url: string): Uint8Array {
  const bytes = base64urlDecode(b64url.trim())
  if (bytes.length !== 32) {
    throw new Error(
      `atrib-emit: expected 32-byte Ed25519 seed, got ${bytes.length} bytes from key source`,
    )
  }
  return bytes
}
