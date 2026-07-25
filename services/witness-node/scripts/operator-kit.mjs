#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0

import { createHash, randomBytes } from 'node:crypto'
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  closeSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import * as ed from '@noble/ed25519'
import { sha512 } from '@noble/hashes/sha2.js'
import {
  checkpointKeyId,
  verifyCheckpointWitnessThreshold,
  verifyWitnessRetirement,
  witnessRetirementSigningInput,
} from '@atrib/verify'
import { WitnessStore } from '../dist/store.js'

ed.hashes.sha512 = sha512
ed.hashes.sha512Async = (message) => Promise.resolve(sha512(message))

const BACKUP_SCHEMA = 'atrib.witness-state-backup.v1'
const TRUST_ROOT_SCHEMA = 'atrib.witness-trust-root.v1'
const RETIREMENT_SCHEMA = 'atrib.witness-retirement.v1'
const BASE64URL_KEY = /^[A-Za-z0-9_-]{43}$/
const SAFE_WITNESS_NAME = /^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/

export async function initializeOperator(options) {
  const witnessName = options.witnessName
  const logPublicKey = options.logPublicKey
  const envPath = resolve(options.envPath)
  const trustRootPath = resolve(options.trustRootPath)
  const epoch = parsePositiveInteger(options.epoch ?? 1, 'witness epoch')
  validateWitnessName(witnessName)
  validateBase64urlKey(logPublicKey, 'log public key')
  validateImageDigest(options.image)
  refuseExisting(envPath)
  refuseExisting(trustRootPath)

  const seed = randomBytes(32)
  const publicKey = await ed.getPublicKeyAsync(seed)
  const publicKeyText = Buffer.from(publicKey).toString('base64url')
  const keyId = Buffer.from(checkpointKeyId(witnessName, publicKey)).toString('hex')
  const env = [
    `ATRIB_WITNESS_NAME=${witnessName}`,
    `ATRIB_WITNESS_EPOCH=${epoch}`,
    `ATRIB_WITNESS_IMAGE=${options.image}`,
    `ATRIB_WITNESS_KEY=${seed.toString('base64url')}`,
    'ATRIB_WITNESS_LOG_URL=https://log.atrib.dev',
    'ATRIB_WITNESS_LOG_ORIGIN=log.atrib.dev/v1',
    `ATRIB_WITNESS_LOG_PUBLIC_KEY=${logPublicKey}`,
    'ATRIB_WITNESS_POLL_INTERVAL_MS=30000',
    'ATRIB_WITNESS_HEALTH_MAX_CHECK_AGE_SECONDS=120',
    'ATRIB_WITNESS_GOSSIP_SOURCES=[]',
    'PORT=3200',
    '',
  ].join('\n')
  const trustRoot = {
    schema: TRUST_ROOT_SCHEMA,
    witness_name: witnessName,
    epoch,
    public_key: publicKeyText,
    key_id: keyId,
    status: 'active',
  }

  mkdirSync(dirname(envPath), { recursive: true })
  mkdirSync(dirname(trustRootPath), { recursive: true })
  writeExclusive(envPath, env, 0o600)
  try {
    writeExclusive(trustRootPath, `${JSON.stringify(trustRoot, null, 2)}\n`, 0o644)
  } catch (error) {
    rmSync(envPath, { force: true })
    throw error
  }
  return { envPath, trustRootPath, trustRoot }
}

export async function createBackup(options) {
  if (!options.confirmStopped) {
    throw new Error('refusing an online backup; stop the witness and pass --confirm-stopped')
  }
  const stateDirectory = resolve(options.stateDirectory)
  const outputDirectory = resolve(options.outputDirectory)
  validateWitnessName(options.witnessName)
  validateBase64urlKey(options.witnessPublicKey, 'witness public key')
  validateBase64urlKey(options.logPublicKey, 'log public key')
  const witnessEpoch = parsePositiveInteger(options.witnessEpoch, 'witness epoch')
  if (!existsSync(stateDirectory) || !statSync(stateDirectory).isDirectory()) {
    throw new Error('state directory does not exist')
  }
  refuseExisting(outputDirectory)
  const before = inventoryState(stateDirectory)
  const verificationKeys = {
    witnessName: options.witnessName,
    witnessPublicKey: options.witnessPublicKey,
    logPublicKey: options.logPublicKey,
  }
  const stateSummary = await validateStateDirectory(stateDirectory, verificationKeys)
  const temporaryDirectory = `${outputDirectory}.tmp-${process.pid}-${Date.now()}`
  mkdirSync(join(temporaryDirectory, 'state'), { recursive: true, mode: 0o700 })
  try {
    for (const file of before) {
      const target = join(temporaryDirectory, 'state', file.path)
      mkdirSync(dirname(target), { recursive: true, mode: 0o700 })
      writeExclusive(target, readFileSync(join(stateDirectory, file.path)), 0o600)
    }
    const after = inventoryState(stateDirectory)
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      throw new Error('state changed during backup; keep the witness stopped and retry')
    }
    const copied = inventoryState(join(temporaryDirectory, 'state'))
    if (JSON.stringify(before) !== JSON.stringify(copied)) {
      throw new Error('backup copy does not match the source state')
    }
    const manifest = {
      schema: BACKUP_SCHEMA,
      created_at: new Date().toISOString(),
      files: copied,
      witness: {
        name: options.witnessName,
        epoch: witnessEpoch,
        public_key: options.witnessPublicKey,
      },
      log_public_key: options.logPublicKey,
      log_public_key_sha256: sha256(Buffer.from(options.logPublicKey, 'base64url')),
      states: stateSummary.states,
      incident_count: stateSummary.incidentCount,
    }
    writeExclusive(
      join(temporaryDirectory, 'backup-manifest.json'),
      `${JSON.stringify(manifest, null, 2)}\n`,
      0o600,
    )
    renameSync(temporaryDirectory, outputDirectory)
    return { outputDirectory, manifest }
  } catch (error) {
    rmSync(temporaryDirectory, { recursive: true, force: true })
    throw error
  }
}

export async function verifyBackup(backupDirectory) {
  const root = resolve(backupDirectory)
  const manifestPath = join(root, 'backup-manifest.json')
  if (!existsSync(manifestPath)) throw new Error('backup manifest is missing')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  if (
    manifest?.schema !== BACKUP_SCHEMA ||
    typeof manifest.created_at !== 'string' ||
    !Array.isArray(manifest.files) ||
    manifest.witness === null ||
    typeof manifest.witness !== 'object' ||
    typeof manifest.witness.name !== 'string' ||
    !Number.isSafeInteger(manifest.witness.epoch) ||
    manifest.witness.epoch < 1 ||
    typeof manifest.witness.public_key !== 'string' ||
    !BASE64URL_KEY.test(manifest.witness.public_key) ||
    typeof manifest.log_public_key !== 'string' ||
    !BASE64URL_KEY.test(manifest.log_public_key) ||
    typeof manifest.log_public_key_sha256 !== 'string' ||
    !/^[0-9a-f]{64}$/.test(manifest.log_public_key_sha256) ||
    !Array.isArray(manifest.states) ||
    !Number.isSafeInteger(manifest.incident_count) ||
    manifest.incident_count < 0
  ) {
    throw new Error('backup manifest is malformed')
  }
  if (
    sha256(Buffer.from(manifest.log_public_key, 'base64url')) !== manifest.log_public_key_sha256
  ) {
    throw new Error('backup log key fingerprint does not match the recorded key')
  }
  validateWitnessName(manifest.witness.name)
  const expectedPaths = new Set()
  for (const file of manifest.files) {
    validateManifestFile(file)
    if (expectedPaths.has(file.path)) throw new Error(`duplicate backup path: ${file.path}`)
    expectedPaths.add(file.path)
    const path = join(root, 'state', file.path)
    assertInside(join(root, 'state'), path)
    if (!existsSync(path) || !lstatSync(path).isFile()) {
      throw new Error(`backup file is missing or not regular: ${file.path}`)
    }
    const bytes = readFileSync(path)
    if (bytes.length !== file.bytes || sha256(bytes) !== file.sha256) {
      throw new Error(`backup file failed integrity verification: ${file.path}`)
    }
  }
  const actual = inventoryState(join(root, 'state'))
  if (actual.length !== manifest.files.length) {
    throw new Error('backup contains unlisted state files')
  }
  for (const file of actual) {
    if (!expectedPaths.has(file.path))
      throw new Error(`backup contains unlisted file: ${file.path}`)
  }
  const summary = await validateStateDirectory(join(root, 'state'), {
    witnessName: manifest.witness.name,
    witnessPublicKey: manifest.witness.public_key,
    logPublicKey: manifest.log_public_key,
  })
  if (JSON.stringify(summary.states) !== JSON.stringify(manifest.states)) {
    throw new Error('backup state summary does not match restored state')
  }
  if (summary.incidentCount !== manifest.incident_count) {
    throw new Error('backup incident count does not match restored state')
  }
  return manifest
}

export async function retireOperator(options) {
  const env = parseEnvFile(resolve(options.envPath))
  const witnessName = env.ATRIB_WITNESS_NAME
  const seedText = env.ATRIB_WITNESS_KEY
  validateWitnessName(witnessName)
  validateBase64urlKey(seedText, 'witness seed')
  const epoch = parsePositiveInteger(options.epoch, 'witness epoch')
  const configuredEpoch = parsePositiveInteger(env.ATRIB_WITNESS_EPOCH, 'configured witness epoch')
  if (epoch !== configuredEpoch) {
    throw new Error('retirement epoch does not match the operator environment')
  }
  const reason = options.reason
  if (
    typeof reason !== 'string' ||
    reason.length === 0 ||
    reason.length > 500 ||
    reason.includes('\n') ||
    reason.includes('\r')
  ) {
    throw new Error('retirement reason must be a non-empty single line of at most 500 characters')
  }
  if (options.successorPublicKey !== undefined) {
    validateBase64urlKey(options.successorPublicKey, 'successor public key')
  }
  const seed = Buffer.from(seedText, 'base64url')
  const publicKey = await ed.getPublicKeyAsync(seed)
  const publicKeyText = Buffer.from(publicKey).toString('base64url')
  if (options.successorPublicKey === publicKeyText) {
    throw new Error('successor public key must differ from the retired key')
  }
  const outputPath = resolve(options.outputPath)
  refuseExisting(outputPath)
  const unsigned = {
    schema: RETIREMENT_SCHEMA,
    witness_name: witnessName,
    epoch,
    public_key: publicKeyText,
    retired_at: options.retiredAt ?? new Date().toISOString(),
    reason,
    ...(options.successorPublicKey === undefined
      ? {}
      : { successor_public_key: options.successorPublicKey }),
  }
  const signature = await ed.signAsync(witnessRetirementSigningInput(unsigned), seed)
  const manifest = {
    ...unsigned,
    signature: Buffer.from(signature).toString('base64url'),
  }
  const verification = await verifyWitnessRetirement(manifest)
  if (!verification.valid) {
    throw new Error(`generated witness retirement did not verify: ${verification.reason}`)
  }
  mkdirSync(dirname(outputPath), { recursive: true })
  writeExclusive(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, 0o644)
  return { outputPath, manifest }
}

export async function restoreBackup(options) {
  const backupDirectory = resolve(options.backupDirectory)
  const stateDirectory = resolve(options.stateDirectory)
  const manifest = await verifyBackup(backupDirectory)
  refuseExisting(stateDirectory)
  const temporaryDirectory = `${stateDirectory}.tmp-${process.pid}-${Date.now()}`
  mkdirSync(temporaryDirectory, { recursive: true, mode: 0o700 })
  try {
    for (const file of manifest.files) {
      const source = join(backupDirectory, 'state', file.path)
      const target = join(temporaryDirectory, file.path)
      mkdirSync(dirname(target), { recursive: true, mode: 0o700 })
      writeExclusive(target, readFileSync(source), 0o600)
    }
    await validateStateDirectory(temporaryDirectory, {
      witnessName: manifest.witness.name,
      witnessPublicKey: manifest.witness.public_key,
      logPublicKey: manifest.log_public_key,
    })
    renameSync(temporaryDirectory, stateDirectory)
    return { stateDirectory, manifest }
  } catch (error) {
    rmSync(temporaryDirectory, { recursive: true, force: true })
    throw error
  }
}

function inventoryState(root) {
  const files = []
  walk(root, '')
  return files.sort((left, right) => left.path.localeCompare(right.path))

  function walk(directory, prefix) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name
      const path = join(directory, entry.name)
      const stat = lstatSync(path)
      if (entry.isSymbolicLink()) throw new Error(`state contains a symbolic link: ${relativePath}`)
      if (entry.isDirectory()) {
        walk(path, relativePath)
        continue
      }
      if (!entry.isFile()) throw new Error(`state contains a non-regular file: ${relativePath}`)
      if (/\.tmp-\d+-\d+$/.test(entry.name)) {
        throw new Error(`state contains an unfinished durable-write file: ${relativePath}`)
      }
      const bytes = readFileSync(path)
      files.push({ path: relativePath, bytes: bytes.length, sha256: sha256(bytes) })
      if (stat.size !== bytes.length)
        throw new Error(`state file changed while reading: ${relativePath}`)
    }
  }
}

async function validateStateDirectory(root, verificationKeys) {
  const store = new WitnessStore(root)
  const stateFiles = readdirSync(root)
    .filter((name) => /^[0-9a-f]{64}\.json$/.test(name))
    .sort()
  if (stateFiles.length === 0)
    throw new Error('state directory has no committed witness checkpoint')
  const states = await Promise.all(
    stateFiles.map(async (name) => {
      const parsed = JSON.parse(readFileSync(join(root, name), 'utf8'))
      const state = store.load(parsed.logOrigin)
      if (!state) throw new Error(`witness state could not be loaded: ${name}`)
      const hashes = store.loadLeafHashes(state)
      if (hashes.length !== state.treeSize) throw new Error(`leaf history is incomplete: ${name}`)
      const rootHashBase64url = Buffer.from(state.rootHashBase64, 'base64').toString('base64url')
      if (store.getCosignature(state.logOrigin, rootHashBase64url) !== state.cosignature) {
        throw new Error(`current cosignature is missing: ${name}`)
      }
      const verification = await verifyCheckpointWitnessThreshold(
        `${state.checkpointNote.trimEnd()}\n${state.cosignature}`,
        {
          operatorKey: {
            name: state.logOrigin,
            publicKey: verificationKeys.logPublicKey,
          },
          witnessKeys: [
            {
              name: verificationKeys.witnessName,
              publicKey: verificationKeys.witnessPublicKey,
            },
          ],
          requiredWitnesses: 1,
          nowSeconds: state.witnessedAtSeconds,
          maxAgeSeconds: 0,
          futureSkewSeconds: 0,
        },
      )
      if (!verification.operator.valid || !verification.thresholdMet) {
        throw new Error(`witness state does not match the supplied trust roots: ${name}`)
      }
      return {
        log_origin: state.logOrigin,
        tree_size: state.treeSize,
        root_hash: state.rootHashBase64,
        witnessed_at: state.witnessedAtSeconds,
      }
    }),
  )
  return { states, incidentCount: store.listIncidents().length }
}

function validateManifestFile(file) {
  if (
    file === null ||
    typeof file !== 'object' ||
    typeof file.path !== 'string' ||
    !Number.isSafeInteger(file.bytes) ||
    file.bytes < 0 ||
    typeof file.sha256 !== 'string' ||
    !/^[0-9a-f]{64}$/.test(file.sha256)
  ) {
    throw new Error('backup manifest has a malformed file entry')
  }
  if (
    file.path.length === 0 ||
    isAbsolute(file.path) ||
    file.path.includes('\\') ||
    file.path.split('/').some((part) => part === '' || part === '.' || part === '..')
  ) {
    throw new Error(`backup manifest has an unsafe path: ${file.path}`)
  }
}

function validateWitnessName(name) {
  if (typeof name !== 'string' || !SAFE_WITNESS_NAME.test(name)) {
    throw new Error('witness name must be a lowercase DNS name')
  }
}

function parsePositiveInteger(value, label) {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${label} must be a positive safe integer`)
  }
  return parsed
}

function parseEnvFile(path) {
  const env = {}
  for (const [index, raw] of readFileSync(path, 'utf8').split('\n').entries()) {
    const line = raw.trim()
    if (line.length === 0 || line.startsWith('#')) continue
    const separator = line.indexOf('=')
    if (separator <= 0) throw new Error(`invalid env assignment at line ${index + 1}`)
    const name = line.slice(0, separator)
    if (Object.hasOwn(env, name)) throw new Error(`duplicate env assignment: ${name}`)
    env[name] = line.slice(separator + 1)
  }
  return env
}

function validateBase64urlKey(value, label) {
  if (typeof value !== 'string' || !BASE64URL_KEY.test(value)) {
    throw new Error(`${label} must be a canonical 32-byte base64url key`)
  }
}

function validateImageDigest(value) {
  if (
    typeof value !== 'string' ||
    value.includes('\n') ||
    value.includes('\r') ||
    !/@sha256:[0-9a-f]{64}$/.test(value)
  ) {
    throw new Error('image must be an immutable OCI sha256 digest reference')
  }
}

function refuseExisting(path) {
  if (existsSync(path)) throw new Error(`refusing to replace existing path: ${path}`)
}

function writeExclusive(path, content, mode) {
  const fd = openSync(path, 'wx', mode)
  try {
    writeFileSync(fd, content)
  } finally {
    closeSync(fd)
  }
  chmodSync(path, mode)
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function assertInside(root, path) {
  const rel = relative(resolve(root), resolve(path))
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error(`path escapes backup root: ${path}`)
  }
}

function parseOptions(args) {
  const options = {}
  for (let index = 0; index < args.length; index += 1) {
    const name = args[index]
    if (!name.startsWith('--')) throw new Error(`unexpected argument: ${name}`)
    if (name === '--confirm-stopped') {
      options.confirmStopped = true
      continue
    }
    const value = args[index + 1]
    if (value === undefined || value.startsWith('--')) throw new Error(`missing value for ${name}`)
    options[name.slice(2)] = value
    index += 1
  }
  return options
}

export function normalizeCliArgs(args) {
  return args[0] === '--' ? args.slice(1) : args
}

async function main(args) {
  const normalizedArgs = normalizeCliArgs(args)
  const [command, ...rest] = normalizedArgs
  const options = parseOptions(rest)
  if (command === 'init') {
    const result = await initializeOperator({
      witnessName: options.name,
      logPublicKey: options['log-public-key'],
      envPath: options['env-file'],
      trustRootPath: options['trust-root-file'],
      epoch: options.epoch,
      image: options.image,
    })
    process.stdout.write(
      `${JSON.stringify({ ...result.trustRoot, status: 'initialized', trust_root_status: result.trustRoot.status, env_file: result.envPath, trust_root_file: result.trustRootPath }, null, 2)}\n`,
    )
    return
  }
  if (command === 'backup') {
    const result = await createBackup({
      stateDirectory: options['state-dir'],
      outputDirectory: options['output-dir'],
      confirmStopped: options.confirmStopped,
      witnessName: options['witness-name'],
      witnessEpoch: options['witness-epoch'],
      witnessPublicKey: options['witness-public-key'],
      logPublicKey: options['log-public-key'],
    })
    process.stdout.write(
      `${JSON.stringify({ status: 'backed_up', output_directory: result.outputDirectory, states: result.manifest.states.length, files: result.manifest.files.length }, null, 2)}\n`,
    )
    return
  }
  if (command === 'verify-backup') {
    const manifest = await verifyBackup(options['backup-dir'])
    process.stdout.write(
      `${JSON.stringify({ status: 'verified', states: manifest.states.length, files: manifest.files.length, incident_count: manifest.incident_count }, null, 2)}\n`,
    )
    return
  }
  if (command === 'restore') {
    const result = await restoreBackup({
      backupDirectory: options['backup-dir'],
      stateDirectory: options['state-dir'],
    })
    process.stdout.write(
      `${JSON.stringify({ status: 'restored', state_directory: result.stateDirectory, states: result.manifest.states.length }, null, 2)}\n`,
    )
    return
  }
  if (command === 'retire') {
    const result = await retireOperator({
      envPath: options['env-file'],
      outputPath: options['output-file'],
      epoch: options.epoch,
      reason: options.reason,
      successorPublicKey: options['successor-public-key'],
    })
    process.stdout.write(
      `${JSON.stringify({ status: 'retired', output_file: result.outputPath, witness_name: result.manifest.witness_name, epoch: result.manifest.epoch, public_key: result.manifest.public_key }, null, 2)}\n`,
    )
    return
  }
  throw new Error(
    `usage:
  operator-kit.mjs init --name NAME --epoch N --image IMAGE@sha256:DIGEST --log-public-key KEY --env-file PATH --trust-root-file PATH
  operator-kit.mjs backup --state-dir PATH --output-dir PATH --witness-name NAME --witness-epoch N --witness-public-key KEY --log-public-key KEY --confirm-stopped
  operator-kit.mjs verify-backup --backup-dir PATH
  operator-kit.mjs restore --backup-dir PATH --state-dir PATH
  operator-kit.mjs retire --env-file PATH --epoch N --reason TEXT --output-file PATH [--successor-public-key KEY]`,
  )
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : undefined
if (invokedPath === import.meta.url) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(
      `atrib-witness-operator: ${error instanceof Error ? error.message : String(error)}\n`,
    )
    process.exitCode = 1
  })
}
