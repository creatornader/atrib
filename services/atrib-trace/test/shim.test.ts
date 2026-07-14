// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest'
import * as shim from '../src/index.js'
import * as home from '@atrib/recall'

describe('@atrib/trace shim', () => {
  it('re-exports the legacy trace surface from @atrib/recall', () => {
    expect(shim.createAtribTraceServer).toBe(home.createAtribTraceServer)
    expect(shim.registerTraceTools).toBe(home.registerTraceTools)
    expect(shim.runTraceWalk).toBe(home.runTraceWalk)
    expect(shim.summarizeSidecar).toBe(home.summarizeSidecar)
    expect(shim.compactVisited).toBe(home.compactVisited)
    expect(shim.extractRecordHashFieldsFromMcpResult).toBe(
      home.extractRecordHashFieldsFromMcpResult,
    )
  })
})
