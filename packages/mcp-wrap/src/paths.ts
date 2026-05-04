// File-system helpers for the wrapper's operational state directory
// (~/.atrib by default). Two invariants:
//
//   - The state directory is mode 0o700 (the operator alone can read it).
//     Default mkdir mode is 0o755 which leaves operational logs and the
//     signed-record mirror world-readable on shared hosts. We force 0o700.
//
//   - Sensitive files are mode 0o600. appendFileSync's mode option only
//     takes effect on file CREATION; if the file already exists with looser
//     perms, we proactively chmod it. Best-effort: cross-mount or
//     permission-denied chmods don't fatal, the operational footgun
//     should never block a tool call.

import { appendFileSync, chmodSync, mkdirSync } from 'node:fs'

export function ensureSecureDir(path: string): void {
  mkdirSync(path, { recursive: true, mode: 0o700 })
  try {
    chmodSync(path, 0o700)
  } catch {
    // Pre-existing dir we can't chmod (different owner, mount restriction).
  }
}

export function secureAppend(path: string, data: string): void {
  appendFileSync(path, data, { mode: 0o600 })
  try {
    chmodSync(path, 0o600)
  } catch {
    // File may not exist yet on a transient filesystem; harmless.
  }
}
