// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { runGoogleStackChainProof } from '../examples/google-stack-chain/google-stack-chain-proof.js'

describe.skipIf(process.env.ATRIB_RUN_GOOGLE_STACK_CHAIN_PROOF !== '1')(
  'Google stack chain proof',
  () => {
    it('composes AP2, A2A, and ADK Python proof summaries', async () => {
      const result = await runGoogleStackChainProof()

      expect(result.ok).toBe(true)
      expect(result.layers.ap2).toMatchObject({
        protocol: 'AP2',
        detected: true,
        evidence_valid: true,
        transaction_accepted: true,
      })
      expect(result.layers.ap2.transaction_record_hash).toMatch(/^sha256:[0-9a-f]{64}$/)
      expect(result.layers.a2a).toMatchObject({
        protocol: 'A2A',
        sdk: '@a2a-js/sdk',
        agent_card_signature_valid: true,
      })
      expect(result.layers.a2a.informed_by_resolved).toEqual([result.layers.a2a.remote_record_hash])
      expect(result.layers.adk_python).toMatchObject({
        protocol: 'ADK Python',
        package: 'google-adk',
        version: '2.1.0',
        runtime: 'InMemoryRunner',
        plugin: 'BasePlugin',
        operation: 'google.adk.python.tool.quote_price',
      })
      expect(result.value_add.privacy_boundary).toContain('hashes')
      expect(result.next_chunks[0]).toContain('shared context_id')
      expect(result.caveats.join(' ')).toContain('not a deployed Google managed runtime run')
    })
  },
)
