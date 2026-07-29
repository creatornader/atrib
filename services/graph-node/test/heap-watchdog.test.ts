// SPDX-License-Identifier: Apache-2.0

/**
 * The heap watchdog exists because the 2026-07-29 outage gave no warning: the
 * live heap reached the V8 ceiling at ~112k records and the process started
 * aborting on allocation. These tests pin the thresholds, because an alerting
 * path that never fires reads as an all-clear and is worse than no alert.
 */

import { describe, it, expect } from 'vitest'
import {
  HEAP_ERROR_FRACTION,
  HEAP_WARN_FRACTION,
  heapAlertLevel,
  shouldLogHeapTransition,
} from '../src/heap-watchdog.js'

describe('heapAlertLevel', () => {
  it('is ok well below the warn threshold', () => {
    // Where graph-node sat right after the 2026-07-29 fix: ~380MB of a 780MB
    // ceiling. Healthy, and must not alert.
    expect(heapAlertLevel(380 / 780)).toBe('ok')
  })

  it('warns exactly at the warn threshold and stays ok just below', () => {
    expect(heapAlertLevel(HEAP_WARN_FRACTION)).toBe('warn')
    expect(heapAlertLevel(HEAP_WARN_FRACTION - 0.001)).toBe('ok')
  })

  it('errors exactly at the error threshold and warns just below', () => {
    expect(heapAlertLevel(HEAP_ERROR_FRACTION)).toBe('error')
    expect(heapAlertLevel(HEAP_ERROR_FRACTION - 0.001)).toBe('warn')
  })

  it('errors at the utilization that actually took the service down', () => {
    // The GC log showed ~480MB live against a 489MB ceiling before the abort.
    expect(heapAlertLevel(480 / 489)).toBe('error')
  })

  it('fires before the ceiling, not at it', () => {
    // The point of the watchdog: both thresholds must leave room to act.
    expect(HEAP_WARN_FRACTION).toBeLessThan(HEAP_ERROR_FRACTION)
    expect(HEAP_ERROR_FRACTION).toBeLessThan(1)
  })

  it('treats an unmeasurable heap as ok rather than alarming', () => {
    expect(heapAlertLevel(Number.NaN)).toBe('ok')
    expect(heapAlertLevel(Number.POSITIVE_INFINITY)).toBe('ok')
  })
})

describe('shouldLogHeapTransition', () => {
  it('logs when crossing into warn and into error', () => {
    expect(shouldLogHeapTransition('ok', 'warn')).toBe(true)
    expect(shouldLogHeapTransition('warn', 'error')).toBe(true)
  })

  it('stays silent while a level holds, so steady state does not spam', () => {
    expect(shouldLogHeapTransition('warn', 'warn')).toBe(false)
    expect(shouldLogHeapTransition('error', 'error')).toBe(false)
    expect(shouldLogHeapTransition('ok', 'ok')).toBe(false)
  })

  it('logs recovery back down', () => {
    expect(shouldLogHeapTransition('error', 'warn')).toBe(true)
    expect(shouldLogHeapTransition('warn', 'ok')).toBe(true)
  })
})
