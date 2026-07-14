// SPDX-License-Identifier: Apache-2.0

// Reference tests for the alias-window family of
// spec/conformance/attest-recall/: the default tools/list union with a
// bounded SEP-2549 ttlMs (W2) and SEP-2243 Mcp-Name header/body
// consistency across both vocabularies (W3).

import { readFileSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { DEFAULT_TOOLS_LIST_TTL_MS, routingHeaderMismatch } from '../src/http-host.js'
import { PRIMITIVE_SPECS } from '../src/backend.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const CORPUS = resolve(HERE, '..', '..', '..', 'spec', 'conformance', 'attest-recall', 'cases')

function loadCase<T>(...segments: string[]): T {
  return JSON.parse(readFileSync(join(CORPUS, ...segments), 'utf8')) as T
}

describe('attest-recall corpus: alias-window', () => {
  it('the default mount set serves the seventeen-tool union with a bounded ttlMs (W2)', () => {
    const fixture = loadCase<{
      expected: { tools: string[]; max_default_ttl_ms: number; cache_scope: string }
    }>('alias-window', 'tools-list-union.json')
    const mountedUnion = PRIMITIVE_SPECS.flatMap((spec) => [...spec.expectedTools]).sort((a, b) =>
      a.localeCompare(b),
    )
    expect(mountedUnion).toEqual(fixture.expected.tools)
    expect(DEFAULT_TOOLS_LIST_TTL_MS).toBeLessThanOrEqual(fixture.expected.max_default_ttl_ms)
  })

  it('Mcp-Name header/body consistency holds across both vocabularies (W3)', () => {
    const fixture = loadCase<{
      cases: Array<{
        name: string
        mcp_name_header: string
        body_tool: string
        expected: 'accepted' | 'rejected'
      }>
    }>('alias-window', 'mcp-name-vectors.json')
    for (const vector of fixture.cases) {
      const body = {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: vector.body_tool, arguments: {} },
      }
      const mismatch = routingHeaderMismatch(undefined, vector.mcp_name_header, body)
      if (vector.expected === 'accepted') {
        expect(mismatch, vector.name).toBeUndefined()
      } else {
        expect(mismatch, vector.name).toBeDefined()
      }
    }
  })
})
