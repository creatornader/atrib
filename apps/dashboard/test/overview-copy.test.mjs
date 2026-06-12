import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')

describe('overview copy', () => {
  it('uses user-facing trust labels in the pulse strip', () => {
    expect(html).toContain("pulseStat('log health', '—')")
    expect(html).toContain("pulseStat('protected history', '—')")
    expect(html).toContain("pulseStat('active signers', '—')")
    expect(html).toContain("pulseStat('proof status', '—')")
  })

  it('keeps backend-oriented overview labels out of the first screen', () => {
    expect(html).not.toContain("pulseStat('latest record', '—')")
    expect(html).not.toContain("pulseStat('latest checkpoint', '—')")
    expect(html).not.toContain("pulseStat('signed records', '—')")
    expect(html).not.toContain("pulseStat('signing actors', '—')")
    expect(html).not.toContain("pulseStat('signing identities', '—')")
  })

  it('routes overview search through human-readable inputs', () => {
    expect(html).toContain('Search by creator key, session id, or record hash')
    expect(html).toContain('43-char creator key')
    expect(html).toContain('32-hex session id')
    expect(html).toContain('sha256:… record hash')
    expect(html).not.toContain('Search by creator_key, context_id, or record_hash')
  })

  it('can render verifier evidence blocks on action receipts when returned', () => {
    expect(html).toContain('function renderEvidencePanel(blocks)')
    expect(html).toContain("archive:   'https://archive.atrib.dev/v1'")
    expect(html).toContain('function mergeArchiveEvidence(entry, archiveResponse)')
    expect(html).toContain('/evidence/${hashHex}`')
    expect(html).toContain('timeoutMs: 1200')
    expect(html).toContain("label: 'evidence'")
    expect(html).toContain('external evidence')
    expect(html).toContain("class: 'feed evidence-feed'")
    expect(html).toContain("el('th', {}, 'authority')")
    expect(html).toContain("data-label': 'authority'")
    expect(html).toContain('function evidenceAuthorityLabel(block)')
    expect(html).toContain('.panel.flush table.evidence-feed { min-width: 0; }')
    expect(html).toContain('External evidence blocks passed verifier checks.')
  })
})
