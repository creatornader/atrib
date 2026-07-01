// SPDX-License-Identifier: Apache-2.0

import { runProofVcCommonX401Interop } from '../src/proof-vc-common-x401.js'
import type { TrustRoot } from '@proof.com/proof-vc-server'

function hasFlag(name: string): boolean {
  return process.argv.includes(name)
}

function readTrustRoot(): TrustRoot | undefined {
  const value = process.env.ATRIB_PROOF_VC_COMMON_TRUST_ROOT
  if (value === undefined || value === '') return undefined
  if (value === 'development' || value === 'production') return value
  throw new Error('ATRIB_PROOF_VC_COMMON_TRUST_ROOT must be development or production')
}

async function main(): Promise<void> {
  const live = hasFlag('--live-proof-vc-common') || process.env.ATRIB_PROOF_VC_COMMON_LIVE === '1'
  const encodedVPToken = process.env.ATRIB_PROOF_VC_COMMON_VP_TOKEN
  const trustRoot = readTrustRoot()
  const aud = process.env.ATRIB_PROOF_VC_COMMON_AUD
  const result = await runProofVcCommonX401Interop({
    mode: live ? 'native' : 'fixture',
    ...(encodedVPToken ? { encodedVPToken } : {}),
    ...(trustRoot ? { trustRoot } : {}),
    ...(aud ? { aud } : {}),
  })

  console.log(JSON.stringify(result.public_packet, null, 2))

  if (hasFlag('--require-current-evidence') && !result.verification.valid) {
    process.exitCode = 1
  }
  if (hasFlag('--require-proof-vc-common') && !result.credential_result_verified) {
    process.exitCode = 1
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exitCode = 2
})
