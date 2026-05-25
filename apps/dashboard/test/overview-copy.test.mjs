import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')

describe('overview copy', () => {
  it('uses user-facing trust labels in the pulse strip', () => {
    expect(html).toContain("pulseStat('log health', '—')")
    expect(html).toContain("pulseStat('protected history', '—')")
    expect(html).toContain("pulseStat('signing actors', '—')")
    expect(html).toContain("pulseStat('proof status', '—')")
  })

  it('keeps backend-oriented overview labels out of the first screen', () => {
    expect(html).not.toContain("pulseStat('latest record', '—')")
    expect(html).not.toContain("pulseStat('latest checkpoint', '—')")
    expect(html).not.toContain("pulseStat('signed records', '—')")
    expect(html).not.toContain("pulseStat('signing identities', '—')")
  })

  it('routes overview search through human-readable inputs', () => {
    expect(html).toContain('Search by creator key, session id, or record hash')
    expect(html).toContain('43-char creator key')
    expect(html).toContain('32-hex session id')
    expect(html).toContain('sha256:… record hash')
    expect(html).not.toContain('Search by creator_key, context_id, or record_hash')
  })
})
