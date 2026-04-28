// SPDX-License-Identifier: Apache-2.0

/**
 * Simulated non-Node runtime test (Gap #11).
 *
 * Verifies that production code returns Uint8Array instances (not Buffer
 * subclass) and that no production source file uses the Buffer global.
 * This catches regressions where someone adds Buffer.from() in a file
 * that targets Cloudflare Workers, Deno, or browser environments.
 */

import { describe, it, expect } from 'vitest'
import { readdir, readFile } from 'fs/promises'
import { join } from 'path'
import { fileURLToPath } from 'url'

describe('production code without global Buffer', () => {
  it('base64urlDecode returns Uint8Array, not Buffer', async () => {
    const { base64urlDecode } = await import('../src/base64url.js')
    const result = base64urlDecode('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA')
    expect(result.constructor.name).toBe('Uint8Array')
  })

  it('hexDecode returns Uint8Array, not Buffer', async () => {
    const { hexDecode } = await import('../src/hash.js')
    const result = hexDecode('aa'.repeat(32))
    expect(result.constructor.name).toBe('Uint8Array')
  })

  it('sha256 returns Uint8Array, not Buffer', async () => {
    const { sha256 } = await import('../src/hash.js')
    const result = sha256(new Uint8Array([1, 2, 3]))
    expect(result.constructor.name).toBe('Uint8Array')
  })

  it('canonicalSigningInput returns Uint8Array, not Buffer', async () => {
    const { canonicalSigningInput } = await import('../src/canon.js')
    const record = {
      spec_version: 'atrib/1.0' as const,
      event_type: 'https://atrib.dev/v1/types/tool_call' as const,
      timestamp: 1700000000000,
      context_id: 'a'.repeat(32),
      creator_key: 'A'.repeat(43),
      chain_root: 'sha256:' + 'b'.repeat(64),
      content_id: 'sha256:' + 'c'.repeat(64),
      signature: 'D'.repeat(86),
    }
    const result = canonicalSigningInput(record)
    expect(result.constructor.name).toBe('Uint8Array')
  })

  it('leafHash returns Uint8Array, not Buffer', async () => {
    const { leafHash } = await import('../src/merkle.js')
    const result = leafHash(new Uint8Array(90))
    expect(result.constructor.name).toBe('Uint8Array')
  })

  it('serializeEntry returns Uint8Array, not Buffer', async () => {
    const { serializeEntry, base64urlEncode } = await import('../src/index.js')
    const result = serializeEntry({
      record_hash_hex: 'aa'.repeat(32),
      creator_key_b64url: base64urlEncode(new Uint8Array(32)),
      context_id: 'bb'.repeat(16),
      timestamp: 1700000000000,
      event_type: 'https://atrib.dev/v1/types/tool_call',
    })
    expect(result.constructor.name).toBe('Uint8Array')
    expect(result.length).toBe(90)
  })

  it('no production source file uses Buffer global', async () => {
    const srcDir = join(fileURLToPath(import.meta.url), '../../src')
    const files = await readdir(srcDir)
    const tsFiles = files.filter((f) => f.endsWith('.ts'))

    const violations: string[] = []
    for (const file of tsFiles) {
      const content = await readFile(join(srcDir, file), 'utf-8')
      const lines = content.split('\n')
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!
        // Skip comments
        if (line.trimStart().startsWith('//') || line.trimStart().startsWith('*')) continue
        // Check for Buffer usage (Buffer.from, Buffer.alloc, etc.)
        if (/\bBuffer\b/.test(line)) {
          violations.push(`${file}:${i + 1}: ${line.trim()}`)
        }
      }
    }

    expect(violations).toEqual([])
  })
})
