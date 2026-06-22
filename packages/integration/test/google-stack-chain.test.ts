// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { runGoogleStackChainProof } from '../examples/google-stack-chain/google-stack-chain-proof.js'

describe.skipIf(process.env.ATRIB_RUN_GOOGLE_STACK_CHAIN_PROOF !== '1')(
  'Google stack chain proof',
  () => {
    it('threads AP2, A2A, and ADK decisions with verifier-resolved informed_by links', async () => {
      const result = await runGoogleStackChainProof()

      expect(result.ok).toBe(true)
      expect(result.strategy).toBe('atrib-google-stack-chain-proof-v3')
      expect(result.continuity).toEqual({
        bridge_mode: 'explicit_informed_by',
        ap2_informs_a2a_remote: true,
        a2a_remote_informs_a2a_receiver: true,
        a2a_receiver_informs_adk_decision: true,
        adk_decision_informs_adk_js: true,
      })
      expect(result.snapshot).toMatchObject({
        schema: 'atrib-google-stack-chain.snapshot.v1',
        record_hashes: {
          ap2_transaction:
            'sha256:e5f103d959cbb1e316e6d658b35fabc547b6b9b3bd530d0165cfbe48155cc6db',
          a2a_remote_evidence:
            'sha256:23e25fd31fc81cf8f6d668cf68454d05c6018451f3a7467fc15f2649277e42f9',
          a2a_receiver_followup:
            'sha256:1225fb6849cab06d9bec936abdf28f5ff1a4e2872ea8f5a87c1b469c54c18fb2',
          adk_decision:
            'sha256:4d30b4e5d7557ac2450f65c397f5442f9c45a7bad85c219de65153fcdc93294f',
          adk_js_tool_callback:
            'sha256:61e7c3f52266ac2a24c22336f5c5e53539b1e55d91b78725fe9d70fe9b966a56',
        },
      })
      expect(result.snapshot.resolved_edges).toHaveLength(4)
      expect(result.analytics_fixture).toMatchObject({
        schema: 'atrib-google-stack-chain.bigquery-agent-analytics.fixture.v1',
        source: 'local-fixture',
        caveat:
          'This is a local BigQuery Agent Analytics-shaped fixture, not a BigQuery Storage Write API export or a managed Google Cloud run.',
      })
      expect(result.analytics_fixture.common_columns).toEqual([
        'timestamp',
        'event_type',
        'agent',
        'session_id',
        'invocation_id',
        'user_id',
        'trace_id',
        'span_id',
        'parent_span_id',
        'status',
        'error_message',
        'is_truncated',
      ])
      expect(result.analytics_fixture.rows).toHaveLength(5)
      expect(result.analytics_fixture.rows.map((row) => row.atrib_record_hash)).toEqual([
        result.snapshot.record_hashes.ap2_transaction,
        result.snapshot.record_hashes.a2a_remote_evidence,
        result.snapshot.record_hashes.a2a_receiver_followup,
        result.snapshot.record_hashes.adk_decision,
        result.snapshot.record_hashes.adk_js_tool_callback,
      ])
      expect(result.analytics_fixture.rows.map((row) => row.atrib_parent_record_hashes)).toEqual([
        [],
        [result.snapshot.record_hashes.ap2_transaction],
        [result.snapshot.record_hashes.a2a_remote_evidence],
        [result.snapshot.record_hashes.a2a_receiver_followup],
        [result.snapshot.record_hashes.adk_decision],
      ])
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
      expect(result.layers.a2a.remote_informed_by_resolved).toEqual([
        result.layers.ap2.transaction_record_hash,
      ])
      expect(result.layers.a2a.informed_by_resolved).toEqual([result.layers.a2a.remote_record_hash])
      expect(result.layers.adk_js).toMatchObject({
        protocol: 'ADK JS',
        package: '@google/adk',
        version: '1.2.0',
        runtime: 'InMemoryRunner',
        plugin: 'BasePlugin',
        operation: 'google.adk.tool.quote_price',
      })
      expect(result.layers.adk_js.parent_informed_by_resolved).toEqual([
        result.layers.a2a.receiver_followup_hash,
      ])
      expect(result.layers.adk_js.decision_informed_by_resolved).toEqual([
        result.layers.adk_js.decision_record_hash,
      ])
      expect(result.layers.adk_js.google_operational_ids).toMatchObject({
        trace_id: '742ef877246a075452d965328d32ff98',
        span_id: 'a273389a6a9ffa14',
        adk_session_id: 'google-stack-adk-js-session-0001',
        adk_agent_name: 'google_adk_decision_allow_agent',
        source: 'local-adk-decision-sidecar',
        trace_projection: 'deterministic-local',
      })
      expect(result.layers.adk_js.google_operational_ids.adk_invocation_id).toBe(
        'e-c381ebeb-a58a-4132-b423-ae11d7372099',
      )
      expect(result.layers.adk_js.google_operational_ids.adk_function_call_id).toBe(
        'adk-decision-call-atlas-kit',
      )
      expect(result.value_add.privacy_boundary).toContain('hashes')
      expect(result.next_chunks[0]).toContain('public proof material')
      expect(result.caveats.join(' ')).toContain('trust-transfer layer')
    })
  },
)
