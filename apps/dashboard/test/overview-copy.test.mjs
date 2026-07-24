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

  it('uses the resumable log stream with a polling fallback', () => {
    expect(html).toContain('function startLiveUpdates()')
    expect(html).toContain("streamUrl.searchParams.set('after', String(lastFeedCursor))")
    expect(html).toContain("stream.addEventListener('log_entry'")
    expect(html).toContain("setFeedLiveStatus('reconnecting', 'warn')")
    expect(html).toContain("setFeedLiveStatus('polling', 'fallback')")
    expect(html).toContain('feedEntries.some((known) => known.record_hash === entry.record_hash)')
    expect(html).toContain('new EventSource(streamUrl.href)')
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
    expect(html).toContain('function x401ProofGateLabel(block)')
    expect(html).toContain('function x401PaymentSeparationLabel(block)')
    expect(html).toContain('function x401ExternalFactsLabel(block)')
    expect(html).toContain('x401 proof gate')
    expect(html).toContain('payment hint separate')
    expect(html).toContain('issuer trust')
    expect(html).toContain('proof payment binding')
    expect(html).toContain('const entryWithEvidence = mergeArchiveEvidence(entry, archiveEvidence)')
    expect(html).toContain(
      "renderRawJsonPanel('log entry projection', 'commitment-visible fields from /v1/lookup', entry)",
    )
    expect(html).toContain('.panel.flush table.evidence-feed { min-width: 0; }')
    expect(html).toContain('External evidence blocks passed verifier checks.')
  })

  it('separates log commitments from archive body availability', () => {
    expect(html).toContain('async function fetchArchiveRecordState(endpoint, hashHex')
    expect(html).toContain("state: 'available'")
    expect(html).toContain("state: 'commitment_only'")
    expect(html).toContain("state: 'expired'")
    expect(html).toContain("state: 'access_denied'")
    expect(html).toContain("state: 'archive_unavailable'")
    expect(html).toContain('function bodyAvailabilityStatus(archiveRecord)')
    expect(html).toContain("'archived signed record body'")
    expect(html).toContain('Direct browser re-verification requires the archived body.')
  })
})

describe('session revision state copy', () => {
  it('keeps public commitments distinct from receiver-accepted state', () => {
    expect(html).toContain('function renderPublicRevisionStatePanel(state)')
    expect(html).toContain("el('h2', {}, 'current revision state')")
    expect(html).toContain('Every visible head remains visible.')
    expect(html).toContain(
      'This browser view does not apply a receiver trust policy or independently verify inclusion proofs.',
    )
    expect(html).toContain('public commitment view')
    expect(html).toContain('/graph-utils.mjs?v=2026-07-23-public-revision-state')
  })
})
