// SPDX-License-Identifier: Apache-2.0

/**
 * Key material zeroing utility (§5.6.3).
 *
 * The spec requires: "SDK implementations MUST zero the key material
 * from memory after use when the runtime supports it."
 *
 * Since the middleware needs the key for the lifetime of the server
 * (every tool call signs a record), immediate zeroing is not possible.
 * Instead, this utility is called on graceful shutdown via destroy().
 */

/**
 * Fill a Uint8Array with zeros to clear sensitive key material.
 * The runtime's garbage collector will eventually reclaim the buffer,
 * but zeroing ensures the key bytes are not readable in memory dumps
 * or core files between now and GC.
 */
export function zeroize(buf: Uint8Array): void {
  buf.fill(0)
}
