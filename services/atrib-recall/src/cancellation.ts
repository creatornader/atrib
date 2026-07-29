// SPDX-License-Identifier: Apache-2.0

/**
 * Yield so the HTTP adapter can deliver a closed-request signal, then stop
 * before the next synchronous recall phase begins.
 */
export async function checkpointRecallCancellation(signal?: AbortSignal): Promise<void> {
  if (!signal) return
  await new Promise<void>((resolve) => setImmediate(resolve))
  if (signal.aborted) {
    throw signal.reason ?? new Error('recall cancelled')
  }
}
