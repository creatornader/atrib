// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest'
import * as shim from '../src/index.js'
import * as home from '@atrib/attest'

describe('@atrib/annotate shim', () => {
  it('re-exports the legacy annotate surface from @atrib/attest', () => {
    expect(shim.AnnotateInput).toBe(home.AnnotateInput)
    expect(shim.Importance).toBe(home.Importance)
    expect(shim.createAtribAnnotateServer).toBe(home.createAtribAnnotateServer)
    expect(shim.registerAnnotateTool).toBe(home.registerAnnotateTool)
  })
})
