// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { runOpenRuntimeComposition } from '../src/open-runtime-composition.js'

describe('open runtime composition', () => {
  it('composes a Codex observation through one independently checked effect', async () => {
    const result = await runOpenRuntimeComposition()

    expect(result).toMatchObject({
      strategy: 'open-runtime-composition-v0',
      fixture_level: true,
      local_only: true,
      observation: {
        authoritative_cursor_advanced: true,
        execution_evidence: false,
      },
      semantic: {
        source_observation_bound: true,
      },
      action: {
        signatures_valid: true,
        bodies_valid: true,
        pair_linked: true,
      },
      coverage: {
        valid: true,
      },
      receiver: {
        verdict: 'allow',
        state: 'allowed',
        effect_count: 1,
        verification_valid: true,
      },
    })
    expect(result.semantic.accepted_head).toBe(result.semantic.mapping_record_hash)
  }, 30_000)

  it('blocks when D168 membership omits the signed outcome', async () => {
    const result = await runOpenRuntimeComposition({
      tamper_coverage_membership: true,
    })

    expect(result.coverage.valid).toBe(false)
    expect(result.action).toMatchObject({
      signatures_valid: true,
      bodies_valid: true,
      pair_linked: true,
    })
    expect(result.receiver).toMatchObject({
      verdict: 'block',
      state: 'blocked',
      effect_count: 0,
      verification_valid: true,
    })
  }, 30_000)

  it('blocks a signed semantic mapping into the wrong task', async () => {
    const result = await runOpenRuntimeComposition({
      tamper_semantic_mapping: true,
    })

    expect(result.semantic).toMatchObject({
      accepted_head: null,
      source_observation_bound: false,
    })
    expect(result.receiver).toMatchObject({
      verdict: 'block',
      state: 'blocked',
      effect_count: 0,
      verification_valid: true,
    })
  }, 30_000)
})
