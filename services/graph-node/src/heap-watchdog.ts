// SPDX-License-Identifier: Apache-2.0

/**
 * Threshold logic for the heap-utilization watchdog in main.ts.
 *
 * Lives in its own module so the thresholds are unit-testable. The watchdog's
 * whole value is firing at the right moment; an alerting path that quietly
 * never fires is worse than no alert, because it reads as an all-clear.
 *
 * Context: graph-node holds every record and derived index in memory, so the
 * live heap grows linearly and without bound with the log. On 2026-07-29 that
 * live set reached the V8 ceiling at ~112k records and the process began
 * aborting on any further allocation, which Fly served as 502s. Nothing warned
 * first.
 *
 * Thresholds sit below the disk watchdog's 80/95 because heap has no graceful
 * degradation: crossing the V8 limit aborts the process immediately,
 * per-request allocation sits on top of the live set so the usable ceiling is
 * under 100%, and recovery costs a full archive replay that serves errors
 * throughout.
 */

export const HEAP_WARN_FRACTION = 0.7
export const HEAP_ERROR_FRACTION = 0.85

export type HeapAlertLevel = 'ok' | 'warn' | 'error'

/**
 * Classify a heap-utilization fraction (used / limit).
 *
 * Non-finite input (a zero limit, or NaN from a runtime that does not report
 * heap statistics) classifies as 'ok': the watchdog is advisory and must never
 * turn a missing measurement into a false alarm.
 */
export function heapAlertLevel(fraction: number): HeapAlertLevel {
  if (!Number.isFinite(fraction)) return 'ok'
  if (fraction >= HEAP_ERROR_FRACTION) return 'error'
  if (fraction >= HEAP_WARN_FRACTION) return 'warn'
  return 'ok'
}

/**
 * Whether a transition from `previous` to `current` should be logged.
 *
 * Only transitions are logged: a steady warn state would otherwise repeat every
 * interval and train operators to filter the message out. Recovery to 'ok' is
 * logged so the all-clear is visible, but only when something was wrong before.
 */
export function shouldLogHeapTransition(
  previous: HeapAlertLevel,
  current: HeapAlertLevel,
): boolean {
  return current !== previous
}
