// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import {
  EVENT_TYPE_ANNOTATION_URI,
  EVENT_TYPE_DIRECTORY_ANCHOR_URI,
  EVENT_TYPE_OBSERVATION_URI,
  EVENT_TYPE_REVISION_URI,
  EVENT_TYPE_SHORT_NAMES,
  EVENT_TYPE_TOOL_CALL_URI,
  EVENT_TYPE_TRANSACTION_URI,
  normalizeEventType,
} from '../src/index.js'

describe('event_type aliases', () => {
  it('normalizes every atrib normative short name to its canonical URI', () => {
    expect([...EVENT_TYPE_SHORT_NAMES].sort()).toEqual([
      'annotation',
      'directory_anchor',
      'observation',
      'revision',
      'tool_call',
      'transaction',
    ])
    expect(normalizeEventType('tool_call')).toBe(EVENT_TYPE_TOOL_CALL_URI)
    expect(normalizeEventType('transaction')).toBe(EVENT_TYPE_TRANSACTION_URI)
    expect(normalizeEventType('observation')).toBe(EVENT_TYPE_OBSERVATION_URI)
    expect(normalizeEventType('directory_anchor')).toBe(EVENT_TYPE_DIRECTORY_ANCHOR_URI)
    expect(normalizeEventType('annotation')).toBe(EVENT_TYPE_ANNOTATION_URI)
    expect(normalizeEventType('revision')).toBe(EVENT_TYPE_REVISION_URI)
  })

  it('passes extension URIs through unchanged', () => {
    const uri = 'https://example.com/v1/types/custom'
    expect(normalizeEventType(uri)).toBe(uri)
  })

  it('normalizes common atrib.dev typo URI forms for normative leaves', () => {
    for (const path of ['/event/', '/events/', '/v1/event/', '/v1/events/']) {
      expect(normalizeEventType(`https://atrib.dev${path}observation`)).toBe(
        EVENT_TYPE_OBSERVATION_URI,
      )
      expect(normalizeEventType(`https://atrib.dev${path}annotation`)).toBe(
        EVENT_TYPE_ANNOTATION_URI,
      )
      expect(normalizeEventType(`https://atrib.dev${path}revision`)).toBe(
        EVENT_TYPE_REVISION_URI,
      )
    }
  })
})
