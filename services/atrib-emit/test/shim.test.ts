// SPDX-License-Identifier: Apache-2.0

// The @atrib/emit shim must keep the legacy public surface importable and
// functionally identical: everything here re-exports from @atrib/attest.

import { describe, expect, it } from 'vitest'
import * as shim from '../src/index.js'
import * as home from '@atrib/attest'

describe('@atrib/emit shim', () => {
  it('re-exports the legacy write surface from @atrib/attest', () => {
    const legacySymbols = [
      'createAtribEmitServer',
      'handleEmit',
      'emitInProcess',
      'EmitInput',
      'resolveKey',
      'requiresExplicitContextId',
      'resolveEmitLocalSubstrateShadowFromEnv',
      'resolveEmitLocalSubstrateCommitFromEnv',
      'emitSessionCheckpoint',
    ] as const
    for (const symbol of legacySymbols) {
      expect(shim[symbol], symbol).toBeDefined()
      expect(shim[symbol], symbol).toBe((home as Record<string, unknown>)[symbol])
    }
  })

  it('also exposes the write verb (attest) surface', () => {
    expect(shim.createAtribAttestServer).toBe(home.createAtribAttestServer)
    expect(shim.attestInProcess).toBe(home.attestInProcess)
    expect(shim.AttestInput).toBe(home.AttestInput)
  })
})
