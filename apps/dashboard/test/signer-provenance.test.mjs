import { describe, expect, it } from 'vitest'
import { signerProvenance, signerProvenanceLabel } from '../signer-provenance.mjs'

describe('signer provenance ledger', () => {
  it('labels reviewed fixture keys without presenting them as people', () => {
    const provenance = signerProvenance('_RckOFqgx1tk-3jNYC_h2ZH96_drE8WO1wLqyDXp9hg')
    expect(provenance).toMatchObject({
      kind: 'fixture',
      label: 'Atrib Cloud action fixture',
    })
  })

  it('keeps a directory claim ahead of the reviewed system ledger', () => {
    expect(signerProvenanceLabel('Fjr7AWfgHp5eBtsxaYgiGQCzFCEx8B7BCLLIVvb8qwM', true))
      .toEqual({ kind: 'claimed', label: 'claimed identity', detail: null })
  })

  it('describes an absent claim as an unregistered public key', () => {
    expect(signerProvenanceLabel('not-reviewed')).toMatchObject({
      kind: 'unregistered',
      label: 'unregistered public key',
    })
  })
})
