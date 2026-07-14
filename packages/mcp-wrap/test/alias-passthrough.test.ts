// SPDX-License-Identifier: Apache-2.0

// Reference test for the mcp-wrap vectors of the attest-recall corpus
// alias-window family (W3): @atrib/mcp-wrap never renames tools, so a
// wrapped call can never produce an Mcp-Name header/body mismatch
// downstream. The pre-call transform only rewrites tool ARGUMENTS for
// opted-in tools; the tool-name axis is untouched for both vocabularies.

import { readFileSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { buildPreCallTransform } from '../src/wrap.js'
import type { WrapConfig } from '../src/config.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const CORPUS = resolve(HERE, '..', '..', '..', 'spec', 'conformance', 'attest-recall', 'cases')

const fixture = JSON.parse(
  readFileSync(join(CORPUS, 'alias-window', 'mcp-wrap-passthrough.json'), 'utf8'),
) as { cases: Array<{ name: string; tool: string }> }

function makeConfig(tools?: WrapConfig['tools']): WrapConfig {
  return {
    name: 'alias-passthrough',
    agent: 'claude-code',
    upstream: { command: 'echo' },
    serverUrl: 'mcp://test.local',
    logEndpoint: 'http://localhost:3100/v1/entries',
    autoChain: true,
    ...(tools !== undefined ? { tools } : {}),
  }
}

describe('attest-recall corpus: mcp-wrap pass-through (W3)', () => {
  it('applies no pre-call transform by default: params.name reaches upstream unmodified', () => {
    expect(buildPreCallTransform(makeConfig())).toBeUndefined()
  })

  it('an opted-in transform rewrites arguments only, never the tool name', () => {
    const hook = buildPreCallTransform(
      makeConfig(
        Object.fromEntries(fixture.cases.map((c) => [c.tool, { injectReceiptId: true }])),
      ),
    )
    expect(typeof hook).toBe('function')
    for (const vector of fixture.cases) {
      const transformed = hook!({
        toolName: vector.tool,
        args: { probe: true },
        receiptId: 'r.k',
        recordHash: `sha256:${'0'.repeat(64)}`,
        contextId: 'a'.repeat(32),
      })
      // The transform's output is an ARGUMENTS object; there is no channel
      // through which it could rename the tool.
      expect(transformed).not.toHaveProperty('name')
      expect(transformed).not.toHaveProperty('toolName')
    }
  })
})
