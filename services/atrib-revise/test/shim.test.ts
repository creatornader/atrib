// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest'
import * as shim from '../src/index.js'
import * as home from '@atrib/attest'

describe('@atrib/revise shim', () => {
  it('re-exports the legacy revise surface from @atrib/attest', () => {
    expect(shim.ReviseInput).toBe(home.ReviseInput)
    expect(shim.createAtribReviseServer).toBe(home.createAtribReviseServer)
    expect(shim.registerReviseTool).toBe(home.registerReviseTool)
  })
})
