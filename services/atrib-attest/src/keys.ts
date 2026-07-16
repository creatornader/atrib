// Key resolution chain for atrib-emit. MUST mirror the agent's wrapper
// service resolution order exactly for the first three sources, emit
// signs records under the same identity as the wrapper, so a divergence
// here means the two producers would sign as different identities in the
// same session, breaking the chain assumption and creating mystery keys
// in the log.
//
// Resolution order (first hit wins):
//   1. ATRIB_PRIVATE_KEY env var (legacy / dev path)
//   2. ATRIB_KEY_FILE env var → 0600 file
//   3. macOS Keychain, account = current user, services tried in order:
//        - atrib-creator-<ATRIB_AGENT>  (agent-scoped; matches wrapper)
//        - atrib-creator                (generic fallback)
//   4. 1Password CLI (`op read`), recovery path when Keychain is wiped.
//      Off by default; enable by setting ATRIB_OP_REFERENCE to a valid
//      `op://<vault>/<item>/<field>` reference. Requires the operator
//      to be signed in (`op signin`) and willing to approve the read.
//
// The `op` fallback is deliberately last so that, in a healthy machine,
// the seed never leaves Keychain. It only fires when Keychain is empty,
// e.g., after a Keychain reset, fresh machine, or a corruption event.
// In that case the seed flows through `op read` stdout into our process
// memory; never touches argv (the reference contains no secret).
//
// Wrapper source of truth lives in the operator's internal repo; this
// resolution chain must be kept in lockstep with that wrapper.
//
// Sources 3 and 4 shell out to external binaries (`security`, `op`) that
// can block indefinitely in headless contexts: a locked login Keychain
// has no GUI to unlock against, and `op read` waits on a biometric
// approval no one will give in cron. Both spawnSync calls are bounded by
// a timeout so resolveKey() always returns within a few seconds and the
// caller fails fast into the §5.8 pass-through path instead of stalling
// the atrib-emit MCP init handshake (the observed 15s connect timeout in
// session-end / cron contexts). Tune via ATRIB_KEYCHAIN_TIMEOUT_MS and
// ATRIB_OP_TIMEOUT_MS.

import { readFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { userInfo } from 'node:os'
import { base64urlDecode } from '@atrib/mcp'

/**
 * Upper bound on the `security find-generic-password` call. A healthy,
 * unlocked Keychain answers in well under 100ms; the timeout exists to
 * cap a *hung* Keychain (locked login keychain, headless context) so
 * resolveKey falls through rather than stalling. Default 3s.
 */
const KEYCHAIN_TIMEOUT_MS = Number(process.env['ATRIB_KEYCHAIN_TIMEOUT_MS'] ?? '3000')

/**
 * Upper bound on the `op read` recovery call. Larger than the Keychain
 * bound because `op read` may legitimately wait on an interactive Touch
 * ID approval; still bounded so a headless invocation cannot hang. Default 10s.
 */
const OP_TIMEOUT_MS = Number(process.env['ATRIB_OP_TIMEOUT_MS'] ?? '10000')

export interface ResolvedKey {
  privateKey: Uint8Array
  /** Source the key came from. Surfaced in startup logs so operators can confirm key provenance. */
  source: 'env' | 'file' | 'keychain' | 'op'
  /** Which Keychain service yielded the key, when source === 'keychain'. */
  keychainService?: string
  /** The `op://` reference that yielded the key, when source === 'op'. */
  opReference?: string
}

/**
 * Resolve the agent's signing key. Returns null when no key is available;
 * callers run in pass-through mode (per §5.8 degradation) and the emit
 * tool returns a warning rather than crashing.
 *
 * The agent name (defaults to 'claude-code', override with ATRIB_AGENT)
 * picks the agent-scoped Keychain service first, falling back to the
 * generic 'atrib-creator' service. This matches the wrapper exactly: a
 * Keychain entry created via `atrib keygen --keychain --service
 * atrib-creator-claude-code` resolves identically here and in the wrapper.
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
    const account = process.env['ATRIB_KEYCHAIN_ACCOUNT'] ?? userInfo().username
    const agent = process.env['ATRIB_AGENT'] ?? 'claude-code'
    const services = [`atrib-creator-${agent}`, 'atrib-creator']
    for (const service of services) {
      const result = spawnSync(
        'security',
        ['find-generic-password', '-a', account, '-s', service, '-w'],
        { encoding: 'utf-8', timeout: KEYCHAIN_TIMEOUT_MS },
      )
      if ((result.error as NodeJS.ErrnoException | undefined)?.code === 'ETIMEDOUT') {
        // Keychain subsystem is unresponsive (locked login keychain in a
        // headless context). The second service would hang identically;
        // stop retrying and fall through so the caller fails fast into
        // §5.8 pass-through instead of paying the timeout twice.
        break
      }
      if (result.status === 0) {
        const seed = result.stdout.trim()
        if (seed.length > 0) {
          return { privateKey: decodeSeed(seed), source: 'keychain', keychainService: service }
        }
      }
    }
  }

  // 1Password recovery path (last resort). Activated only when
  // ATRIB_OP_REFERENCE is set; the reference itself is non-secret.
  // ATRIB_OP_ACCOUNT optionally pins which 1Password account, useful for
  // operators with multiple accounts (e.g. personal + work).
  const opReference = process.env['ATRIB_OP_REFERENCE']
  if (opReference) {
    const args = ['read']
    const opAccount = process.env['ATRIB_OP_ACCOUNT']
    if (opAccount) args.push('--account', opAccount)
    args.push(opReference)
    const result = spawnSync('op', args, { encoding: 'utf-8', timeout: OP_TIMEOUT_MS })
    if (result.status === 0) {
      // 1Password items often store seeds with a label prefix like
      // "ATRIB_PRIVATE_KEY=<seed>" so the operator can tell which field
      // is which in the UI. Strip an optional `ATRIB_PRIVATE_KEY=` prefix
      // before decoding so both shapes work.
      const raw = result.stdout.trim()
      const seed = raw.startsWith('ATRIB_PRIVATE_KEY=')
        ? raw.slice('ATRIB_PRIVATE_KEY='.length).trim()
        : raw
      if (seed.length > 0) {
        return { privateKey: decodeSeed(seed), source: 'op', opReference }
      }
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
