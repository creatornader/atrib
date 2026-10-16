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
        adk_decision_informs_adk_python: true,
        a2a_receiver_informs_adk_handler_error_decision: true,
        adk_handler_error_decision_informs_terminal_outcome: true,
      })
      expect(result.snapshot).toMatchObject({
        schema: 'atrib-google-stack-chain.snapshot.v1',
        record_hashes: {
          ap2_transaction:
            'sha256:b2f4a0fcdb0e664daad0f31628139a89e49d206f3688dcd1abb278494a90552d',
          a2a_remote_evidence:
            'sha256:3e1f5632dfc4c8a465ad3d5a8ba40a2419f2da411839788ebf61c0b84550e390',
          a2a_receiver_followup:
            'sha256:fdf00bf2ee1d036195bfae584a4334c5de8475065eb7ae8fd1de5ff2d9cec281',
          adk_decision: 'sha256:c8cdb091d546dafd353b479f95f556101754990e85b4d7e86c1abe46e7c7db39',
          adk_python_tool_callback:
            'sha256:7ccf3809c3f81a5f68048512121d26fa545256fee20d2f8aa3c75321b2b4354f',
          adk_handler_error_decision:
            'sha256:504a345fe9a77f3da6f21471fa39d7b47b34a8167d01d51fe4b36913a4abc7b0',
          adk_handler_error_terminal_outcome:
            'sha256:f5941ac69efed30c6408fd8e78669bc7c9ce5e645f4814bd0e531dcad9a03e86',
        },
      })
      expect(result.snapshot.resolved_edges).toHaveLength(6)
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
      expect(result.analytics_fixture.rows).toHaveLength(7)
      expect(result.analytics_fixture.rows.map((row) => row.atrib_record_hash)).toEqual([
        result.snapshot.record_hashes.ap2_transaction,
        result.snapshot.record_hashes.a2a_remote_evidence,
        result.snapshot.record_hashes.a2a_receiver_followup,
        result.snapshot.record_hashes.adk_decision,
        result.snapshot.record_hashes.adk_python_tool_callback,
        result.snapshot.record_hashes.adk_handler_error_decision,
        result.snapshot.record_hashes.adk_handler_error_terminal_outcome,
      ])
      expect(result.analytics_fixture.rows.map((row) => row.atrib_parent_record_hashes)).toEqual([
        [],
        [result.snapshot.record_hashes.ap2_transaction],
        [result.snapshot.record_hashes.a2a_remote_evidence],
        [result.snapshot.record_hashes.a2a_receiver_followup],
        [result.snapshot.record_hashes.adk_decision],
        [result.snapshot.record_hashes.a2a_receiver_followup],
        [result.snapshot.record_hashes.adk_handler_error_decision],
      ])
      expect(result.analytics_fixture.rows.at(-1)).toMatchObject({
        event_type: 'atrib.adk_python.handler_error_terminal_outcome_signed',
        status: 'ERROR',
        error_message: 'quote_price handler failed after ADK allowed the call',
      })
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
        version: '2.3.0',
        runtime: 'InMemoryRunner',
        plugin: 'BasePlugin',
        operation: 'google.adk.python.tool.quote_price',
      })
      expect(result.layers.adk_python.parent_informed_by_resolved).toEqual([
        result.layers.a2a.receiver_followup_hash,
      ])
      expect(result.layers.adk_python.decision_informed_by_resolved).toEqual([
        result.layers.adk_python.decision_record_hash,
      ])
      expect(result.layers.adk_python.handler_error_parent_informed_by_resolved).toEqual([
        result.layers.a2a.receiver_followup_hash,
      ])
      expect(result.layers.adk_python.handler_error_outcome_informed_by_resolved).toEqual([
        result.layers.adk_python.handler_error_decision_record_hash,
      ])
      expect(result.layers.adk_python.handler_error_outcome_record_hash).toBe(
        result.snapshot.record_hashes.adk_handler_error_terminal_outcome,
      )
      expect(result.layers.adk_python.google_operational_ids).toMatchObject({
        trace_id: '4f22c9bdbeaaf460f4aca6fd8fa817ef',
        span_id: 'c0e8175ca7d0d648',
        adk_session_id: 'google-stack-adk-python-session-0001',
        adk_agent_name: 'google_adk_python_decision_allow_agent',
        source: 'local-adk-python-decision-sidecar',
        trace_projection: 'deterministic-local',
      })
      expect(result.layers.adk_python.google_operational_ids.adk_invocation_id).toBe(
        result.analytics_fixture.rows.find(
          (row) => row.event_type === 'atrib.adk_python.tool_callback_signed',
        )?.invocation_id,
      )
      expect(result.layers.adk_python.google_operational_ids.adk_invocation_id).toMatch(/\S/)
      expect(result.layers.adk_python.google_operational_ids.adk_function_call_id).toMatch(/\S/)
      expect(result.value_add.privacy_boundary).toContain('hashes')
      expect(result.next_chunks[0]).toContain('public proof material')
      expect(result.caveats.join(' ')).toContain('trust-transfer layer')
    }, 60_000)
  },
)
