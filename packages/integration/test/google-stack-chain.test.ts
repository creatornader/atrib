// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { runGoogleStackChainProof } from '../examples/google-stack-chain/google-stack-chain-proof.js'

describe.skipIf(process.env.ATRIB_RUN_GOOGLE_STACK_CHAIN_PROOF !== '1')(
  'Google stack chain proof',
  () => {
    it('threads AP2, A2A, and ADK Python with verifier-resolved informed_by links', async () => {
      const result = await runGoogleStackChainProof()

      expect(result.ok).toBe(true)
      expect(result.strategy).toBe('atrib-google-stack-chain-proof-v2')
      expect(result.continuity).toEqual({
        bridge_mode: 'explicit_informed_by',
        ap2_informs_a2a_remote: true,
        a2a_remote_informs_a2a_receiver: true,
        a2a_receiver_informs_adk_python: true,
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
          adk_python_tool_callback:
            'sha256:70d0bb2c3e38194b065a1872bbf96861b8f9f0802d323c837ede32609b548a79',
        },
      })
      expect(result.snapshot.resolved_edges).toHaveLength(3)
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
      expect(result.analytics_fixture.rows).toHaveLength(4)
      expect(result.analytics_fixture.rows.map((row) => row.atrib_record_hash)).toEqual([
        result.snapshot.record_hashes.ap2_transaction,
        result.snapshot.record_hashes.a2a_remote_evidence,
        result.snapshot.record_hashes.a2a_receiver_followup,
        result.snapshot.record_hashes.adk_python_tool_callback,
      ])
      expect(result.analytics_fixture.rows.map((row) => row.atrib_parent_record_hashes)).toEqual([
        [],
        [result.snapshot.record_hashes.ap2_transaction],
        [result.snapshot.record_hashes.a2a_remote_evidence],
        [result.snapshot.record_hashes.a2a_receiver_followup],
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
      expect(result.layers.adk_python).toMatchObject({
        protocol: 'ADK Python',
        package: 'google-adk',
        version: '2.1.0',
        runtime: 'InMemoryRunner',
        plugin: 'BasePlugin',
        operation: 'google.adk.python.tool.quote_price',
      })
      expect(result.layers.adk_python.parent_informed_by_resolved).toEqual([
        result.layers.a2a.receiver_followup_hash,
      ])
      expect(result.layers.adk_python.google_operational_ids).toMatchObject({
        trace_id: 'b31c447d70e4b50bacf6440165eeaa1e',
        span_id: 'f1973f9540673909',
        adk_session_id: 'atrib-python-smoke-session',
        adk_agent_name: 'google_adk_python_atrib_smoke_agent',
        source: 'local-adk-sidecar',
        trace_projection: 'deterministic-local',
      })
      expect(result.layers.adk_python.google_operational_ids.adk_invocation_id).toMatch(
        /^e-[0-9a-f-]+$/,
      )
      expect(result.layers.adk_python.google_operational_ids.adk_function_call_id).toMatch(
        /^adk-[0-9a-f-]+$/,
      )
      expect(result.value_add.privacy_boundary).toContain('hashes')
      expect(result.next_chunks[0]).toContain('public proof material')
      expect(result.caveats.join(' ')).toContain('not a deployed Google managed runtime run')
    })
  },
)
