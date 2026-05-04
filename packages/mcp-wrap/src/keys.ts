// Key resolution chain. Mirrors atrib-emit's keys.ts exactly so a wrapper
// and an emit tool sharing one machine pick the same identity. Divergence
// here means the wrapper signs as identity A and atrib-emit signs as
// identity B in the same session, breaking chain continuity and creating
// mystery keys in the log.
//
// Resolution order (first hit wins):
//   1. ATRIB_PRIVATE_KEY env var (legacy / dev path)
//   2. ATRIB_KEY_FILE env var → 0600 file
//   3. macOS Keychain, account = current user, services tried in order:
//        - atrib-creator-<agent>  (agent-scoped; matches wrapper)
//        - atrib-creator          (generic fallback)
//   4. 1Password CLI (`op read`), recovery path when Keychain is wiped.
//      Off by default; enable by setting ATRIB_OP_REFERENCE.
//
// The `op` fallback is deliberately last so the seed never leaves Keychain
// in a healthy machine.

import { readFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { userInfo } from 'node:os'
import { base64urlDecode } from '@atrib/mcp'

export interface ResolvedKey {
  privateKey: Uint8Array
  /** Raw base64url-encoded seed. Re-emitted to ATRIB_PRIVATE_KEY for the upstream proxy. */
  seedB64url: string
  /** Source the key came from. Surfaced in startup logs so operators can confirm key provenance. */
  source: 'env' | 'file' | 'keychain' | 'op'
  /** Which Keychain service yielded the key, when source === 'keychain'. */
  keychainService?: string
  /** The `op://` reference that yielded the key, when source === 'op'. */
  opReference?: string
}

/**
 * Resolve the agent's signing key. Throws when no key is available, for the
 * wrapper, no-key is operator misconfiguration (not silent degradation per
 * §5.8) because an unsigned wrapper defeats the dogfood loop.
 *
 * `agent` picks the agent-scoped Keychain service (`atrib-creator-<agent>`)
 * before falling back to the generic `atrib-creator` service.
 */
export async function resolveKey(agent: string): Promise<ResolvedKey> {
  const envSeed = process.env['ATRIB_PRIVATE_KEY']
  if (envSeed) {
    return { privateKey: decodeSeed(envSeed), seedB64url: envSeed.trim(), source: 'env' }
  }

  const filePath = process.env['ATRIB_KEY_FILE']
  if (filePath) {
    const contents = (await readFile(filePath, 'utf-8')).trim()
    return { privateKey: decodeSeed(contents), seedB64url: contents, source: 'file' }
  }

  if (process.platform === 'darwin') {
    const account = process.env['ATRIB_KEYCHAIN_ACCOUNT'] ?? userInfo().username
    const services = [`atrib-creator-${agent}`, 'atrib-creator']
    for (const service of services) {
      const result = spawnSync(
        'security',
        ['find-generic-password', '-a', account, '-s', service, '-w'],
        { encoding: 'utf-8' },
      )
      if (result.status === 0) {
        const seed = result.stdout.trim()
        if (seed.length > 0) {
          return {
            privateKey: decodeSeed(seed),
            seedB64url: seed,
            source: 'keychain',
            keychainService: service,
          }
        }
      }
    }
  }

  // 1Password recovery path. Activated only when ATRIB_OP_REFERENCE is set.
  const opReference = process.env['ATRIB_OP_REFERENCE']
  if (opReference) {
    const args = ['read']
    const opAccount = process.env['ATRIB_OP_ACCOUNT']
    if (opAccount) args.push('--account', opAccount)
    args.push(opReference)
    const result = spawnSync('op', args, { encoding: 'utf-8' })
    if (result.status === 0) {
      const raw = result.stdout.trim()
      const seed = raw.startsWith('ATRIB_PRIVATE_KEY=')
        ? raw.slice('ATRIB_PRIVATE_KEY='.length).trim()
        : raw
      if (seed.length > 0) {
        return { privateKey: decodeSeed(seed), seedB64url: seed, source: 'op', opReference }
      }
    }
  }

  throw new Error(
    `[mcp-wrap] No ATRIB creator key available. Set ATRIB_PRIVATE_KEY (env), ` +
      `ATRIB_KEY_FILE (path to a 0600-mode seed file), or run ` +
      `\`atrib keygen --keychain --service atrib-creator-${agent}\` to store one in macOS Keychain.`,
  )
}

/**
 * Decode a base64url-encoded 32-byte Ed25519 seed. Throws if length wrong.
 * Per spec §1.4.1: atrib uses 32-byte seeds, not the 64-byte NaCl format.
 */
function decodeSeed(b64url: string): Uint8Array {
  const bytes = base64urlDecode(b64url.trim())
  if (bytes.length !== 32) {
    throw new Error(
      `[mcp-wrap] expected 32-byte Ed25519 seed, got ${bytes.length} bytes from key source`,
    )
  }
  return bytes
}
