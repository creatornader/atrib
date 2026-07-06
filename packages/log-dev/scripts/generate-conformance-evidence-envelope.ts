/**
 * Generate the universal evidence envelope conformance corpus (P042 / §5.5.7).
 *
 * Run with: pnpm --filter @atrib/log-dev exec tsx scripts/generate-conformance-evidence-envelope.ts
 *
 * Output: spec/conformance/evidence-envelope/cases/<family>--<name>.json + manifest.json
 *
 * The universal evidence envelope is the single protocol-level attachment
 * model for all externally verifiable material (OAuth/MCP, AAuth, x401,
 * AP2 / VI, human approvals, counterparty attestations, and future
 * profiles). Envelopes live only outside signed record bytes: in the local
 * mirror sidecar (§5.9.3), the archive evidence projection (§2.12),
 * verifier results, and host-owned packets. The corpus pins five contract
 * families:
 *
 *   1. shape/           Envelope schema validity: required fields, the
 *                       four-value tier enum, the five-value ref.kind enum,
 *                       hash prefix, inline/ref.kind coupling, and the
 *                       ref.record_hash sibling rule (record_hash is NOT a
 *                       kind value).
 *   2. registry/        Profile registration rule: absolute HTTPS type
 *                       URIs only; atrib-maintained names live under
 *                       https://atrib.dev/v1/evidence/<name>; a foreign
 *                       domain reusing an atrib name is a third-party
 *                       profile, never the atrib one.
 *   3. unknown-profile/ Unknown-profile preservation: consumers MUST keep
 *                       unknown envelopes byte-identical, render them
 *                       opaquely, and MUST NOT drop them.
 *   4. legacy-mapping/  Deterministic mapping from the five frozen legacy
 *                       §5.5.6 protocol strings ('oauth2', 'mcp_oauth',
 *                       'aauth', 'x401', 'ap2_vi') to envelope form; a
 *                       sixth protocol string MUST be rejected.
 *   5. tier/            Tier semantics: the tier belongs to the envelope
 *                       instance, relays must not swap verifier identity,
 *                       'verified'-with-withheld-payload reports as
 *                       claimed-but-not-reproducible, and evidence NEVER
 *                       flips verifyRecord().valid.
 *
 * Seeds and timestamps are hardcoded so successive regenerations produce
 * byte-identical files. Re-run when:
 *   - the envelope schema or tier enum changes (requires revising the
 *     evidence-envelope ADR first, per its closed-enum rule)
 *   - the legacy-to-profile mapping table changes (it must not: the legacy
 *     protocol string set is frozen at five)
 *   - a new test case or profile family is added
 */

import { writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import {
  canonicalRecord,
  getPublicKey,
  base64urlEncode,
  signRecord,
  type AtribRecord,
} from '@atrib/mcp'
import { sha256 } from '@noble/hashes/sha2.js'

// ─── Envelope schema (mirrors the §5.5.7 normative shape) ─────────────

type EvidenceTier = 'declared' | 'shape' | 'attested' | 'verified'
type EvidenceRefKind = 'inline' | 'mirror' | 'archive' | 'external' | 'withheld'
type EvidenceConstraintStatus = 'passed' | 'failed' | 'unresolved' | 'not_checked'

interface EvidenceEnvelopeRef {
  kind: EvidenceRefKind
  uri?: string | null
  record_hash?: string | null
}

interface EvidenceEnvelopePayload {
  hash: string
  media_type?: string
  ref: EvidenceEnvelopeRef
  inline?: unknown
}

interface EvidenceEnvelopeConstraint {
  type: string
  status: EvidenceConstraintStatus
  expected?: unknown
  actual?: unknown
  reason?: string
}

interface EvidenceEnvelopeResult {
  valid: boolean
  constraints: EvidenceEnvelopeConstraint[]
  errors: string[]
  warnings: string[]
}

interface EvidenceEnvelopeVerifier {
  name: string
  version?: string
  checked_at_ms?: number
}

interface EvidenceEnvelope {
  envelope: 1
  profile: string
  profile_version: string
  tier: EvidenceTier
  payload: EvidenceEnvelopePayload
  facts?: Record<string, unknown>
  result: EvidenceEnvelopeResult
  verifier?: EvidenceEnvelopeVerifier
}

/** Legacy §5.5.6 generic evidence block shape (packages/verify/src). */
interface LegacyEvidenceBlock {
  protocol: string
  valid: boolean
  issuer: string | null
  subject: string | null
  scope: string[]
  attenuation_ok: boolean | null
  delegation_ok: boolean | null
  constraints: EvidenceEnvelopeConstraint[]
  errors: string[]
  warnings: string[]
  details?: unknown
}

// ─── Deterministic constants ───────────────────────────────────────────

const ALICE_SEED = new Uint8Array(32).fill(0x51)
const REFERENCE_TIME_MS = Date.UTC(2026, 6, 1, 0, 0, 0) // 2026-07-01T00:00:00Z
const ALICE_CONTEXT = 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'

const ATRIB_PROFILE_BASE = 'https://atrib.dev/v1/evidence/'
const ATRIB_PROFILE_REGISTRY = [
  'oauth2',
  'mcp-oauth',
  'aauth',
  'x401',
  'ap2-vi',
  'human-approval',
  'counterparty-attestation',
  'delegation-certificate',
] as const

/**
 * The frozen legacy protocol string set. Exactly five rows, final. A sixth
 * row is a conformance failure, not an extension point.
 */
const LEGACY_PROTOCOL_TO_PROFILE: Record<string, string> = {
  oauth2: `${ATRIB_PROFILE_BASE}oauth2`,
  mcp_oauth: `${ATRIB_PROFILE_BASE}mcp-oauth`,
  aauth: `${ATRIB_PROFILE_BASE}aauth`,
  x401: `${ATRIB_PROFILE_BASE}x401`,
  ap2_vi: `${ATRIB_PROFILE_BASE}ap2-vi`,
}

const HERE = dirname(fileURLToPath(import.meta.url))
const CORPUS_ROOT = resolve(HERE, '../../../spec/conformance/evidence-envelope')
const CASES_DIR = join(CORPUS_ROOT, 'cases')

const utf8 = new TextEncoder()

// ─── Helpers ───────────────────────────────────────────────────────────

function hex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('hex')
}

/**
 * RFC 8785 (JCS) canonicalization for plain JSON values. Recursive
 * lexicographic key sort + JSON.stringify, which matches the
 * `canonicalize` npm package byte-for-byte for JSON data (the reference
 * test in @atrib/verify recomputes every committed hash with the real
 * `canonicalize` package, so the two implementations cross-check each
 * other through the committed vectors).
 */
function jcs(value: unknown): string {
  return JSON.stringify(sortJsonValue(value))
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJsonValue)
  if (value !== null && typeof value === 'object') {
    const sorted: Record<string, unknown> = {}
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const entry = (value as Record<string, unknown>)[key]
      if (entry !== undefined) sorted[key] = sortJsonValue(entry)
    }
    return sorted
  }
  return value
}

/** §5.5.7 hash rule for JSON payloads: sha256 over JCS bytes. */
function jcsSha256(value: unknown): string {
  return 'sha256:' + hex(sha256(utf8.encode(jcs(value))))
}

/** §5.5.7 hash rule for non-JSON media types: sha256 over the raw bytes. */
function rawSha256(text: string): string {
  return 'sha256:' + hex(sha256(utf8.encode(text)))
}

/**
 * Deterministic legacy-block-to-envelope mapping (`fromLegacyEvidenceBlock`
 * reference). The reference test in @atrib/verify re-implements this
 * mapping independently; the committed fixtures prove the two
 * implementations produce identical envelopes.
 *
 * Rules:
 *   - protocol -> profile URI via the frozen five-row table; any other
 *     protocol string MUST be rejected.
 *   - envelope: 1, profile_version: '1.0.0', tier: 'attested' (a legacy
 *     block records what a caller-owned verifier path accepted; the block
 *     does not carry trust roots, so the mapping can never claim
 *     'verified'; consumers re-verify to raise tier).
 *   - payload.hash commits to the legacy block itself (JCS bytes): the
 *     legacy shape does not carry the raw external material, so ref.kind
 *     is 'withheld' and media_type is 'application/json'.
 *   - issuer/subject/scope/attenuation_ok/delegation_ok -> facts; details
 *     -> facts.details_hash (sha256 over JCS(details), sanitized
 *     commitment, never inlined).
 *   - valid/constraints/errors/warnings -> result, unchanged.
 *   - verifier is omitted: the mapping is mechanical, not a
 *     re-verification, and MUST NOT insert the mapper's identity (tier
 *     rule 2).
 */
function fromLegacyEvidenceBlock(block: LegacyEvidenceBlock): EvidenceEnvelope {
  const profile = LEGACY_PROTOCOL_TO_PROFILE[block.protocol]
  if (profile === undefined) {
    throw new Error(
      `atrib: unknown legacy evidence protocol '${block.protocol}': the legacy protocol string set is frozen at five; register an evidence envelope profile instead`,
    )
  }
  const facts: Record<string, unknown> = {
    issuer: block.issuer,
    subject: block.subject,
    scope: block.scope,
    attenuation_ok: block.attenuation_ok,
    delegation_ok: block.delegation_ok,
  }
  if (block.details !== undefined) {
    facts['details_hash'] = jcsSha256(block.details)
  }
  return {
    envelope: 1,
    profile,
    profile_version: '1.0.0',
    tier: 'attested',
    payload: {
      hash: jcsSha256(block),
      media_type: 'application/json',
      ref: { kind: 'withheld' },
    },
    facts,
    result: {
      valid: block.valid,
      constraints: block.constraints,
      errors: block.errors,
      warnings: block.warnings,
    },
  }
}

function writeCase(family: string, name: string, body: Record<string, unknown>): void {
  mkdirSync(CASES_DIR, { recursive: true })
  writeFileSync(join(CASES_DIR, `${family}--${name}.json`), JSON.stringify(body, null, 2) + '\n')
}

interface ManifestCase {
  file: string
  name: string
  family: string
}

const manifestCases: ManifestCase[] = []

function emitCase(
  family: string,
  name: string,
  description: string,
  input: Record<string, unknown>,
  expected: Record<string, unknown>,
): void {
  writeCase(family, name, {
    name,
    spec_section: '5.5.7',
    family,
    description,
    input,
    expected,
  })
  manifestCases.push({ file: `cases/${family}--${name}.json`, name, family })
}

// ─── Fixture material ──────────────────────────────────────────────────

const MINIMAL_PAYLOAD_MATERIAL = { note: 'minimal evidence envelope fixture payload' }

const MAXIMAL_PAYLOAD_MATERIAL = {
  active: true,
  client_id: 'client-1',
  iss: 'https://as.example',
  scope: 'tools:read',
  sub: 'agent-7',
}

/**
 * Deterministic compact-JWT-shaped payload string. Not a verifiable JWT
 * (the corpus pins the raw-bytes hash rule, not JOSE semantics; JOSE
 * conformance lives in spec/conformance/ap2-vi-crypto/ and 5.5.6/).
 */
const JWT_PAYLOAD_MATERIAL =
  'eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJodHRwczovL2FzLmV4YW1wbGUiLCJzdWIiOiJhZ2VudC03In0.Zml4dHVyZS1zaWduYXR1cmUtbm90LXZlcmlmaWFibGU'

function minimalEnvelope(): EvidenceEnvelope {
  return {
    envelope: 1,
    profile: `${ATRIB_PROFILE_BASE}oauth2`,
    profile_version: '1.0.0',
    tier: 'declared',
    payload: {
      hash: jcsSha256(MINIMAL_PAYLOAD_MATERIAL),
      ref: { kind: 'withheld' },
    },
    result: { valid: true, constraints: [], errors: [], warnings: [] },
  }
}

// ─── Main ──────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const alicePub = await getPublicKey(ALICE_SEED)
  const aliceKey = base64urlEncode(alicePub)

  // Genesis chain root for the fixture context: "sha256:" + hex(sha256(utf8(context_id))).
  const aliceGenesisChainRoot = 'sha256:' + hex(sha256(utf8.encode(ALICE_CONTEXT)))

  // ════════════════════════ family: shape/ ════════════════════════════

  emitCase(
    'shape',
    'minimal-valid',
    'The smallest well-formed envelope: envelope version, profile URI, profile_version, tier, payload (hash + ref.kind), and result. facts, verifier, payload.media_type, payload.inline, ref.uri, and ref.record_hash are all OPTIONAL. Consumers MUST accept. payload.hash is a real commitment: sha256 over the JCS bytes of the payload material carried in input.payload_material.',
    {
      envelope: minimalEnvelope() as unknown as Record<string, unknown>,
      payload_material: MINIMAL_PAYLOAD_MATERIAL,
      payload_hash_rule: 'jcs',
    },
    {
      accept: true,
      payload_hash: jcsSha256(MINIMAL_PAYLOAD_MATERIAL),
    },
  )

  const maximal: EvidenceEnvelope = {
    envelope: 1,
    profile: `${ATRIB_PROFILE_BASE}oauth2`,
    profile_version: '1.0.0',
    tier: 'verified',
    payload: {
      hash: jcsSha256(MAXIMAL_PAYLOAD_MATERIAL),
      media_type: 'application/json',
      ref: { kind: 'inline', uri: null },
      inline: MAXIMAL_PAYLOAD_MATERIAL,
    },
    facts: {
      issuer: 'https://as.example',
      subject: 'agent-7',
      scope: ['tools:read'],
      attenuation_ok: true,
      delegation_ok: null,
    },
    result: {
      valid: true,
      constraints: [
        {
          type: 'scope',
          status: 'passed',
          expected: ['tools:read'],
          actual: ['tools:read'],
        },
      ],
      errors: [],
      warnings: [],
    },
    verifier: {
      name: '@atrib/verify',
      version: '0.7.10',
      checked_at_ms: REFERENCE_TIME_MS,
    },
  }
  emitCase(
    'shape',
    'maximal-valid',
    'Every optional field populated: media_type, ref.uri (null), inline payload under ref.kind "inline", facts, a full constraint entry, and the verifier block. inline is permitted ONLY with ref.kind "inline" and is local-only (never public). Consumers MUST accept. payload.hash commits to JCS(inline).',
    {
      envelope: maximal as unknown as Record<string, unknown>,
      payload_material: MAXIMAL_PAYLOAD_MATERIAL,
      payload_hash_rule: 'jcs',
    },
    {
      accept: true,
      payload_hash: jcsSha256(MAXIMAL_PAYLOAD_MATERIAL),
      inline_matches_hash: true,
    },
  )

  const missingTier = minimalEnvelope() as unknown as Record<string, unknown>
  delete missingTier['tier']
  emitCase(
    'shape',
    'missing-tier',
    'Required field omitted: tier. Every envelope MUST carry a tier from the four-value enum; consumers MUST reject the envelope (reject the attachment, never the record it attaches to).',
    { envelope: missingTier },
    { accept: false, reject_reasons: ['tier'] },
  )

  const missingHash = minimalEnvelope() as unknown as {
    payload: Record<string, unknown>
  } & Record<string, unknown>
  delete missingHash.payload['hash']
  emitCase(
    'shape',
    'missing-payload-hash',
    'Required field omitted: payload.hash. The hash commitment is the identity of the evidence material; an envelope without it MUST be rejected.',
    { envelope: missingHash },
    { accept: false, reject_reasons: ['payload_hash'] },
  )

  const badTier = { ...minimalEnvelope(), tier: 'trusted' } as unknown as Record<string, unknown>
  emitCase(
    'shape',
    'invalid-tier-value',
    "tier outside the closed four-value enum ('declared' | 'shape' | 'attested' | 'verified'). The enum is closed: extending it requires revising the evidence-envelope ADR, not a consumer. Consumers MUST reject.",
    { envelope: badTier },
    { accept: false, reject_reasons: ['tier'] },
  )

  // Real sha512 digest so the rejection is provably about the prefix, not
  // about fake hex.
  const { sha512 } = await import('@noble/hashes/sha2.js')
  const sha512Hash = 'sha512:' + hex(sha512(utf8.encode(jcs(MINIMAL_PAYLOAD_MATERIAL))))
  const badPrefix = minimalEnvelope()
  badPrefix.payload.hash = sha512Hash
  emitCase(
    'shape',
    'invalid-hash-prefix',
    'payload.hash MUST be "sha256:" + 64 lowercase hex chars. This case carries a genuine SHA-512 digest of the same material under a "sha512:" prefix; consumers MUST reject on the prefix/format rule.',
    {
      envelope: badPrefix as unknown as Record<string, unknown>,
      payload_material: MINIMAL_PAYLOAD_MATERIAL,
    },
    { accept: false, reject_reasons: ['payload_hash'] },
  )

  const inlineMismatch = minimalEnvelope()
  inlineMismatch.payload.ref = { kind: 'mirror' }
  inlineMismatch.payload.inline = MINIMAL_PAYLOAD_MATERIAL
  emitCase(
    'shape',
    'inline-with-non-inline-ref',
    'payload.inline present while ref.kind is "mirror". inline is permitted ONLY when ref.kind === "inline"; any other combination is contradictory (the ref says the bytes live elsewhere) and MUST be rejected.',
    { envelope: inlineMismatch as unknown as Record<string, unknown> },
    { accept: false, reject_reasons: ['inline_without_inline_kind'] },
  )

  // A real signed record for the record_hash cases.
  const approvalUnsigned = {
    spec_version: 'atrib/1.0' as const,
    content_id: rawSha256('evidence-envelope-human-approval-fixture'),
    creator_key: aliceKey,
    chain_root: aliceGenesisChainRoot,
    event_type: 'https://atrib.dev/v1/types/observation',
    context_id: ALICE_CONTEXT,
    timestamp: REFERENCE_TIME_MS + 1000,
    signature: '',
  }
  const approvalRecord = await signRecord(approvalUnsigned as AtribRecord, ALICE_SEED)
  const approvalRecordHash = 'sha256:' + hex(sha256(canonicalRecord(approvalRecord)))

  const recordKindEnvelope = minimalEnvelope()
  recordKindEnvelope.profile = `${ATRIB_PROFILE_BASE}human-approval`
  recordKindEnvelope.payload.hash = approvalRecordHash
  recordKindEnvelope.payload.ref = {
    kind: 'record' as unknown as EvidenceRefKind,
    record_hash: approvalRecordHash,
  }
  emitCase(
    'shape',
    'record-kind-rejected',
    '"record" is NOT a ref.kind value. record_hash is a sibling field on ref, combinable with any retrievability kind; folding it into the kind enum would duplicate the retrievability axis. An envelope spelling ref.kind: "record" MUST be rejected on the kind enum.',
    {
      envelope: recordKindEnvelope as unknown as Record<string, unknown>,
      referenced_record: approvalRecord as unknown as Record<string, unknown>,
    },
    { accept: false, reject_reasons: ['ref_kind'] },
  )

  const recordSibling: EvidenceEnvelope = {
    envelope: 1,
    profile: `${ATRIB_PROFILE_BASE}human-approval`,
    profile_version: '1.0.0',
    tier: 'attested',
    payload: {
      hash: approvalRecordHash,
      media_type: 'application/json',
      ref: { kind: 'mirror', record_hash: approvalRecordHash },
    },
    facts: {
      approver_key: aliceKey,
      approval_scope: 'deploy-production',
      decision: 'allow',
    },
    result: { valid: true, constraints: [], errors: [], warnings: [] },
  }
  emitCase(
    'shape',
    'record-hash-sibling',
    'The correct spelling of a record payload: ref.record_hash names a signed atrib record while ref.kind ("mirror") states where its bytes are retrievable. payload.hash commits to the record\'s canonical JCS bytes and MUST equal sha256(JCS(record)). The referenced record is a real Ed25519-signed human-approval observation; its signature verifies independently.',
    {
      envelope: recordSibling as unknown as Record<string, unknown>,
      referenced_record: approvalRecord as unknown as Record<string, unknown>,
      signer_seed_hex: hex(ALICE_SEED),
    },
    {
      accept: true,
      record_hash: approvalRecordHash,
      payload_hash_matches_record: true,
      referenced_record_signature_ok: true,
    },
  )

  // ═══════════════════════ family: registry/ ══════════════════════════

  emitCase(
    'registry',
    'atrib-profile-registered',
    'An atrib-maintained profile URI: https://atrib.dev/v1/evidence/<name> with <name> in the initial registry. Consumers recognize it as registered and MAY apply profile-specific rendering and sanitization.',
    {
      envelope: minimalEnvelope() as unknown as Record<string, unknown>,
      atrib_profile_registry: [...ATRIB_PROFILE_REGISTRY],
    },
    {
      accept: true,
      uri_valid: true,
      atrib_maintained: true,
      registered: true,
      treat_as: 'registered',
    },
  )

  const thirdParty = minimalEnvelope()
  thirdParty.profile = 'https://evidence.example.org/profiles/warranty-claim'
  emitCase(
    'registry',
    'third-party-profile',
    'A third-party profile: an absolute HTTPS URI on a domain the registrant controls, the same self-sovereign convention as extension event_type URIs. No atrib registration step exists or is required. Consumers MUST accept the envelope shape and treat the profile as unknown-but-preserved.',
    {
      envelope: thirdParty as unknown as Record<string, unknown>,
      atrib_profile_registry: [...ATRIB_PROFILE_REGISTRY],
    },
    {
      accept: true,
      uri_valid: true,
      atrib_maintained: false,
      registered: false,
      treat_as: 'unknown-preserve',
    },
  )

  const nonHttps = minimalEnvelope()
  nonHttps.profile = 'http://atrib.dev/v1/evidence/oauth2'
  emitCase(
    'registry',
    'non-https-profile-rejected',
    'Profile type URIs MUST be absolute HTTPS URIs. An http:// URI fails the registration rule and the envelope MUST be rejected on profile_uri.',
    { envelope: nonHttps as unknown as Record<string, unknown> },
    { accept: false, uri_valid: false, reject_reasons: ['profile_uri'] },
  )

  const bareName = minimalEnvelope()
  bareName.profile = 'oauth2'
  emitCase(
    'registry',
    'bare-name-profile-rejected',
    'A bare profile name is not a type URI. Legacy §5.5.6 protocol strings are a frozen mapping-table input, never a profile identifier; an envelope carrying one in the profile field MUST be rejected on profile_uri.',
    { envelope: bareName as unknown as Record<string, unknown> },
    { accept: false, uri_valid: false, reject_reasons: ['profile_uri'] },
  )

  const collision = minimalEnvelope()
  collision.profile = 'https://example.com/v1/evidence/oauth2'
  emitCase(
    'registry',
    'foreign-domain-collision',
    'A foreign domain reusing an atrib profile name ("oauth2") under an atrib-shaped path. Profile identity is the full URI, not the trailing name: this is a valid third-party profile URI and MUST NOT be treated as the atrib oauth2 profile (no atrib profile-specific rendering, sanitization, or facts vocabulary applies).',
    {
      envelope: collision as unknown as Record<string, unknown>,
      atrib_profile_registry: [...ATRIB_PROFILE_REGISTRY],
    },
    {
      accept: true,
      uri_valid: true,
      atrib_maintained: false,
      registered: false,
      treat_as: 'unknown-preserve',
    },
  )

  // ═══════════════════ family: unknown-profile/ ═══════════════════════

  const UNKNOWN_RAW_PAYLOAD = 'warranty-claim-payload-bytes-v1'
  const unknownEnvelope: EvidenceEnvelope = {
    envelope: 1,
    profile: 'https://evidence.example.org/profiles/warranty-claim',
    profile_version: '2.3.1',
    tier: 'shape',
    payload: {
      hash: rawSha256(UNKNOWN_RAW_PAYLOAD),
      media_type: 'application/octet-stream',
      ref: { kind: 'external', uri: 'https://evidence.example.org/claims/42' },
    },
    facts: {
      claim_id: 'WC-42',
      coverage_years: 3,
      registrar: 'evidence.example.org',
    },
    result: { valid: true, constraints: [], errors: [], warnings: [] },
    verifier: {
      name: 'warranty-checker',
      version: '2.0.0',
      checked_at_ms: REFERENCE_TIME_MS + 5000,
    },
  }
  emitCase(
    'unknown-profile',
    'unknown-profile-preserved',
    'An envelope whose profile URI the consumer does not recognize. Consumers MUST preserve it untouched (the expected round_trip_jcs_sha256 pins the JCS bytes of the whole envelope; any mutation changes the hash), MUST render it opaquely (profile URI, tier, payload hash), and MUST NOT let it affect record validity.',
    {
      envelope: unknownEnvelope as unknown as Record<string, unknown>,
      payload_material_utf8: UNKNOWN_RAW_PAYLOAD,
      payload_hash_rule: 'raw',
    },
    {
      accept: true,
      round_trip_jcs_sha256: jcsSha256(unknownEnvelope),
      opaque_render: {
        profile: unknownEnvelope.profile,
        tier: unknownEnvelope.tier,
        payload_hash: unknownEnvelope.payload.hash,
      },
    },
  )

  emitCase(
    'unknown-profile',
    'unknown-profile-never-dropped',
    'An evidence list mixing a known atrib profile with an unknown third-party profile. Consumers MUST NOT drop the unknown entry and MUST NOT reorder the list: filtering to known profiles is a rendering choice, never a storage or relay behavior.',
    {
      evidence_list: [
        minimalEnvelope() as unknown as Record<string, unknown>,
        unknownEnvelope as unknown as Record<string, unknown>,
      ],
    },
    {
      preserved_count: 2,
      profiles_in_order: [minimalEnvelope().profile, unknownEnvelope.profile],
      drop_forbidden: true,
    },
  )

  // ═══════════════════ family: legacy-mapping/ ════════════════════════

  const legacyBlocks: Record<string, LegacyEvidenceBlock> = {
    oauth2: {
      protocol: 'oauth2',
      valid: true,
      issuer: 'https://as.example',
      subject: 'agent-7',
      scope: ['tools:read'],
      attenuation_ok: true,
      delegation_ok: null,
      constraints: [
        { type: 'scope', status: 'passed', expected: ['tools:read'], actual: ['tools:read'] },
      ],
      errors: [],
      warnings: [],
      details: {
        token: {
          jwt_present: true,
          introspection_present: false,
          verified: true,
          alg: 'EdDSA',
          kid: 'k1',
          claims_verified: true,
        },
        dpop: null,
        audience: ['https://mcp.example.com/mcp'],
        resource: ['https://mcp.example.com/mcp'],
        client_id: 'client-1',
      },
    },
    mcp_oauth: {
      protocol: 'mcp_oauth',
      valid: false,
      issuer: 'https://auth.example.com',
      subject: 'user-123',
      scope: ['files:read'],
      attenuation_ok: false,
      delegation_ok: null,
      constraints: [
        {
          type: 'scope',
          status: 'failed',
          expected: ['files:write'],
          actual: ['files:read'],
          reason: 'missing required scope: files:write',
        },
      ],
      errors: ['oauth_evidence constraint failed: scope'],
      warnings: [],
      details: {
        token: {
          jwt_present: false,
          introspection_present: true,
          verified: null,
          alg: null,
          kid: null,
          claims_verified: true,
        },
        dpop: null,
        audience: ['https://mcp.example.com/mcp'],
        resource: ['https://mcp.example.com/mcp'],
        client_id: 'client-2',
      },
    },
    aauth: {
      protocol: 'aauth',
      valid: true,
      issuer: 'https://as.aauth.example',
      subject: 'agent-7',
      scope: ['calendar:read'],
      attenuation_ok: true,
      delegation_ok: true,
      constraints: [
        { type: 'scope', status: 'passed', expected: ['calendar:read'], actual: ['calendar:read'] },
        { type: 'aauth.typ', status: 'passed', expected: 'aa-agent+jwt', actual: 'aa-agent+jwt' },
      ],
      errors: [],
      warnings: [],
      details: {
        token: {
          jwt_present: true,
          verified: true,
          claims_verified: true,
          alg: 'ES256',
          kid: 'aauth-k1',
          typ: 'aa-agent+jwt',
          token_kind: 'agent_token',
          jti: 'aauth-jti-1',
          cnf_jkt: null,
          agent: 'agent-7',
          parent_agent: null,
          act_chain: [],
        },
        http_signature: {
          present: false,
          verified: null,
          scheme: null,
          covered_components: [],
          signing_key_jkt: null,
        },
        access_mode: 'delegated',
        audience: ['https://resource.example'],
        resource: ['https://resource.example'],
        mission: null,
        r3: {
          present: false,
          uri: null,
          s256: null,
          granted: [],
          document_hash_verified: null,
        },
      },
    },
    x401: {
      protocol: 'x401',
      valid: true,
      issuer: null,
      subject: 'agent-7',
      scope: [],
      attenuation_ok: null,
      delegation_ok: null,
      constraints: [
        { type: 'x401.version', status: 'passed', expected: '0.2.0', actual: '0.2.0' },
        { type: 'x401.proof_gate', status: 'passed' },
      ],
      errors: [],
      warnings: [],
      details: {
        version: '0.2.0',
        request_id: 'req-1',
        header_names: ['PROOF-REQUEST', 'PROOF-RESPONSE', 'PROOF-RESULT'],
        legacy_headers_used: [],
        legacy_fields_used: [],
        proof_request_hash: rawSha256('x401-fixture-proof-request'),
        proof_response_hash: rawSha256('x401-fixture-proof-response'),
        proof_result_hash: rawSha256('x401-fixture-proof-result'),
        credential_protocol: 'openid4vp',
        nonce: 'nonce-1',
        agent_id: 'agent-7',
        response_kind: 'result',
        result_verified: true,
        token_verified: null,
        proof_gate: { kind: 'result', status: 'passed' },
        satisfied_requirements: ['req-1'],
        payment_separation: { present: false, required: null, scheme_hint: null },
        agent_origin: { expected_hash: null, actual_hash: null, verified: null },
        issuer_trust: { verified: null, root_type: null, root_ref_hash: null },
        proof_payment_binding: { verified: null, reference_hash: null },
        verifier_client_id: null,
        credential_result_uri_present: false,
        credential_result_uri_hash: null,
      },
    },
    ap2_vi: {
      protocol: 'ap2_vi',
      valid: true,
      issuer: null,
      subject: null,
      scope: [],
      attenuation_ok: true,
      delegation_ok: true,
      constraints: [
        { type: 'vi.max_amount', status: 'passed', expected: 500, actual: 120 },
        { type: 'vi.merchant_allowlist', status: 'passed' },
      ],
      errors: [],
      warnings: [],
      details: {
        valid: true,
        transactionAccepted: true,
        ap2: {
          receipt_kind: 'checkout_receipt',
          receipt_hash: rawSha256('ap2-fixture-checkout-receipt-jwt'),
        },
        vi: {
          mode: 'sd-jwt',
          credentials: ['intent-credential-1'],
          delegationOk: true,
          checkoutPaymentBindingOk: true,
          constraints: { status: 'passed', checks: [] },
        },
        errors: [],
        warnings: [],
      },
    },
  }

  const legacyFileNames: Record<string, string> = {
    oauth2: 'legacy-oauth2',
    mcp_oauth: 'legacy-mcp-oauth',
    aauth: 'legacy-aauth',
    x401: 'legacy-x401',
    ap2_vi: 'legacy-ap2-vi',
  }

  for (const [protocol, block] of Object.entries(legacyBlocks)) {
    const envelope = fromLegacyEvidenceBlock(block)
    const fileName = legacyFileNames[protocol]
    if (fileName === undefined) throw new Error(`missing file name for protocol ${protocol}`)
    emitCase(
      'legacy-mapping',
      fileName,
      `Deterministic mapping of a legacy §5.5.6 '${protocol}' evidence block to envelope form. Two independent implementations of fromLegacyEvidenceBlock MUST produce this exact envelope: profile via the frozen five-row table, profile_version '1.0.0', tier 'attested', payload.hash = sha256(JCS(legacy block)) with ref.kind 'withheld', issuer/subject/scope/attenuation_ok/delegation_ok copied into facts, details committed as facts.details_hash = sha256(JCS(details)), valid/constraints/errors/warnings copied into result, and NO verifier block (the mapping is mechanical, not a re-verification).`,
      { legacy_block: block as unknown as Record<string, unknown> },
      {
        envelope: envelope as unknown as Record<string, unknown>,
        payload_hash: envelope.payload.hash,
        details_hash: (envelope.facts as Record<string, unknown>)['details_hash'] as string,
      },
    )
  }

  const unknownLegacy: LegacyEvidenceBlock = {
    protocol: 'atrib_delegation',
    valid: true,
    issuer: 'https://delegator.example',
    subject: 'agent-7',
    scope: [],
    attenuation_ok: null,
    delegation_ok: true,
    constraints: [],
    errors: [],
    warnings: [],
  }
  emitCase(
    'legacy-mapping',
    'legacy-unknown-protocol-rejected',
    "The executable form of the legacy-string freeze: the legacy protocol set is closed at exactly five values ('oauth2', 'mcp_oauth', 'aauth', 'x401', 'ap2_vi'). A mapping implementation handed any other protocol string (here the hypothetical 'atrib_delegation') MUST reject rather than silently inventing a profile URI. New evidence types register as envelope profiles; they never extend the mapping table.",
    { legacy_block: unknownLegacy as unknown as Record<string, unknown> },
    {
      mapping_must_reject: true,
      frozen_protocols: Object.keys(LEGACY_PROTOCOL_TO_PROFILE),
    },
  )

  // ═══════════════════════ family: tier/ ══════════════════════════════

  const jwtHash = rawSha256(JWT_PAYLOAD_MATERIAL)
  const tierBase: Omit<EvidenceEnvelope, 'tier' | 'verifier'> = {
    envelope: 1,
    profile: `${ATRIB_PROFILE_BASE}oauth2`,
    profile_version: '1.0.0',
    payload: {
      hash: jwtHash,
      media_type: 'application/jwt',
      ref: { kind: 'mirror' },
    },
    facts: { issuer: 'https://as.example', subject: 'agent-7' },
    result: { valid: true, constraints: [], errors: [], warnings: [] },
  }
  const tierLadder: EvidenceEnvelope[] = [
    { ...tierBase, tier: 'declared' },
    {
      ...tierBase,
      tier: 'shape',
      verifier: { name: 'offline-shape-checker', checked_at_ms: REFERENCE_TIME_MS + 1 },
    },
    {
      ...tierBase,
      tier: 'attested',
      verifier: { name: 'introspection-gateway', checked_at_ms: REFERENCE_TIME_MS + 2 },
    },
    {
      ...tierBase,
      tier: 'verified',
      verifier: { name: '@atrib/verify', version: '0.7.10', checked_at_ms: REFERENCE_TIME_MS + 3 },
    },
  ]
  emitCase(
    'tier',
    'tier-ladder-all-four',
    'One payload (a compact-JWT-shaped string, hashed over raw UTF-8 bytes per the application/jwt rule) carried at all four tiers by different verifier parties. All four instances share the identity key (profile, payload.hash); multiple instances per key are permitted; consumers order by tier descending, then checked_at_ms descending, then verifier name.',
    {
      envelopes: tierLadder as unknown as Record<string, unknown>[],
      payload_material_utf8: JWT_PAYLOAD_MATERIAL,
      payload_hash_rule: 'raw',
    },
    {
      accept_all: true,
      payload_hash: jwtHash,
      identity_key: { profile: `${ATRIB_PROFILE_BASE}oauth2`, payload_hash: jwtHash },
      shared_identity_key: true,
      tier_order_descending: ['verified', 'attested', 'shape', 'declared'],
    },
  )

  const relayOriginal: EvidenceEnvelope = {
    ...tierBase,
    tier: 'attested',
    verifier: { name: 'introspection-gateway', checked_at_ms: REFERENCE_TIME_MS + 2 },
  }
  const relaySwapped: EvidenceEnvelope = {
    ...tierBase,
    tier: 'attested',
    verifier: { name: 'relay.example', checked_at_ms: REFERENCE_TIME_MS + 2 },
  }
  emitCase(
    'tier',
    'relay-identity-swap-rejected',
    "A consumer MUST NOT relay another party's envelope with its own identity in verifier (or with a raised tier); re-verification produces a NEW envelope instance with new checks. The relayed instance here is byte-identical to the original except for verifier.name, the structural signature of an identity swap: same tier, same checked_at_ms, same facts, same result, no re-run evidence. The reference checker MUST flag it.",
    {
      original: relayOriginal as unknown as Record<string, unknown>,
      relayed: relaySwapped as unknown as Record<string, unknown>,
    },
    {
      relay_violation: true,
      violation_reason: 'verifier identity differs while tier, checked_at_ms, facts, and result are unchanged',
    },
  )

  const withheldVerified: EvidenceEnvelope = {
    envelope: 1,
    profile: `${ATRIB_PROFILE_BASE}x401`,
    profile_version: '1.0.0',
    tier: 'verified',
    payload: {
      hash: rawSha256('x401-fixture-proof-result'),
      media_type: 'application/json',
      ref: { kind: 'withheld' },
    },
    facts: { result_verified: true },
    result: { valid: true, constraints: [], errors: [], warnings: [] },
    verifier: { name: '@atrib/verify', version: '0.7.10', checked_at_ms: REFERENCE_TIME_MS + 4 },
  }
  emitCase(
    'tier',
    'verified-withheld-not-reproducible',
    'A tier "verified" envelope whose payload is withheld is still well-formed: the tier states what the named verifier did, not what the consumer can reproduce. Consumers MUST accept the shape and MUST report it as claimed-but-not-reproducible, mirroring the tiered record-verifiability ladder of the Record Body Archive Layer.',
    { envelope: withheldVerified as unknown as Record<string, unknown> },
    {
      accept: true,
      reproducible: false,
      report: 'claimed-not-reproducible',
    },
  )

  const flipUnsigned = {
    spec_version: 'atrib/1.0' as const,
    content_id: rawSha256('evidence-envelope-never-flips-valid-fixture'),
    creator_key: aliceKey,
    chain_root: aliceGenesisChainRoot,
    event_type: 'https://atrib.dev/v1/types/tool_call',
    context_id: ALICE_CONTEXT,
    timestamp: REFERENCE_TIME_MS + 2000,
    signature: '',
  }
  const flipRecord = await signRecord(flipUnsigned as AtribRecord, ALICE_SEED)
  emitCase(
    'tier',
    'evidence-never-flips-valid',
    'The load-bearing invariant: evidence never flips verifyRecord().valid. A correctly signed record is verified alongside failing OAuth authorization evidence (scope attenuation failure under caller-verified claims). The evidence block and its mapped envelope MUST carry valid: false while the record itself stays valid: true. A signed action is real even when its external evidence is missing, expired, over-scoped, or forged; consumers apply their own policy over tiers.',
    {
      record: flipRecord as unknown as Record<string, unknown>,
      signer_seed_hex: hex(ALICE_SEED),
      authorization_evidence: [
        {
          oauth: {
            protocol: 'oauth2',
            claimsVerified: true,
            claims: {
              iss: 'https://as.example',
              sub: 'agent-7',
              aud: 'https://mcp.example.com/mcp',
              scope: 'files:read',
            },
            issuer: 'https://as.example',
            audience: 'https://mcp.example.com/mcp',
            requiredScopes: ['files:write'],
            nowSeconds: Math.floor(REFERENCE_TIME_MS / 1000),
          },
        },
      ],
      record_hash: 'sha256:' + hex(sha256(canonicalRecord(flipRecord))),
    },
    {
      record_valid: true,
      signature_ok: true,
      evidence_count: 1,
      evidence_valid: [false],
      mapped_envelope_result_valid: false,
      mapped_envelope_tier: 'attested',
      mapped_envelope_profile: `${ATRIB_PROFILE_BASE}oauth2`,
    },
  )

  // ═══════════════════════════ Manifest ═══════════════════════════════

  const manifest = {
    spec_section: '5.5.7',
    spec_title: 'Universal Evidence Envelope',
    decision_link: 'P042 (evidence-envelope ADR)',
    generated_at: REFERENCE_TIME_MS,
    generator: 'packages/log-dev/scripts/generate-conformance-evidence-envelope.ts',
    tier_enum: ['declared', 'shape', 'attested', 'verified'],
    ref_kind_enum: ['inline', 'mirror', 'archive', 'external', 'withheld'],
    atrib_profile_registry: [...ATRIB_PROFILE_REGISTRY],
    frozen_legacy_protocols: Object.keys(LEGACY_PROTOCOL_TO_PROFILE),
    legacy_protocol_to_profile: LEGACY_PROTOCOL_TO_PROFILE,
    families: ['shape', 'registry', 'unknown-profile', 'legacy-mapping', 'tier'],
    cases: manifestCases,
    keys: { alice_pubkey: aliceKey },
    note: 'The five families collectively pin the §5.5.7 contract: schema validity with the closed tier and ref.kind enums (shape/), the HTTPS type-URI registration rule with full-URI profile identity (registry/), unknown-profile preservation (unknown-profile/), the frozen five-row legacy mapping with sixth-string rejection (legacy-mapping/), and instance-scoped tier semantics where evidence never flips verifyRecord().valid (tier/).',
  }

  writeFileSync(join(CORPUS_ROOT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')

  console.log(`generated ${manifestCases.length} cases at ${CORPUS_ROOT}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
