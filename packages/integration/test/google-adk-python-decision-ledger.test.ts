// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { runGoogleAdkPythonDecisionLedgerProof } from '../examples/google-adk-python/google-adk-python-decision-ledger-proof.js'

describe.skipIf(process.env.ATRIB_RUN_GOOGLE_ADK_PYTHON_DECISION_LEDGER !== '1')(
  'Google ADK Python decision ledger proof',
  () => {
    it('signs Python ADK authority decisions before dispatch', async () => {
      const result = await runGoogleAdkPythonDecisionLedgerProof()

      expect(result.ok).toBe(true)
      expect(result.strategy).toBe('atrib-google-adk-python-decision-ledger-proof-v1')
      expect(result.adk).toEqual({
        python_package: 'google-adk',
        version: '2.3.0',
        runner: 'InMemoryRunner',
        plugin: 'BasePlugin',
        tool: 'FunctionTool',
        model: 'BaseLlm',
      })
      expect(result.contract).toMatchObject({
        schema: 'atrib.google-adk.decision-ledger.entry.v1',
        event_type: 'https://google-adk-decision-ledger.example/v1',
        decision_states: [
          'allowed',
          'refused',
          'confirmation_required',
          'confirmation_resolved',
          'stale_or_mismatched',
          'policy_error',
        ],
      })

      expect(result.live_adk.allowed).toMatchObject({
        decision_state: 'allowed',
        authority_mode: 'user-auth',
        selection_source: 'after_model_callback',
        model_rationale_trust: 'untrusted_generated',
        tool_body_executed: true,
        function_call_events: 1,
        function_response_events: 1,
      })
      expect(result.live_adk.allowed.decision_record_hash).toMatch(/^sha256:[0-9a-f]{64}$/)
      expect(result.live_adk.allowed.outcome_record_hash).toMatch(/^sha256:[0-9a-f]{64}$/)
      expect(result.live_adk.allowed.selection_rationale_digest).toMatch(/^sha256:[0-9a-f]{64}$/)

      expect(result.live_adk.agent_authority).toMatchObject({
        decision_state: 'allowed',
        authority_mode: 'agent-auth',
        selection_source: 'after_model_callback',
        tool_body_executed: true,
        function_call_events: 1,
        function_response_events: 1,
      })
      expect(result.live_adk.agent_authority.decision_record_hash).toMatch(/^sha256:[0-9a-f]{64}$/)
      expect(result.live_adk.agent_authority.outcome_record_hash).toMatch(/^sha256:[0-9a-f]{64}$/)

      expect(result.live_adk.handler_error).toMatchObject({
        decision_state: 'allowed',
        authority_mode: 'user-auth',
        outcome_status: 'error',
        tool_body_executed: true,
        runner_error_name: 'RuntimeError',
      })
      expect(result.live_adk.handler_error.decision_record_hash).toMatch(/^sha256:[0-9a-f]{64}$/)
      expect(result.live_adk.handler_error.outcome_record_hash).toMatch(/^sha256:[0-9a-f]{64}$/)
      expect(result.live_adk.handler_error.runner_error_message).toContain(
        'quote_price handler failed after ADK allowed the call',
      )

      expect(result.live_adk.refused).toMatchObject({
        decision_state: 'refused',
        policy_rule: 'quote_price:atlas-policy',
        policy_reason: 'sku denied by local policy',
        outcome_record_hash: null,
        tool_body_executed: false,
        function_call_events: 1,
        function_response_events: 1,
      })
      expect(result.live_adk.policy_error).toMatchObject({
        decision_state: 'policy_error',
        policy_rule: 'quote_price:atlas-policy',
        policy_reason: 'policy evaluator failed closed before dispatch',
        outcome_record_hash: null,
        tool_body_executed: false,
        function_call_events: 1,
        function_response_events: 1,
      })
      expect(result.live_adk.native_confirmation_required).toMatchObject({
        decision_state: 'confirmation_required',
        policy_source: 'confirmation',
        policy_rule: 'quote_price:native-require-confirmation',
        outcome_record_hash: null,
        requested_tool_confirmations: 1,
        adk_request_confirmation_events: 1,
        tool_body_executed: false,
        function_call_events: 2,
        function_response_events: 1,
      })

      expect(result.proof).toMatchObject({
        allowed_execution_informed_by_decision: true,
        agent_authority_execution_informed_by_decision: true,
        handler_error_execution_informed_by_decision: true,
        handler_error_terminal_outcome_signed: true,
        refused_tool_body_executed: false,
        policy_error_tool_body_executed: false,
        native_confirmation_tool_body_executed: false,
        native_confirmation_requested: true,
        model_selection_captured: true,
        agent_auth_mode_captured: true,
        refusal_rule_recorded: true,
        policy_error_rule_recorded: true,
        stale_mismatch_detected: true,
      })
      expect(result.confirmation).toMatchObject({
        fail_closed: true,
        binding_reasons: ['args_mismatch', 'confirmation_binding_mismatch'],
      })
      expect(result.confirmation.required.confirmation_binding_hash).toMatch(
        /^sha256:[0-9a-f]{64}$/,
      )
      expect(result.confirmation.resolved.confirmation_binding_hash).toBe(
        result.confirmation.required.confirmation_binding_hash,
      )
      expect(result.confirmation.stale_or_mismatched.confirmation_binding_hash).not.toBe(
        result.confirmation.required.confirmation_binding_hash,
      )

      expect(Object.keys(result.record_hashes).sort()).toEqual([
        'agent_authority_decision',
        'agent_authority_tool_outcome',
        'allowed_decision',
        'allowed_tool_outcome',
        'confirmation_required',
        'confirmation_resolved',
        'handler_error_decision',
        'handler_error_tool_outcome',
        'native_confirmation_required',
        'policy_error_decision',
        'refused_decision',
        'stale_or_mismatched',
      ])
      expect(result.publicRecords).toHaveLength(12)
      expect(result.sidecars).toHaveLength(12)
      expect(result.privacy).toEqual({
        public_records_hash_only: true,
        local_sidecars_keep_payloads: true,
        public_records_omit_private_phrase: true,
        public_records_omit_raw_principal: true,
      })
      expect(JSON.stringify(result.publicRecords)).not.toContain(
        'python decision ledger private tool note',
      )
      expect(JSON.stringify(result.publicRecords)).not.toContain('user:atlas-buyer@example.test')
      expect(JSON.stringify(result.publicRecords)).not.toContain('agent:catalog-service@example.test')
      expect(result.caveats.join(' ')).toContain('ToolConfirmation')
    }, 120000)
  },
)
