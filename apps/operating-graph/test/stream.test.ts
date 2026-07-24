// SPDX-License-Identifier: Apache-2.0

import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { revisionRelation } from '../src/stream.js'

describe('operating graph stream revisions', () => {
  it('classifies duplicate, next, gap, and out-of-order revisions', () => {
    expect(revisionRelation(7, 7)).toBe('duplicate')
    expect(revisionRelation(7, 8)).toBe('next')
    expect(revisionRelation(7, 10)).toBe('gap')
    expect(revisionRelation(7, 6)).toBe('out_of_order')
  })

  it('keeps duplicate, out-of-order, and explicit gap handling in the browser client', async () => {
    const directory = dirname(fileURLToPath(import.meta.url))
    const html = await readFile(resolve(directory, '..', 'index.html'), 'utf8')
    expect(html).toContain('if (update.revision <= state.revision) return')
    expect(html).toContain('if (update.revision > state.revision + 1)')
    expect(html).toContain("stream.addEventListener('gap'")
    expect(html).toContain('if (update.current_revision <= state.revision) return')
  })
})
