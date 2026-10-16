// SPDX-License-Identifier: Apache-2.0
// Fixed seeds/nonces are public test material. Expected verdicts are authored
// below and never computed by the reference checker.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import * as ed from '@noble/ed25519'
import {
  getPublicKey,
  base64urlEncode,
  signRecord,
  genesisChainRoot,
  serializeEntry,
  leafHash,
  sha256,
  createJsonCommitment,
  type AtribRecord,
} from '@atrib/mcp'
import {
  digest,
  jcs,
  SNAPSHOT_METHOD,
  MULTI_DESTINATION_METHOD,
  OTHER_CURSOR_METHOD,
  UNKNOWN_CURSOR_METHOD,
  type FixtureInput,
} from './source-bound-reference.js'
import { compactSourceBoundCorpus } from './source-bound-corpus.js'
import { DECLARED_METHOD, EVIDENCE_PREFIX } from './source-bound-schemas.js'

type Obj = Record<string, unknown>
type Variant = Record<string, boolean | string>
const root = process.argv[2] ?? join(import.meta.dirname, '../../../spec/conformance/1.12')
const T = 1_700_000_000_000
const id = (namespace: string, value: string) => ({ namespace: `urn:${namespace}`, id: value })
const subject = id('invocation', 'call-1'),
  execution = id('execution', 'attempt-1')
const native = id('native', 'native-1'),
  delivery = id('delivery', 'delivery-1'),
  destination = id('destination-request', 'request-1')
const sourceId = (role: string) => id('source', role)
const roles = ['agent', 'owner', 'host', 'destination', 'expected', 'rogue']
const seeds = Object.fromEntries(roles.map((role, i) => [role, new Uint8Array(32).fill(i + 1)]))
const keys: Record<string, string> = {}
for (const role of roles) keys[role] = base64urlEncode(await getPublicKey(seeds[role]!))
const descriptor = {
  service: 'https://api.example.test',
  operation: 'deploy',
  resource: id('environment', 'staging'),
  parameters: { image: 'build-1', mode: 'safe' },
  version: 'v1',
}
const rawJcsObject = () =>
  JSON.parse('{"__proto__":{"allowed":true},"constructor":1,"prototype":2}') as Obj
const rawPolicyParameters = () => JSON.parse('{"__proto__":{"requiredFlag":true}}') as Obj
const d = (state: string, ...reasons: string[]) => ({ state, reasons })
const expected = (dimension: string, state: string, ...reasons: string[]) => ({
  request: { dimensions: { [dimension]: d(state, ...reasons) } },
})

async function bundle(v: Variant): Promise<FixtureInput> {
  const hostMethod = v.multiplicity_allowed
    ? MULTI_DESTINATION_METHOD
    : v.unknown_cursor
      ? UNKNOWN_CURSOR_METHOD
      : SNAPSHOT_METHOD
  const destinationMethod =
    v.multiple_destinations && !v.multiplicity_allowed ? MULTI_DESTINATION_METHOD : SNAPSHOT_METHOD
  const input: FixtureInput = {
    records: [],
    openings: {},
    artifacts: {},
    policy: {},
    evaluation: {},
    request_hash: '',
  }
  const artifact = (value: unknown) => {
    const hash = digest(value)
    input.artifacts[hash] = Buffer.from(jcs(value)).toString('base64')
    return hash
  }
  const signed = async (payload: Obj, role: string) => ({
    payload,
    signer_key: keys[role],
    signature: base64urlEncode(
      await ed.signAsync(new TextEncoder().encode(jcs(payload)), seeds[role]!),
    ),
  })
  const ref = (relation: string, hash: string, kind = 'artifact') => ({ relation, kind, hash })
  const body = (role: string, assertion: Obj, target?: string): Obj => ({
    nonce: 'AAAAAAAAAAAAAAAAAAAAAA',
    subject: structuredClone(subject),
    assertion: structuredClone(assertion),
    ...(target ? { target: { record_hash: target } } : {}),
    source: { kind: 'declared', identity: sourceId(role), method: DECLARED_METHOD },
    basis: [],
  })
  const seal = async (kind: string, value: Obj, role: string, extra: Obj = {}) => {
    if (v.mutate_kind === kind && typeof v.mutate_field === 'string') {
      if (v.mutate_field === 'unknown') value.extra = true
      else if (v.mutate_field.startsWith('assertion.'))
        delete (value.assertion as Obj)[v.mutate_field.slice(10)]
      else if (v.mutate_field === 'nonce_short') value.nonce = 'AA'
      else if (v.mutate_field === 'target') delete value.target
      else if (v.mutate_field === 'source_basis')
        value.basis = (value.basis as Obj[]).filter((ref) => ref.relation !== 'source')
      else if (v.mutate_field === 'authority_basis') value.basis = []
      else if (v.mutate_field === 'source_locator_credential')
        (value.source as Obj).locator = 'Bearer fixture-secret'
      else if (v.mutate_field === 'source_locator_invalid_port')
        (value.source as Obj).locator = 'https://example.test:99999/path'
      else if (v.mutate_field === 'source_locator_invalid_ipv6')
        (value.source as Obj).locator = 'https://[2001:db8:::1]/path'
      else if (v.mutate_field === 'basis_locator_credential')
        (value.basis as Obj[])[0]!.locator = 'https://example.test/file?token=fixture-secret'
      else if (v.mutate_field.startsWith('source.'))
        delete (value.source as Obj)[v.mutate_field.slice(7)]
      else if (v.mutate_field.startsWith('subject.'))
        delete (value.subject as Obj)[v.mutate_field.slice(8)]
      else delete value[v.mutate_field]
    }
    let record = await signRecord(
      {
        spec_version: 'atrib/1.0',
        creator_key: keys[role]!,
        content_id: `sha256:${'a'.repeat(64)}`,
        chain_root: genesisChainRoot('1'.repeat(32)),
        context_id: '1'.repeat(32),
        event_type: `${EVIDENCE_PREFIX}${kind}`,
        timestamp: T,
        args_hash:
          (v.raw_jcs_request && kind === 'request') || (v.raw_jcs_effect && kind === 'effect')
            ? createJsonCommitment(value, 'plain-sha256').hash
            : digest(value),
        signature: '',
        ...extra,
      } as AtribRecord,
      seeds[role]!,
    )
    if (v.omit_content && kind === 'request') {
      const { content_id: _content, ...rest } = record
      record = await signRecord(rest as AtribRecord, seeds[role]!)
    }
    const hash = digest(record)
    input.records.push(record as unknown as Obj)
    const opening = structuredClone(value)
    if (v.raw_jcs_mutation === kind) {
      const nested =
        kind === 'request'
          ? (((opening.assertion as Obj).descriptor as Obj).parameters as Obj)
          : ((opening.assertion as Obj).state as Obj)
      ;(nested['__proto__'] as Obj).allowed = false
    }
    input.openings[hash] = opening
    return hash
  }
  const observe = async (value: Obj, role = 'host', extras: Obj = {}) => {
    const assertion = value.assertion as Obj
    if ('object' in assertion && 'state' in assertion) {
      const version = assertion.version as Obj
      const raw = {
        object: assertion.object,
        state: assertion.state,
        ...(version.kind === 'native' ? { version: version.value } : {}),
      }
      const rawHash = artifact(raw)
      assertion.payload_hash = rawHash
      if (version.kind === 'snapshot') version.value = rawHash
      ;(value.basis as Obj[]).push(ref('source', rawHash))
    }
    value.source = {
      kind: 'boundary',
      identity: sourceId(role),
      method: role === 'destination' ? destinationMethod : hostMethod,
      observed_at: T + 10,
      ...extras,
    }
    const payload: Obj = {
      claim: Object.fromEntries(
        Object.entries(value).filter(([name]) => !['nonce', 'basis'].includes(name)),
      ),
      authority: (value.basis as Obj[])
        .filter((r) => r.relation === 'authority' && r.kind === 'record')
        .map((r) => r.hash)
        .sort(),
      cursor: 5,
    }
    if (v.coverage && !v.mutate_kind && assertion.phase === 'dispatch') {
      const nativeHash = artifact({
        surface: sourceId(role),
        id: assertion.native_invocation,
        cursor: 5,
        assertion: structuredClone(assertion),
      })
      if (!v.native_hash_missing) payload.native_event_hash = nativeHash
      ;(value.basis as Obj[]).push(ref('source', nativeHash))
    }
    ;(value.basis as Obj[]).push(ref('source', artifact(await signed(payload, role))))
  }
  const grant = artifact({
    version: 'v1',
    revoked: !!v.revoked,
    not_before: T - 100,
    expires_at: T + 10_000,
  })
  const req = body('agent', {
    descriptor: {
      ...descriptor,
      ...(v.raw_jcs_request ? { parameters: rawJcsObject() } : {}),
    },
    execution,
  })
  if (v.relative_locator) (req.source as Obj).locator = './records/request.json'
  const requestHash = await seal(
    'request',
    req,
    'agent',
    v.carrier_args_salt
      ? { args_salt: 'AAAAAAAAAAAAAAAAAAAAAA' }
      : v.carrier_result
        ? { result_hash: `sha256:${'0'.repeat(64)}` }
        : v.only_result
          ? { args_hash: undefined, result_hash: digest(req) }
          : v.unknown_type
            ? { event_type: 'https://example.test/unknown-type' }
            : v.future_record
              ? { timestamp: T + 400_000 }
              : {},
  )
  input.request_hash = requestHash
  const allow = body(
    'owner',
    {
      decision: v.deny ? 'deny' : 'allow',
      authority_version: 'v1',
      not_before: T - 50,
      expires_at: v.expired ? T + 5 : T + 1000,
    },
    requestHash,
  )
  allow.basis = [ref('authority', grant)]
  const allowHash = await seal('authorization', allow, 'owner')
  const observedDescriptor = v.descriptor_mismatch
    ? { ...descriptor, resource: id('environment', 'production') }
    : descriptor
  const dispatch = body(
    'host',
    {
      phase: 'dispatch',
      descriptor: observedDescriptor,
      execution: v.execution_mismatch ? id('execution', 'attempt-2') : execution,
      native_invocation: native,
      delivery,
      destination_request: destination,
      outcome: 'pending',
    },
    requestHash,
  )
  dispatch.basis = v.posthoc
    ? []
    : [ref('authority', v.authority_wrong_kind ? requestHash : allowHash, 'record')]
  if (v.omit_dispatch_destination) delete (dispatch.assertion as Obj).destination_request
  await observe(dispatch)
  const dispatchHash = await seal('observation', dispatch, 'host')
  const response = body(
    'host',
    {
      phase: v.timeout ? 'failure' : 'response',
      descriptor: observedDescriptor,
      execution: v.execution_mismatch ? id('execution', 'attempt-2') : execution,
      native_invocation: native,
      delivery,
      destination_request: destination,
      outcome: v.timeout ? 'unknown' : 'success',
    },
    requestHash,
  )
  await observe(response)
  const responseHash = await seal('observation', response, 'host')
  const report = body('agent', { status: 'success', text: 'Agent reports done' }, requestHash)
  await seal('report', report, 'agent')
  const effect = body(
    'destination',
    {
      object: id('deployment', 'deployment-1'),
      version: { kind: 'native', value: 'revision-1' },
      state: v.raw_jcs_effect ? rawJcsObject() : { deployed: true },
      ...(!v.unbound
        ? {
            binding: {
              observation_record: responseHash,
              destination_request: v.wrong_join
                ? id('destination-request', 'unrelated')
                : destination,
            },
          }
        : {}),
    },
    requestHash,
  )
  await observe(effect, 'destination', { kind: 'query', observed_at: T + 20 })
  if (!v.no_effect && !v.timeout) await seal('effect', effect, 'destination')
  if (v.conflict || v.progression) {
    const changed = structuredClone(effect)
    ;(changed.assertion as Obj).state = { deployed: false }
    if (v.progression) (changed.assertion as Obj).version = { kind: 'native', value: 'revision-2' }
    changed.basis = []
    await observe(changed, 'destination', { kind: 'query', observed_at: T + 21 })
    await seal('effect', changed, 'destination')
  }
  if (v.multiple_destinations) {
    const second = structuredClone(response)
    second.basis = []
    ;(second.assertion as Obj).destination_request = id('destination-request', 'request-2')
    await observe(second)
    const hash = await seal('observation', second, 'host')
    const secondEffect = structuredClone(effect)
    secondEffect.basis = []
    ;(secondEffect.assertion as Obj).binding = {
      observation_record: hash,
      destination_request: id('destination-request', 'request-2'),
    }
    await observe(secondEffect, 'destination', { kind: 'query', observed_at: T + 20 })
    await seal('effect', secondEffect, 'destination')
  }
  if (v.terminal_conflict || v.redelivery || v.occurrence_execution || v.occurrence_native) {
    const changed = structuredClone(response)
    changed.basis = []
    ;(changed.assertion as Obj).outcome = 'error'
    if (v.redelivery) (changed.assertion as Obj).delivery = id('delivery', 'delivery-2')
    if (v.occurrence_execution) {
      ;(changed.assertion as Obj).delivery = id('delivery', 'delivery-2')
      ;(changed.assertion as Obj).execution = id('execution', 'attempt-2')
    }
    if (v.occurrence_native) (changed.assertion as Obj).native_invocation = id('native', 'other')
    await observe(changed)
    await seal('observation', changed, 'host')
  }
  if (v.untrusted) {
    const changed = structuredClone(response)
    changed.basis = []
    ;(changed.assertion as Obj).outcome = 'error'
    await observe(changed, 'rogue')
    await seal('observation', changed, 'rogue')
  }
  if (v.selected_untrusted) {
    const changed = structuredClone(dispatch)
    changed.basis = [ref('authority', allowHash, 'record')]
    await observe(changed, 'rogue')
    const rogueDispatch = await seal('observation', changed, 'rogue')
    input.evaluation = {
      purpose: 'historical',
      evaluated_at: T + 100,
      dispatch_record: rogueDispatch,
    }
  }
  if (v.coverage) {
    const surface = v.wrong_surface ? sourceId('other') : sourceId('host')
    const coverage = body('host', {
      surface,
      start: v.wrong_window ? '10' : '0',
      end: '10',
      expected: [native],
      captured: v.gap ? [] : [native],
      gaps: v.gap ? [{ id: native, reason: 'capture failed' }] : [],
    })
    coverage.subject = surface
    coverage.basis = []
    const nativeEvents: Obj[] = []
    if (!v.mutate_kind) {
      const frame = {
        surface: sourceId('host'),
        id: native,
        cursor: 5,
        assertion: {
          ...(dispatch.assertion as Obj),
          ...(v.native_mismatch ? { descriptor: { ...descriptor, operation: 'delete' } } : {}),
        },
      }
      const hash = artifact(frame)
      nativeEvents.push({ id: native, hash })
      ;(coverage.basis as Obj[]).push(ref('source', hash))
    }
    const nativeFacts = nativeEvents.length ? { native_events: nativeEvents } : {}
    if (!v.no_expected)
      (coverage.basis as Obj[]).push(
        ref(
          'expected',
          artifact(
            await signed(
              {
                surface,
                start: (coverage.assertion as Obj).start,
                end: '10',
                ids: [native],
                ...nativeFacts,
              },
              'expected',
            ),
          ),
        ),
      )
    if (!v.no_captured)
      (coverage.basis as Obj[]).push(
        ref(
          'captured',
          artifact(
            await signed(
              {
                surface,
                start: (coverage.assertion as Obj).start,
                end: '10',
                ids: (coverage.assertion as Obj).captured,
                ...nativeFacts,
              },
              'host',
            ),
          ),
        ),
      )
    await observe(coverage, 'host', {
      kind: 'manifest',
      observed_at: T + 30,
      ...(v.other_cursor ? { method: OTHER_CURSOR_METHOD } : {}),
    })
    await seal('coverage', coverage, 'host')
  }
  const rules = [
    ['request', 'agent', DECLARED_METHOD],
    ['authorization', 'owner', DECLARED_METHOD],
    ['report', 'agent', DECLARED_METHOD],
    ['observation', 'host', hostMethod],
    ['effect', 'destination', destinationMethod],
    ['coverage', 'host', v.other_cursor ? OTHER_CURSOR_METHOD : hostMethod],
  ].map(([kind, role, method]) => ({
    type: `${EVIDENCE_PREFIX}${kind}`,
    signer_keys: [keys[role!]!],
    source_keys: [keys[role!]!, keys.expected!],
    source: sourceId(role!),
    methods: [method!],
    subject_namespace: kind === 'coverage' ? 'urn:source' : 'urn:invocation',
    max_age_ms: v.stale ? 1 : 10_000,
    authority_versions: ['v1'],
    authorized_descriptors: v.scope_mismatch
      ? [{ ...descriptor, resource: id('environment', 'elsewhere') }]
      : [
          v.raw_policy_proto
            ? {
                ...descriptor,
                parameters: { ...descriptor.parameters, ...rawPolicyParameters() },
              }
            : descriptor,
        ],
    authority_basis: [grant],
  }))
  if (v.overlap) rules.push(structuredClone(rules[0]!))
  if (v.principal_only) rules[1]!.signer_keys = [keys.agent!]
  input.policy = v.no_policy
    ? null
    : {
        id: 'fixture-policy-v1',
        rules,
        required: v.current
          ? ['source', 'authority']
          : ['source', 'binding', 'authority', 'effect', ...(v.coverage ? ['coverage'] : [])],
      }
  if (!v.selected_untrusted)
    input.evaluation = v.current
      ? { purpose: 'current', evaluated_at: T + 100 }
      : { purpose: 'historical', evaluated_at: T + 100, dispatch_record: dispatchHash }
  if (v.pre_dispatch) {
    input.records = input.records.filter((record) =>
      ['request', 'authorization'].some(
        (kind) => record.event_type === `${EVIDENCE_PREFIX}${kind}`,
      ),
    )
  }
  if (v.capture) {
    const message = artifact({ text: 'unsigned message', speaker: 'agent' })
    const capture = body('host', { phase: 'capture', occurrence: native, artifact_hash: message })
    capture.subject = native
    capture.basis = [ref('source', message)]
    await observe(capture)
    const captureHash = await seal('observation', capture, 'host')
    input.records = input.records.filter((record) => digest(record) === captureHash)
    delete input.request_hash
    rules[3]!.subject_namespace = 'urn:native'
  }
  if (v.withheld) delete input.openings[requestHash]
  if (v.opening_mismatch)
    ((input.openings[requestHash] as Obj).assertion as Obj).descriptor = {
      ...descriptor,
      operation: 'delete',
    }
  if (v.missing_artifact) delete input.artifacts[grant]
  if (v.artifact_mismatch) input.artifacts[grant] = Buffer.from('{}').toString('base64')
  if (v.deep_dependencies) {
    let prior = requestHash
    for (let index = 0; index < 35; index++) {
      const linked = body('agent', { status: 'unknown', text: `Dependency ${index}` }, requestHash)
      linked.basis = [ref('source', prior, 'record')]
      prior = await seal('report', linked, 'agent')
    }
  }
  if (v.duplicate_records)
    input.records.push(
      ...input.records.map((record) => Object.fromEntries(Object.entries(record).reverse())),
    )
  if (v.publication || v.publication_bad_checkpoint) {
    const seed = new Uint8Array(32).fill(77)
    const pub = await getPublicKey(seed)
    const origin = 'conformance.test/v1'
    const entry = serializeEntry({
      record_hash_hex: requestHash.slice(7),
      creator_key_b64url: keys.agent!,
      context_id: '1'.repeat(32),
      timestamp: T,
      event_type: `${EVIDENCE_PREFIX}request`,
    })
    const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64')
    const checkpointBody = `${origin}\n1\n${b64(leafHash(entry))}\n`
    const signature = await ed.signAsync(new TextEncoder().encode(checkpointBody), seed)
    const keyPreimage = Buffer.concat([Buffer.from(`${origin}\n`), Buffer.from([1]), pub])
    const noteSignature = Buffer.concat([sha256(keyPreimage).slice(0, 4), signature])
    const proof = {
      record_hash: requestHash,
      log_proofs: [
        {
          log_id: 'conformance',
          log_index: 0,
          checkpoint: `${checkpointBody}\n\u2014 ${origin} ${b64(noteSignature)}`,
          inclusion_proof: [],
          entry_bytes_b64: b64(entry),
        },
      ],
    }
    if (v.publication_bad_checkpoint)
      proof.log_proofs[0]!.checkpoint = proof.log_proofs[0]!.checkpoint.replace(
        b64(leafHash(entry)),
        b64(new Uint8Array(32)),
      )
    input.publication = {
      proofs: { [requestHash]: proof },
      trust: { trust_material: { logs: { conformance: { origin, pubkey_b64: b64(pub) } } } },
    }
  }
  return input
}

const definitions: Array<[string, Variant, Obj, string[]]> = [
  [
    'C01-complete',
    {},
    { request: { reliance: { accepted: true } } },
    [
      'E01',
      'E02',
      'E04',
      'E05',
      'E06',
      'E08',
      'E10',
      'E11',
      'E15',
      'E16',
      'E18',
      'E19',
      'E20',
      'E22',
    ],
  ],
  [
    'C02-body-withheld',
    { withheld: true },
    expected('integrity', 'unresolved', 'body_missing'),
    ['E02'],
  ],
  [
    'C03-body-modified',
    { opening_mismatch: true },
    expected('integrity', 'rejected', 'opening_mismatch'),
    ['E02'],
  ],
  [
    'C05-dispatch-substitution',
    { descriptor_mismatch: true },
    expected('binding', 'rejected', 'descriptor_mismatch'),
    ['E11'],
  ],
  [
    'C06-execution-substitution',
    { execution_mismatch: true },
    expected('binding', 'rejected', 'execution_mismatch'),
    ['E11'],
  ],
  [
    'C07-redelivery',
    { redelivery: true },
    {
      request: {
        execution: { deliveries: [{ state: 'success' }, { state: 'error' }] },
        reliance: { accepted: true },
      },
    },
    ['E06', 'E11'],
  ],
  [
    'C08-timeout-success-report',
    { timeout: true },
    {
      request: {
        execution: { deliveries: [{ state: 'unknown' }] },
        dimensions: { effect: d('unresolved', 'effect_unbound') },
      },
    },
    ['E06', 'E07'],
  ],
  [
    'C09-unbound-destination',
    { unbound: true },
    expected('effect', 'unresolved', 'effect_unbound'),
    ['E08'],
  ],
  [
    'C10-untrusted-injection',
    { untrusted: true },
    { request: { reliance: { accepted: true } } },
    ['E13', 'E17', 'E20'],
  ],
  [
    'C10-selected-untrusted-dispatch',
    { selected_untrusted: true },
    expected('source', 'rejected', 'source_untrusted'),
    ['E13', 'E17', 'E20'],
  ],
  [
    'C11-policy-missing',
    { no_policy: true },
    { request: { dimensions: { authority: { state: 'unresolved' } } } },
    ['E15', 'E17'],
  ],
  [
    'C12-expired-at-dispatch',
    { expired: true },
    expected('authority', 'rejected', 'authority_invalid'),
    ['E05', 'E16'],
  ],
  [
    'C13-expected-set-missing',
    { coverage: true, no_expected: true },
    expected('coverage', 'unresolved', 'dependency_missing'),
    ['E09'],
  ],
  [
    'C14-capture-gap',
    { coverage: true, gap: true },
    expected('coverage', 'rejected', 'coverage_gap'),
    ['E09'],
  ],
  [
    'C15-native-version-conflict',
    { conflict: true },
    expected('effect', 'conflict', 'effect_conflict'),
    ['E08', 'E20'],
  ],
  ['C16-private-unpublished', {}, expected('publication', 'unresolved', 'not_submitted'), ['E22']],
  [
    'C16-valid-publication-proof',
    { publication: true },
    expected('publication', 'supported'),
    ['E19', 'E22'],
  ],
  [
    'C16-invalid-publication-checkpoint',
    { publication_bad_checkpoint: true },
    expected('publication', 'rejected', 'dependency_invalid'),
    ['E19', 'E22'],
  ],
  [
    'C04-result-not-opening',
    { only_result: true },
    expected('integrity', 'rejected', 'schema_invalid'),
    ['E02'],
  ],
  ['C17-unknown-extension', { unknown_type: true }, { request: null }, ['E17']],
  [
    'C18-artifact-substitution',
    { artifact_mismatch: true },
    expected('authority', 'rejected', 'authority_invalid'),
    ['E10'],
  ],
  [
    'C20-unrelated-receipt',
    { wrong_join: true },
    expected('effect', 'unresolved', 'effect_unbound'),
    ['E08', 'E11'],
  ],
  ['C21-request-free-capture', { capture: true }, { request: null }, ['E06', 'E07']],
  [
    'C22-authority-scope',
    { scope_mismatch: true },
    expected('authority', 'rejected', 'authority_invalid'),
    ['E05', 'E15'],
  ],
  [
    'C23-other-window',
    { coverage: true, wrong_window: true },
    expected('coverage', 'unresolved', 'dependency_missing'),
    ['E09'],
  ],
  [
    'C24-forbidden-args-salt',
    { carrier_args_salt: true },
    expected('integrity', 'rejected', 'schema_invalid'),
    ['E01'],
  ],
  [
    'C24-forbidden-result-hash',
    { carrier_result: true },
    expected('integrity', 'rejected', 'schema_invalid'),
    ['E02'],
  ],
  ['F15-raw-jcs-request-opening', { raw_jcs_request: true }, {}, ['E01', 'E02']],
  [
    'F15-raw-jcs-request-opening-mismatch',
    { raw_jcs_request: true, raw_jcs_mutation: 'request' },
    {},
    ['E01', 'E02'],
  ],
  ['F15-raw-jcs-effect-opening', { raw_jcs_effect: true }, {}, ['E01', 'E02']],
  [
    'F15-raw-jcs-effect-opening-mismatch',
    { raw_jcs_effect: true, raw_jcs_mutation: 'effect' },
    {},
    ['E01', 'E02'],
  ],
  ['F16-relative-source-locator', { relative_locator: true }, {}, ['E10']],
  [
    'F17-policy-descriptor-proto-key',
    { raw_policy_proto: true },
    {
      request: {
        dimensions: { authority: d('rejected', 'authority_invalid') },
        reliance: { accepted: false },
      },
    },
    ['E15'],
  ],
  [
    'F02-posthoc-allow',
    { posthoc: true },
    expected('authority', 'unresolved', 'authority_unordered'),
    ['E05', 'E06', 'E16'],
  ],
  [
    'F03-current-after-dispatch',
    { current: true },
    expected('authority', 'unresolved', 'purpose_mismatch'),
    ['E16'],
  ],
  [
    'F03-current-before-dispatch',
    { current: true, pre_dispatch: true },
    expected('authority', 'supported', 'no_dispatch_observed'),
    ['E16'],
  ],
  [
    'F05-terminal-conflict',
    { terminal_conflict: true },
    { request: { execution: { deliveries: [{ state: 'conflict' }] } } },
    ['E06', 'E18'],
  ],
  [
    'F06-destination-progression',
    { progression: true },
    expected('effect', 'supported'),
    ['E08', 'E20'],
  ],
  [
    'F07-overlapping-policy',
    { overlap: true },
    expected('source', 'unresolved', 'policy_invalid'),
    ['E15'],
  ],
  [
    'F07-principal-not-run-key',
    { principal_only: true },
    expected('authority', 'rejected', 'authority_invalid'),
    ['E15'],
  ],
  [
    'F08-stale-source',
    { stale: true },
    expected('source', 'unresolved', 'freshness_unknown'),
    ['E16'],
  ],
  ['coverage-complete', { coverage: true }, expected('coverage', 'supported'), ['E09']],
  [
    'coverage-captured-material-missing',
    { coverage: true, no_captured: true },
    expected('coverage', 'unresolved', 'dependency_missing'),
    ['E09'],
  ],
  [
    'coverage-other-surface',
    { coverage: true, wrong_surface: true },
    expected('coverage', 'unresolved', 'dependency_missing'),
    ['E09'],
  ],
  [
    'revoked-authority',
    { revoked: true },
    expected('authority', 'rejected', 'authority_invalid'),
    ['E16'],
  ],
  [
    'opening-dependency-missing',
    { missing_artifact: true },
    {
      request: {
        dimensions: { authority: d('unresolved', 'dependency_missing'), binding: d('supported') },
      },
    },
    ['E10'],
  ],
  [
    'non-tool-content-id-omitted',
    { omit_content: true },
    expected('integrity', 'supported'),
    ['E01'],
  ],
]
for (const kind of ['request', 'authorization', 'observation', 'report', 'effect', 'coverage']) {
  for (const field of [
    'nonce',
    'subject',
    'source',
    'basis',
    'assertion',
    'unknown',
    'nonce_short',
    'source.kind',
    'source.identity',
    'source.method',
    'subject.namespace',
    'subject.id',
  ]) {
    definitions.push([
      `schema-${kind}-${field}`,
      {
        mutate_kind: kind,
        mutate_field: field,
        ...(kind === 'coverage' ? { coverage: true } : {}),
      },
      {},
      ['grammar'],
    ])
  }
}
const assertionFields: Record<string, string[]> = {
  request: ['descriptor', 'execution'],
  authorization: ['decision', 'authority_version', 'not_before', 'expires_at'],
  observation: ['phase', 'descriptor', 'execution', 'native_invocation', 'delivery', 'outcome'],
  report: ['status', 'text'],
  effect: ['object', 'payload_hash', 'version', 'state'],
  coverage: ['surface', 'start', 'end', 'expected', 'captured', 'gaps'],
}
for (const kind of ['observation', 'effect', 'coverage']) {
  for (const field of ['source.observed_at', 'source_basis']) {
    definitions.push([
      `schema-${kind}-${field.replace('.', '-')}`,
      {
        mutate_kind: kind,
        mutate_field: field,
        ...(kind === 'coverage' ? { coverage: true } : {}),
      },
      {},
      ['grammar', 'E06', 'E08', 'E09'],
    ])
  }
}
for (const field of [
  'source_locator_credential',
  'basis_locator_credential',
  'source_locator_invalid_port',
  'source_locator_invalid_ipv6',
])
  definitions.push([
    `schema-observation-${field}`,
    { mutate_kind: 'observation', mutate_field: field },
    {},
    ['grammar', 'E10'],
  ])
definitions.push(
  [
    'F11-single-destination-without-dispatch-id',
    { multiple_destinations: true, omit_dispatch_destination: true },
    {
      request: {
        dimensions: {
          binding: d('conflict', 'source_conflict'),
          effect: d('conflict', 'effect_conflict'),
        },
      },
    },
    ['E06', 'E08', 'E18'],
  ],
  [
    'F11-single-destination-conflict',
    { multiple_destinations: true },
    {
      request: {
        dimensions: {
          binding: d('conflict', 'source_conflict'),
          effect: d('conflict', 'effect_conflict'),
        },
      },
    },
    ['E06', 'E08', 'E18'],
  ],
  [
    'F11-multiple-destinations-allowed',
    { multiple_destinations: true, multiplicity_allowed: true },
    { request: { dimensions: { binding: d('supported'), effect: d('supported') } } },
    ['E06', 'E08', 'E18'],
  ],
  [
    'coverage-other-cursor-method',
    { coverage: true, other_cursor: true },
    expected('coverage', 'unresolved', 'dependency_missing'),
    ['E09'],
  ],
  [
    'coverage-unknown-cursor-order',
    { coverage: true, unknown_cursor: true },
    expected('coverage', 'unresolved', 'dependency_missing'),
    ['E09'],
  ],
  [
    'F12-future-record',
    { future_record: true, current: true, pre_dispatch: true },
    expected('integrity', 'rejected', 'schema_invalid'),
    ['E18'],
  ],
  [
    'F13-duplicate-records',
    { duplicate_records: true },
    { request: { reliance: { accepted: true } } },
    ['E18'],
  ],
  [
    'F14-wrong-kind-authority',
    { authority_wrong_kind: true },
    expected('authority', 'rejected', 'dependency_invalid'),
    ['E05', 'E18'],
  ],
  [
    'F09-occurrence-execution-conflict',
    { occurrence_execution: true },
    expected('binding', 'conflict', 'execution_mismatch'),
    ['E06', 'E18'],
  ],
  [
    'F09-occurrence-native-conflict',
    { occurrence_native: true },
    expected('binding', 'conflict', 'source_conflict'),
    ['E06', 'E18'],
  ],
  ['F10-dependency-depth-limit', { deep_dependencies: true }, {}, ['E10', 'E18']],
  [
    'schema-authorization-authority_basis',
    { mutate_kind: 'authorization', mutate_field: 'authority_basis' },
    {},
    ['grammar', 'E05'],
  ],
  [
    'schema-capture-source-observed_at',
    { capture: true, mutate_kind: 'observation', mutate_field: 'source.observed_at' },
    {},
    ['grammar', 'E06'],
  ],
  [
    'coverage-native-bytes-mismatch',
    { coverage: true, native_mismatch: true },
    expected('coverage', 'rejected', 'coverage_gap'),
    ['E09'],
  ],
  [
    'coverage-native-hash-missing',
    { coverage: true, native_hash_missing: true },
    expected('coverage', 'unresolved', 'dependency_missing'),
    ['E09'],
  ],
)
for (const [kind, fields] of Object.entries(assertionFields))
  for (const field of [
    ...fields.map((field) => `assertion.${field}`),
    ...(['authorization', 'observation', 'report', 'effect'].includes(kind) ? ['target'] : []),
  ]) {
    definitions.push([
      `schema-${kind}-${field.replace('.', '-')}`,
      {
        mutate_kind: kind,
        mutate_field: field,
        ...(kind === 'coverage' ? { coverage: true } : {}),
      },
      {},
      ['grammar'],
    ])
  }
mkdirSync(join(root, 'cases'), { recursive: true })
const cases = []
for (const [name, variant, expectation, rules] of definitions) {
  const input = await bundle(variant)
  const expected_ = name.startsWith('schema-') ? { invalid_kind: variant.mutate_kind } : expectation
  if (variant.no_policy) {
    expected_.statements = [
      {
        record_hash: input.request_hash!,
        dimensions: { source: d('unresolved', 'policy_missing') },
      },
    ]
  }
  if (variant.mutate_kind) {
    expected_.statements = input.records
      .filter((record) => record.event_type === `${EVIDENCE_PREFIX}${variant.mutate_kind}`)
      .map((record) => ({
        record_hash: digest(record),
        dimensions: {
          source: d('rejected', 'schema_invalid'),
        },
      }))
  }
  if (variant.raw_jcs_request || variant.raw_jcs_effect || variant.relative_locator) {
    const kind = variant.raw_jcs_effect ? 'effect' : 'request'
    const record = input.records.find(
      (candidate) => candidate.event_type === `${EVIDENCE_PREFIX}${kind}`,
    )!
    expected_.statements = [
      {
        record_hash: digest(record),
        dimensions: {
          integrity: {
            body: variant.raw_jcs_mutation ? d('rejected', 'opening_mismatch') : d('supported'),
          },
        },
      },
    ]
  }
  if (variant.raw_policy_proto) {
    expected_.statements = [
      {
        record_hash: input.request_hash!,
        dimensions: { integrity: { body: d('supported') } },
      },
    ]
  }
  if (variant.deep_dependencies)
    expected_.statements = [
      {
        record_hash: digest(input.records.at(-1)),
        dimensions: { source: d('unresolved', 'resource_limit') },
      },
    ]
  if (
    variant.native_mismatch ||
    variant.native_hash_missing ||
    variant.other_cursor ||
    variant.unknown_cursor
  ) {
    const coverage = input.records.find(
      (record) => record.event_type === `${EVIDENCE_PREFIX}coverage`,
    )!
    expected_.statements = [
      {
        record_hash: digest(coverage),
        dimensions: {
          coverage: variant.native_mismatch
            ? d('rejected', 'dependency_invalid')
            : d('unresolved', 'dependency_missing'),
        },
      },
    ]
  }
  if (
    variant.opening_mismatch ||
    variant.only_result ||
    variant.carrier_args_salt ||
    variant.carrier_result
  ) {
    expected_.statements = [
      {
        record_hash: input.request_hash,
        dimensions: {
          source: d('rejected', variant.opening_mismatch ? 'opening_mismatch' : 'schema_invalid'),
        },
      },
    ]
  }
  if (variant.wrong_window || variant.wrong_surface || variant.artifact_mismatch) {
    const kind = variant.artifact_mismatch ? 'authorization' : 'coverage'
    const record = input.records.find(
      (record) => record.event_type === `${EVIDENCE_PREFIX}${kind}`,
    )!
    expected_.statements = [
      {
        record_hash: digest(record),
        dimensions: variant.artifact_mismatch
          ? { authority: d('rejected', 'dependency_invalid') }
          : { coverage: d('rejected', 'target_mismatch') },
      },
    ]
  }
  if (variant.selected_untrusted) {
    expected_.statements = [
      {
        record_hash: input.evaluation.dispatch_record,
        dimensions: { integrity: d('supported'), source: d('rejected', 'source_untrusted') },
      },
    ]
  }
  if (variant.untrusted) {
    const record = input.records.find((record) => record.creator_key === keys.rogue)!
    expected_.request = {
      ...(expected_.request as Obj),
      dimensions: { source: d('supported') },
    }
    expected_.statements = [
      {
        record_hash: digest(record),
        dimensions: { integrity: d('supported'), source: d('rejected', 'source_untrusted') },
      },
    ]
  }
  if (name.startsWith('C16-')) {
    const request = expected_.request as Obj
    request.dimensions = { ...(request.dimensions as Obj), integrity: d('supported') }
  }
  const file = `cases/${name}.json`
  writeFileSync(
    join(root, file),
    `${JSON.stringify({ name, protects: name === 'C10-untrusted-injection' ? 'an added untrusted response cannot erase independently supported selected dispatch evidence (C10b)' : name, fails_when: 'the required evidence distinction is erased', no_claim: 'offline fixture sources, not installed capture or host durability', rules, input, expected: expected_ }, null, 2)}\n`,
  )
  cases.push({ file, name })
}
for (const [name, protected_, fail, expected_] of [
  ['C19-protected-retention-fails', true, true, { refused: true, gap: true, handler_calls: 0 }],
  [
    'C19-observational-retention-fails',
    false,
    true,
    { refused: false, gap: true, handler_calls: 1 },
  ],
  [
    'C19-protected-retention-succeeds',
    true,
    false,
    { refused: false, gap: false, handler_calls: 1 },
  ],
] as const) {
  const file = `cases/${name}.json`
  writeFileSync(
    join(root, file),
    `${JSON.stringify({ name, protects: 'refusal precedes the mediated effect in the contract model', fails_when: 'the failed protected path invokes the handler', no_claim: 'no installed executor, actual filesystem atomicity or bypass coverage', rules: ['E03', 'E14'], input: { mode: 'executor', protected: protected_, fail_retention: fail }, expected: expected_ }, null, 2)}\n`,
  )
  cases.push({ file, name })
}
writeFileSync(
  join(root, 'manifest.json'),
  `${JSON.stringify({ spec_section: '1.12', generator: 'packages/verify/test/generate-source-bound-corpus.ts', cases, fixture_keys: keys, scope: 'offline corpus model; not a production receiver or host conformance claim' }, null, 2)}\n`,
)
compactSourceBoundCorpus(root)
process.stdout.write(`Generated ${cases.length} deterministic cases\n`)
