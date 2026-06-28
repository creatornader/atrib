// SPDX-License-Identifier: Apache-2.0

import { runProofX401NodeRuntimeInterop } from '../src/proof-x401-node-runtime.js'

async function main(): Promise<void> {
  const result = await runProofX401NodeRuntimeInterop()
  console.log(JSON.stringify(result.public_packet, null, 2))

  if (
    process.argv.includes('--require-native-current-spec') &&
    !result.sdk_direct_current_spec_compatible
  ) {
    process.exitCode = 1
  }
  if (process.argv.includes('--require-current-evidence') && !result.verification.valid) {
    process.exitCode = 1
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exitCode = 2
})
