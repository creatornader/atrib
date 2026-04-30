/**
 * Generate spec §6 conformance corpus fixtures (initial subset).
 *
 * Run with: pnpm --filter @atrib/log-dev tsx scripts/generate-conformance-6.ts
 *
 * Output: spec/conformance/6/cases/*.json + manifest.json
 *
 * Generates the two foundational cases:
 *   - valid-self-attested-claim:  publish + lookup; the claim is signed by
 *                                  the operator and surfaces verbatim.
 *   - valid-non-membership:        lookup of an unregistered key returns
 *                                  found:false.
 *
 * These two cover the directory_lookup vs no_claim_registered branches in
 * resolveIdentity (§6.3 step 6 + 8). Other cases enumerated in
 * spec/conformance/6/README.md (anchor coherence, append-only consistency,
 * AKD proof validation, witness coverage, capability envelopes) generate
 * once the corpus runner exercises a live directory + log against the
 * fixtures end-to-end.
 *
 * The seed and timestamps are hardcoded for byte-identical regeneration.
 */

import { writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import {
  base64urlEncode,
  getPublicKey,
} from '@atrib/mcp'
import { signClaim } from '@atrib/directory'
import type { IdentityClaim } from '@atrib/directory'

const SUBJECT_SEED = new Uint8Array(32).fill(0x33)
const REFERENCE_TIME_MS = Date.UTC(2026, 0, 1, 0, 0, 0)

const HERE = dirname(fileURLToPath(import.meta.url))
const CORPUS_ROOT = resolve(HERE, '../../../spec/conformance/6')
const CASES_DIR = join(CORPUS_ROOT, 'cases')

mkdirSync(CASES_DIR, { recursive: true })

async function main(): Promise<void> {
  const subjectPub = await getPublicKey(SUBJECT_SEED)
  const subjectKey = base64urlEncode(subjectPub)

  // Case 1: valid-self-attested-claim
  const claim = await signClaim(
    {
      creator_key: subjectKey,
      claim_type: 'self_attested',
      claim_method: 'self',
      claim_subject: {
        display_name: 'Conformance Test Subject',
        organization: 'atrib',
      },
    },
    SUBJECT_SEED,
  )

  const claimCase = {
    name: 'valid-self-attested-claim',
    spec_section: '6',
    description:
      'A self-attested IdentityClaim is published to the directory; lookup ' +
      'for the creator_key returns the claim. resolveIdentity surfaces ' +
      'identity_resolved with the parsed claim and identity_resolution_method = ' +
      '"directory_lookup".',
    input: {
      published_claim: claim,
      lookup_for_key: subjectKey,
    },
    expected: {
      directory_response: {
        status: 200,
        body: {
          found: true,
          claim,
          version: 1,
        },
      },
      verifier_output: {
        identity_resolved: claim,
        identity_resolution_method: 'directory_lookup',
        capability_envelope: null,
        key_revocation_status: null,
      },
    },
  }

  // Case 2: valid-non-membership
  const unregisteredKey = base64urlEncode(new Uint8Array(32).fill(0x44))
  const nonMembershipCase = {
    name: 'valid-non-membership',
    spec_section: '6',
    description:
      'Lookup of a creator_key with no published claim returns found:false. ' +
      'resolveIdentity surfaces identity_resolved=null and ' +
      'identity_resolution_method = "no_claim_registered".',
    input: {
      lookup_for_key: unregisteredKey,
    },
    expected: {
      directory_response: {
        status: 404,
        body: { found: false },
      },
      verifier_output: {
        identity_resolved: null,
        identity_resolution_method: 'no_claim_registered',
        capability_envelope: null,
        key_revocation_status: null,
      },
    },
  }

  writeFileSync(join(CASES_DIR, 'valid-self-attested-claim.json'), JSON.stringify(claimCase, null, 2) + '\n')
  writeFileSync(join(CASES_DIR, 'valid-non-membership.json'), JSON.stringify(nonMembershipCase, null, 2) + '\n')

  const manifest = {
    spec_section: '6',
    generated_at: REFERENCE_TIME_MS,
    cases: [
      { file: 'cases/valid-self-attested-claim.json', name: 'valid-self-attested-claim' },
      { file: 'cases/valid-non-membership.json', name: 'valid-non-membership' },
    ],
    keys: {
      subject_pubkey: subjectKey,
      unregistered_pubkey: unregisteredKey,
    },
    note:
      'These two cases cover the membership / non-membership branches in ' +
      'resolveIdentity (§6.3 step 6 + 8). Cases enumerated in README.md that ' +
      'require live AKD proofs (anchor-coherence, append-only-consistency, ' +
      'AKD proof validation, witness coverage) generate once a corpus runner ' +
      'exercises the live directory-node + log-node pair against fixtures.',
  }

  writeFileSync(join(CORPUS_ROOT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')

  console.log('Generated spec/conformance/6/ corpus:')
  console.log('  cases/valid-self-attested-claim.json')
  console.log('  cases/valid-non-membership.json')
  console.log('  manifest.json')
}

void main()
