// SPDX-License-Identifier: Apache-2.0
// Content-addressed fixture storage, independent of the verifier implementation.
import canonicalize from 'canonicalize'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export interface CorpusFixtureInput {
  records: Record<string, unknown>[]
  openings: Record<string, unknown>
  artifacts: Record<string, string>
  policy: unknown
  evaluation: unknown
  request_hash?: string
  publication?: { proofs: Record<string, unknown>; trust: unknown }
  mode?: string
  protected?: boolean
  fail_retention?: boolean
}

type StoredReference = `sha256:${string}`
type StoredArtifactMap = { $type: 'atrib-artifact-map/1'; $ref: StoredReference }
type CorpusCase = {
  name: string
  protects: string
  input: CorpusFixtureInput
  expected: {
    invalid_kind?: string
    statements?: Array<{ record_hash: string; [key: string]: unknown }>
    [key: string]: unknown
  }
  [key: string]: unknown
}
type CorpusStore = {
  json: Record<string, unknown>
  artifacts: Record<string, string>
  artifactMaps: Record<string, { format: 'atrib-artifact-map/1'; entries: Record<string, string> }>
}

const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
const jcs = (value: unknown): string => canonicalize(value) ?? 'null'
const storedReference = (value: unknown): value is StoredReference =>
  typeof value === 'string' && /^sha256:[0-9a-f]{64}$/.test(value)
const storeReferenceForJson = (value: unknown): StoredReference =>
  `sha256:${createHash('sha256').update(jcs(value), 'utf8').digest('hex')}`

function storeJson(store: CorpusStore, value: unknown): StoredReference {
  const reference = storeReferenceForJson(value)
  store.json[reference.slice(7)] = value
  return reference
}

function storeArtifact(store: CorpusStore, base64: string): StoredReference {
  const bytes = Buffer.from(base64, 'base64')
  if (bytes.toString('base64') !== base64) throw new Error('Artifact is not canonical base64')
  const reference = `sha256:${createHash('sha256').update(bytes).digest('hex')}` as StoredReference
  store.artifacts[reference.slice(7)] = base64
  return reference
}

function storeArtifactMap(
  store: CorpusStore,
  artifacts: Record<string, string>,
): StoredArtifactMap {
  const entries = Object.fromEntries(
    Object.entries(artifacts).map(([hash, bytes]) => [hash, storeArtifact(store, bytes)]),
  )
  const reference = storeReferenceForJson(artifacts)
  store.artifactMaps[reference.slice(7)] = { format: 'atrib-artifact-map/1', entries }
  return { $type: 'atrib-artifact-map/1', $ref: reference }
}

function writeStore(root: string, name: string, format: string, entries: Record<string, unknown>) {
  const directory = join(root, 'objects')
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, name), `${JSON.stringify({ format, entries }, null, 2)}\n`)
}

/** Rewrite generated fixture payloads as references to content-addressed values. */
export function compactSourceBoundCorpus(root: string): void {
  const manifestPath = join(root, 'manifest.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
    cases: Array<{ file: string }>
    [key: string]: unknown
  }
  const store: CorpusStore = { json: {}, artifacts: {}, artifactMaps: {} }
  for (const item of manifest.cases) {
    const path = join(root, item.file)
    const fixture = JSON.parse(readFileSync(path, 'utf8')) as CorpusCase
    if (fixture.input.mode === 'executor') continue
    fixture.input.records = fixture.input.records.map((record) =>
      storeJson(store, record),
    ) as unknown as Record<string, unknown>[]
    fixture.input.openings = Object.fromEntries(
      Object.entries(fixture.input.openings).map(([hash, opening]) => [
        hash,
        storeJson(store, opening),
      ]),
    ) as unknown as Record<string, Record<string, unknown>>
    fixture.input.artifacts = storeArtifactMap(store, fixture.input.artifacts) as unknown as Record<
      string,
      string
    >
    fixture.input.policy = storeJson(store, fixture.input.policy)
    fixture.input.evaluation = storeJson(store, fixture.input.evaluation)
    writeFileSync(path, `${JSON.stringify(fixture, null, 2)}\n`)
  }
  writeStore(root, 'json-values.json', 'atrib-conformance-json-values/1', store.json)
  writeStore(root, 'artifacts.json', 'atrib-conformance-artifacts/1', store.artifacts)
  writeStore(root, 'artifact-maps.json', 'atrib-conformance-artifact-maps/1', store.artifactMaps)
  manifest.fixture_store = {
    format: 'atrib-conformance-content-store/1',
    json_values: 'objects/json-values.json',
    artifact_bytes: 'objects/artifacts.json',
    artifact_maps: 'objects/artifact-maps.json',
  }
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
}

function loadStoredValue(store: CorpusStore, reference: StoredReference): unknown {
  const value = store.json[reference.slice(7)]
  if (value === undefined && !Object.hasOwn(store.json, reference.slice(7)))
    throw new Error(`Missing conformance JSON object ${reference}`)
  if (storeReferenceForJson(value) !== reference)
    throw new Error(`Conformance JSON object digest mismatch for ${reference}`)
  return value
}

function loadStoredJson(store: CorpusStore, reference: StoredReference): Record<string, unknown> {
  const value = loadStoredValue(store, reference)
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`Conformance JSON reference is not an object: ${reference}`)
  return value as Record<string, unknown>
}

function loadStoredArtifact(store: CorpusStore, reference: StoredReference): string {
  const encoded = store.artifacts[reference.slice(7)]
  if (encoded === undefined) throw new Error(`Missing conformance artifact ${reference}`)
  const bytes = Buffer.from(encoded, 'base64')
  if (
    bytes.toString('base64') !== encoded ||
    createHash('sha256').update(bytes).digest('hex') !== reference.slice(7)
  )
    throw new Error(`Conformance artifact digest mismatch for ${reference}`)
  return encoded
}

function loadStoredArtifactMap(
  store: CorpusStore,
  value: StoredArtifactMap,
): Record<string, string> {
  if (
    value.$type !== 'atrib-artifact-map/1' ||
    !storedReference(value.$ref) ||
    Object.keys(value).some((key) => !['$type', '$ref'].includes(key))
  )
    throw new Error('Invalid conformance artifact-map reference')
  const stored = store.artifactMaps[value.$ref.slice(7)]
  if (!stored) throw new Error(`Missing conformance artifact map ${value.$ref}`)
  if (
    !stored ||
    typeof stored !== 'object' ||
    Array.isArray(stored) ||
    stored.format !== 'atrib-artifact-map/1' ||
    !object(stored.entries) ||
    Object.keys(stored).some((key) => !['format', 'entries'].includes(key))
  )
    throw new Error(`Malformed conformance artifact map ${value.$ref}`)
  const artifacts: Record<string, string> = {}
  for (const [hash, reference] of Object.entries(stored.entries)) {
    if (!storedReference(reference))
      throw new Error(`Invalid artifact reference in map ${value.$ref}`)
    artifacts[hash] = loadStoredArtifact(store, reference)
  }
  if (storeReferenceForJson(artifacts) !== value.$ref)
    throw new Error(`Materialized artifact map digest mismatch for ${value.$ref}`)
  return artifacts
}

/** Read a case and resolve every corpus reference after validating its content hash. */
export function loadSourceBoundFixture(path: string): CorpusCase {
  const fixture = JSON.parse(readFileSync(path, 'utf8')) as CorpusCase
  const input = fixture.input
  if (input.mode === 'executor') return fixture
  const hasReferences =
    input.records.some(storedReference) ||
    Object.values(input.openings).some(storedReference) ||
    (typeof input.artifacts === 'object' &&
      input.artifacts !== null &&
      '$type' in input.artifacts) ||
    storedReference(input.policy) ||
    storedReference(input.evaluation)
  const store = hasReferences ? readCorpusStore(dirname(dirname(path))) : undefined
  if (
    input.records.some(
      (record) => storedReference(record) || typeof record !== 'object' || record === null,
    )
  )
    input.records = input.records.map((record) => {
      if (storedReference(record)) return loadStoredJson(store!, record)
      if (typeof record !== 'object' || record === null || Array.isArray(record))
        throw new Error('Invalid or unresolved conformance record reference')
      return record
    })
  for (const [hash, opening] of Object.entries(input.openings))
    if (storedReference(opening)) input.openings[hash] = loadStoredJson(store!, opening)
    else if (typeof opening !== 'object' || opening === null)
      throw new Error(`Invalid or unresolved conformance opening reference for ${hash}`)
  if (input.artifacts && typeof input.artifacts === 'object' && '$type' in input.artifacts) {
    input.artifacts = loadStoredArtifactMap(store!, input.artifacts as unknown as StoredArtifactMap)
  } else {
    for (const [hash, artifact] of Object.entries(input.artifacts)) {
      if (storedReference(artifact)) input.artifacts[hash] = loadStoredArtifact(store!, artifact)
      else if (
        typeof artifact !== 'string' ||
        artifact.startsWith('sha256:') ||
        Buffer.from(artifact, 'base64').toString('base64') !== artifact
      )
        throw new Error(`Invalid or unresolved conformance artifact reference for ${hash}`)
    }
  }
  if (typeof input.policy === 'string' && input.policy.startsWith('sha256:')) {
    if (!storedReference(input.policy)) throw new Error('Invalid conformance policy reference')
    input.policy = loadStoredValue(store!, input.policy)
  }
  if (typeof input.evaluation === 'string' && input.evaluation.startsWith('sha256:')) {
    if (!storedReference(input.evaluation))
      throw new Error('Invalid conformance evaluation reference')
    input.evaluation = loadStoredValue(store!, input.evaluation)
  }
  return fixture
}

function readCorpusStore(root: string): CorpusStore {
  const read = (name: string, format: string): Record<string, unknown> => {
    let parsed: unknown
    try {
      parsed = JSON.parse(readFileSync(join(root, 'objects', name), 'utf8'))
    } catch {
      throw new Error(`Missing or invalid conformance store ${name}`)
    }
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      Array.isArray(parsed) ||
      (parsed as Record<string, unknown>).format !== format ||
      !object((parsed as Record<string, unknown>).entries) ||
      Object.keys(parsed).some((key) => !['format', 'entries'].includes(key))
    )
      throw new Error(`Malformed conformance store ${name}`)
    const entries = (parsed as { entries: Record<string, unknown> }).entries
    if (Object.keys(entries).some((key) => !/^[0-9a-f]{64}$/.test(key)))
      throw new Error(`Invalid content key in conformance store ${name}`)
    return entries
  }
  const json = read('json-values.json', 'atrib-conformance-json-values/1')
  const artifacts = read('artifacts.json', 'atrib-conformance-artifacts/1')
  const artifactMaps = read('artifact-maps.json', 'atrib-conformance-artifact-maps/1')
  for (const [hash, value] of Object.entries(artifacts))
    if (typeof value !== 'string') throw new Error(`Invalid artifact store entry ${hash}`)
  return {
    json,
    artifacts: artifacts as Record<string, string>,
    artifactMaps: artifactMaps as CorpusStore['artifactMaps'],
  }
}
