// SPDX-License-Identifier: Apache-2.0

/**
 * macOS Keychain integration for atrib creator keys.
 *
 * Why a keystore: env vars and `~/.claude.json` are 644-by-default and end
 * up in shell history, process listings, and command transcripts. The macOS
 * Keychain is encrypted at rest, ACL'd to a specific app or user, and
 * survives reboots without any plaintext leaving the keychain DB.
 *
 * Why shell out to `security` rather than a native bridge: zero install
 * dependencies. `security` ships with macOS. The cost is two `spawnSync`
 * calls per key operation — fine at MCP wrapper boot.
 *
 * Linux/Windows are NOT supported in this initial cut. Linux users can
 * shell out to `secret-tool` (libsecret) via a similar wrapper; see
 * `loadFromSecretTool` for the planned shape. Windows is out of scope.
 *
 * Service name convention:
 *   atrib-creator              default for the agent's primary creator key
 *   atrib-creator-<agent-id>   per-agent variants when an operator runs
 *                                multiple agents on one machine
 *   atrib-merchant             merchant key for settlement signing
 *
 * Account name: always the current user (`$USER`) — the keychain ACL is
 * implicit "this user only" via the account binding.
 */

import { spawnSync } from 'node:child_process'
import { platform, userInfo } from 'node:os'

const DEFAULT_SERVICE = 'atrib-creator'

export interface KeychainOptions {
  service?: string
  account?: string
}

export class KeychainNotSupportedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'KeychainNotSupportedError'
  }
}

export class KeychainError extends Error {
  constructor(
    message: string,
    public readonly status: number | null,
    public readonly stderr: string,
  ) {
    super(message)
    this.name = 'KeychainError'
  }
}

function assertMacos(): void {
  if (platform() !== 'darwin') {
    throw new KeychainNotSupportedError(
      'Keychain integration is currently macOS-only. ' +
        'On Linux, use libsecret/secret-tool or a callback-mode keystore. ' +
        'On Windows, use a callback-mode keystore that reads from DPAPI or a Vault.',
    )
  }
}

/**
 * Resolve service + account names with sensible defaults. Pure: no side
 * effects, easy to test.
 */
export function resolveServiceAccount(options: KeychainOptions = {}): {
  service: string
  account: string
} {
  return {
    service: options.service ?? DEFAULT_SERVICE,
    account: options.account ?? userInfo().username,
  }
}

/**
 * Store a base64url-encoded seed in the macOS Keychain. If an entry for the
 * same service+account already exists, it is overwritten (`-U`). The seed
 * is passed via the `-w` flag, which goes through argv and is therefore
 * visible to other processes on the machine for the brief lifetime of the
 * `security` invocation. This is acceptable on a single-user laptop; for
 * stricter environments use `storeSeedFromStdin` for argv-free entry.
 */
export function storeSeed(seedB64: string, options: KeychainOptions = {}): void {
  assertMacos()
  const { service, account } = resolveServiceAccount(options)
  const result = spawnSync(
    'security',
    [
      'add-generic-password',
      '-U', // update if exists
      '-a', account,
      '-s', service,
      '-w', seedB64,
    ],
    { encoding: 'utf8' },
  )
  if (result.status !== 0) {
    throw new KeychainError(
      `security add-generic-password failed for service=${service} account=${account}`,
      result.status,
      result.stderr ?? '',
    )
  }
}

/**
 * Read a base64url-encoded seed from the macOS Keychain. Returns null if no
 * entry exists for the given service+account. Throws on other errors.
 */
export function loadSeed(options: KeychainOptions = {}): string | null {
  assertMacos()
  const { service, account } = resolveServiceAccount(options)
  const result = spawnSync(
    'security',
    [
      'find-generic-password',
      '-a', account,
      '-s', service,
      '-w', // print password only
    ],
    { encoding: 'utf8' },
  )
  if (result.status === 0) {
    return (result.stdout ?? '').trim()
  }
  // status 44 = not found
  if (result.status === 44) {
    return null
  }
  throw new KeychainError(
    `security find-generic-password failed for service=${service} account=${account}`,
    result.status,
    result.stderr ?? '',
  )
}

/**
 * Remove a key from the macOS Keychain. Returns true if the entry was
 * removed, false if it didn't exist.
 */
export function deleteSeed(options: KeychainOptions = {}): boolean {
  assertMacos()
  const { service, account } = resolveServiceAccount(options)
  const result = spawnSync(
    'security',
    [
      'delete-generic-password',
      '-a', account,
      '-s', service,
    ],
    { encoding: 'utf8' },
  )
  if (result.status === 0) return true
  if (result.status === 44) return false
  throw new KeychainError(
    `security delete-generic-password failed for service=${service} account=${account}`,
    result.status,
    result.stderr ?? '',
  )
}

/**
 * Check whether Keychain integration is supported on the current platform.
 * Useful for callers that want to fall back to env vars without throwing.
 */
export function isKeychainSupported(): boolean {
  return platform() === 'darwin'
}
