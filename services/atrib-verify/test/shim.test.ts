// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest'
import * as shim from '../src/index.js'
import * as home from '@atrib/recall'

describe('@atrib/verify-mcp shim', () => {
  it('re-exports the legacy verify surface from @atrib/recall', () => {
    expect(shim.createAtribVerifyServer).toBe(home.createAtribVerifyServer)
    expect(shim.handleAtribVerify).toBe(home.handleAtribVerify)
    expect(shim.registerVerifyTool).toBe(home.registerVerifyTool)
    expect(shim.tryHandleAtribVerify).toBe(home.tryHandleAtribVerify)
    expect(shim.VerifyInput).toBe(home.VerifyInput)
  })

  it('keeps a hard dependency on @atrib/verify so the peer always resolves', async () => {
    const verify = await home.loadVerifyModule()
    expect(verify).not.toBeNull()
  })
})
