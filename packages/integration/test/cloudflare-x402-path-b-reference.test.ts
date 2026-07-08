// SPDX-License-Identifier: Apache-2.0

import { execFile } from 'node:child_process'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import type { CloudflareX402PathBReferenceResult } from '../examples/cloudflare-agents/x402-path-b-reference/x402-path-b-reference-smoke.js'

const execFileAsync = promisify(execFile)
const workspaceRoot = join(process.cwd(), '..', '..')
const tsxBin = join(
  workspaceRoot,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'tsx.cmd' : 'tsx',
)

describe('Cloudflare x402 Path B reference proof', () => {
  it('proves agent-side x402 transaction emission with hash-only lifecycle facts', async () => {
    const { stdout } = await execFileAsync(
      tsxBin,
      ['examples/cloudflare-agents/x402-path-b-reference/x402-path-b-reference-smoke.ts'],
      {
        cwd: process.cwd(),
        timeout: 30000,
        maxBuffer: 1024 * 1024,
      },
    )
    const result = JSON.parse(stdout.trim()) as CloudflareX402PathBReferenceResult

    expect(result.ok).toBe(true)
    expect(result.scope).toEqual({
      cloudflare_runtime: 'workers-agents',
      x402_mode: 'local-v2-protocol-flow',
      gateway_beta_access: false,
      real_funds_moved: false,
      gateway_ingest_slot: 'future-lifecycle-export',
    })
    expect(result.open_protocol_surface.headers).toEqual({
      challenge_status: 402,
      paid_retry_header: 'PAYMENT-SIGNATURE',
      settlement_header: 'PAYMENT-RESPONSE',
      legacy_settlement_header: 'X-PAYMENT-RESPONSE',
    })
    expect(result.atrib_product_surface).toMatchObject({
      action_gate_package: '@atrib/action-gate',
      agent_package: '@atrib/agent',
      detector: 'PAYMENT-RESPONSE',
    })
    expect(result.x402_flow).toMatchObject({
      first_response_status: 402,
      paid_retry_sent: true,
      origin_response_status: 200,
      traceparent_preserved_across_retry: true,
      atrib_context_preserved_across_retry: true,
    })
    expect(result.signed_records).toMatchObject({
      decision_state: 'allowed',
      outcome_status: 'executed',
      transaction_protocol: 'x402',
      transaction_content_id_matches_x402_endpoint: true,
      transaction_context_matches_gate: true,
      transaction_warning_recorded: true,
      agent_transaction_signer_count: 1,
      counterparty_attested_signer_count: 2,
      counterparty_signers_valid: true,
    })
    expect(result.proof).toEqual({
      action_allowed_before_paid_retry: true,
      x402_detector_fired: true,
      path_b_transaction_emitted_by_agent: true,
      retry_kept_trace_context: true,
      lifecycle_bound_to_decision: true,
      lifecycle_bound_to_outcome: true,
      lifecycle_bound_to_transaction: true,
      lifecycle_uses_hash_only_payment_artifacts: true,
      counterparty_attested_same_transaction_bytes: true,
    })
    for (const hash of [
      result.signed_records.decision_record_hash,
      result.signed_records.outcome_record_hash,
      result.signed_records.agent_transaction_record_hash,
      result.signed_records.counterparty_attested_transaction_hash,
      result.payment_lifecycle.url_hash,
      result.payment_lifecycle.payer_hash,
      result.payment_lifecycle.payee_hash,
      result.payment_lifecycle.challenge_hash,
      result.payment_lifecycle.payment_signature_hash,
      result.payment_lifecycle.payment_response_hash,
      result.payment_lifecycle.settlement_reference_hash,
      result.payment_lifecycle.origin_response_hash,
    ]) {
      expect(hash).toMatch(/^sha256:[0-9a-f]{64}$/u)
    }
    expect(JSON.stringify(result)).not.toContain('paid dataset response is local test content')
    expect(JSON.stringify(result)).not.toContain('0x' + 'cd'.repeat(65))
    expect(JSON.stringify(result)).not.toContain('0x' + 'ef'.repeat(32))
    expect(result.privacy).toEqual({
      raw_payment_challenge_omitted: true,
      raw_payment_signature_omitted: true,
      raw_payment_response_omitted: true,
      raw_wallet_material_omitted: true,
      raw_origin_payload_omitted: true,
    })
  }, 30000)
})
