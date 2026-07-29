// Reviewed provenance for public keys whose source is known without a
// directory self-claim. A directory claim remains the only self-attested
// identity binding. This ledger describes system and fixture provenance.

export const SIGNER_PROVENANCE = Object.freeze({
  Fjr7AWfgHp5eBtsxaYgiGQCzFCEx8B7BCLLIVvb8qwM: {
    kind: 'system',
    label: 'graph indexing canary',
    detail: 'Persistent graph.atrib.dev deployment verification identity.',
  },
  aIlsLmySxV00W3kdtm1qo8kirR9LieeygoPYND4ekH8: {
    kind: 'retired-system',
    label: 'graph indexing canary: retired development key',
    detail: 'Legacy public canary seed. Retired from live deployment verification.',
  },
  '7UkoxijRwsbq6QM4kFmVYSlZJzpcY_k2NsFGFKyHN9E': {
    kind: 'fixture',
    label: 'Atrib Cloud rejected-owner fixture',
    detail: 'Deterministic Action Control test key. Public submission is disabled.',
  },
  '_RckOFqgx1tk-3jNYC_h2ZH96_drE8WO1wLqyDXp9hg': {
    kind: 'fixture',
    label: 'Atrib Cloud action fixture',
    detail: 'Deterministic Action Control test key. Public submission is disabled.',
  },
  '-kg0FH9uaQw2k-_2EzYEZAPNiuKhTzGzxAc1hWkjlWU': {
    kind: 'fixture',
    label: 'Atrib Cloud owner-mapping fixture',
    detail: 'Deterministic Action Control test key. Public submission is disabled.',
  },
  '6NpjpAymh8h8_OBcskp4bH51zEnHDbVXPwJvHGqGzqo': {
    kind: 'fixture',
    label: 'atribd native MCP fixture',
    detail: 'Deterministic atribd test key. It is not a user or customer identity.',
  },
})

export function signerProvenance(creatorKey) {
  return SIGNER_PROVENANCE[creatorKey] ?? null
}

export function signerProvenanceLabel(creatorKey, hasDirectoryClaim = false) {
  if (hasDirectoryClaim) return { kind: 'claimed', label: 'claimed identity', detail: null }
  return signerProvenance(creatorKey) ?? {
    kind: 'unregistered',
    label: 'unregistered public key',
    detail: 'The log verifies this key. Its operator has not published a directory claim or reviewed provenance entry.',
  }
}
