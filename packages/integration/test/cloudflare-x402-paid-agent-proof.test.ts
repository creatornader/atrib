// SPDX-License-Identifier: Apache-2.0

import { execFile } from 'node:child_process'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import type { CloudflareX402PaidAgentProofResult } from '../examples/cloudflare-agents/paid-x402-action-gate/paid-x402-action-gate-smoke.js'

const execFileAsync = promisify(execFile)
const workspaceRoot = join(process.cwd(), '..', '..')
const tsxBin = join(
  workspaceRoot,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'tsx.cmd' : 'tsx',
)

describe('Cloudflare x402 paid agent proof', () => {
  it('proves a policy-gated paid MCP request with hash-only x402 lifecycle facts', async () => {
    const { stdout } = await execFileAsync(
      tsxBin,
      ['examples/cloudflare-agents/paid-x402-action-gate/paid-x402-action-gate-smoke.ts'],
      {
        cwd: process.cwd(),
        timeout: 30000,
        maxBuffer: 1024 * 1024,
      },
    )
    const result = JSON.parse(stdout.trim()) as CloudflareX402PaidAgentProofResult

    expect(result.ok).toBe(true)
    expect(result.scope).toMatchObject({
      cloudflare_runtime: 'workers-agents',
      x402_mode: 'fixture-over-current-worker-primitives',
      gateway_beta_access: false,
      gateway_ingest_slot: 'future-lifecycle-export',
    })
    expect(result.signed_records).toMatchObject({
      decision_state: 'allowed',
      outcome_status: 'executed',
      outcome_informed_by_decision: true,
      verification_valid: true,
    })
    expect(result.payment_lifecycle).toMatchObject({
      schema: 'atrib.cloudflare-x402-paid-request-lifecycle.v1',
      source: 'cloudflare_x402_worker_fixture',
      stage: 'origin_response',
      method: 'POST',
      price: '0.01',
      network: 'base-sepolia',
      asset: 'USDC',
      verify_status: 'verified',
      settle_status: 'settled',
    })
    expect(result.proof).toEqual({
      paid_action_allowed_by_policy: true,
      action_executed: true,
      outcome_cites_decision: true,
      lifecycle_bound_to_decision: true,
      lifecycle_bound_to_outcome: true,
      lifecycle_uses_hash_only_payment_artifacts: true,
      verification_valid: true,
    })
    for (const hash of [
      result.signed_records.decision_record_hash,
      result.signed_records.outcome_record_hash,
      result.payment_lifecycle.url_hash,
      result.payment_lifecycle.payer_hash,
      result.payment_lifecycle.payee_hash,
      result.payment_lifecycle.challenge_hash,
      result.payment_lifecycle.payment_response_hash,
      result.payment_lifecycle.settlement_reference_hash,
      result.payment_lifecycle.origin_response_hash,
    ]) {
      expect(hash).toMatch(/^sha256:[0-9a-f]{64}$/u)
    }
    expect(JSON.stringify(result)).not.toContain('PAYMENT-RESPONSE public fixture')
    expect(JSON.stringify(result)).not.toContain('https://worker.example')
    expect(result.privacy).toEqual({
      public_records_hash_only: true,
      raw_payment_headers_omitted: true,
      raw_wallet_material_omitted: true,
      raw_origin_payload_omitted: true,
      gateway_logs_omitted: true,
    })
  }, 30000)
})
