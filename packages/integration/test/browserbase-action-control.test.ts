// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import {
  browserbaseAllowedOrigins,
  decideBrowserbaseActionControl,
  hashBrowserbasePolicyText,
  normalizeBrowserbaseActionPolicyMode,
} from '../examples/browserbase-stagehand/action-control.js'

const OBSERVED_STATE_HASH = hashBrowserbasePolicyText('observed state')
const OBSERVED_RECORD_HASH =
  'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'

describe('Browserbase action control contract', () => {
  it('allows an act call after observed state on an allowed origin', () => {
    const decision = decideBrowserbaseActionControl({
      mode: 'allow',
      packet: 'browserbase-stagehand',
      toolName: 'act',
      targetUrl: 'https://example.invalid/vendor-quote',
      action: 'Click the submit quote button',
      allowedOrigins: ['https://example.invalid'],
      observedStateHash: OBSERVED_STATE_HASH,
      observedRecordHash: OBSERVED_RECORD_HASH,
    })

    expect(decision.decision).toBe('allow')
    expect(decision.reason_codes).toEqual(['policy_allow'])
    expect(decision.content).toMatchObject({
      decision_boundary: 'pre_action',
      action_class: 'browser_act',
      risk_class: 'browser_state_change',
      observed_state_hash: OBSERVED_STATE_HASH,
      observed_record_hash: OBSERVED_RECORD_HASH,
    })
    expect(decision.content.target_url_hash).toBe(
      hashBrowserbasePolicyText('https://example.invalid/vendor-quote'),
    )
  })

  it('blocks when the browser action has no prior observed state', () => {
    const decision = decideBrowserbaseActionControl({
      mode: 'allow',
      packet: 'browserbase-stagehand',
      toolName: 'act',
      targetUrl: 'https://example.invalid/vendor-quote',
      action: 'Click the submit quote button',
      allowedOrigins: ['https://example.invalid'],
      observedStateHash: null,
      observedRecordHash: null,
    })

    expect(decision.decision).toBe('block')
    expect(decision.reason_codes).toEqual(['missing_observed_state'])
  })

  it('keeps disallowed origin as a block even when mode requests escalation', () => {
    const decision = decideBrowserbaseActionControl({
      mode: 'escalate',
      packet: 'browserbase-stagehand',
      toolName: 'act',
      targetUrl: 'https://blocked.invalid/vendor-quote',
      action: 'Click the submit quote button',
      allowedOrigins: ['https://example.invalid'],
      observedStateHash: OBSERVED_STATE_HASH,
      observedRecordHash: OBSERVED_RECORD_HASH,
    })

    expect(decision.decision).toBe('block')
    expect(decision.reason_codes).toEqual(['target_origin_not_allowed'])
  })

  it('normalizes environment driven policy modes and origins', () => {
    expect(normalizeBrowserbaseActionPolicyMode('block')).toBe('block')
    expect(normalizeBrowserbaseActionPolicyMode('escalate')).toBe('escalate')
    expect(normalizeBrowserbaseActionPolicyMode('anything-else')).toBe('allow')
    expect(
      browserbaseAllowedOrigins(
        { ATRIB_BROWSERBASE_ALLOWED_ORIGINS: 'https://a.example, https://b.example' },
        'https://fallback.invalid/path',
      ),
    ).toEqual(['https://a.example', 'https://b.example'])
    expect(browserbaseAllowedOrigins({}, 'https://fallback.invalid/path')).toEqual([
      'https://fallback.invalid',
    ])
  })
})
