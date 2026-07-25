// SPDX-License-Identifier: Apache-2.0

import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import * as ed from '@noble/ed25519'
import { sha512 } from '@noble/hashes/sha2.js'
import { WitnessStore } from '../src/store.js'
import {
  checkpointKeyId,
  checkpointRootFromLeafHashes,
  createWitnessCosignature,
  verifyWitnessRetirement,
  witnessRetirementSigningInput,
} from '@atrib/verify'
import {
  createBackup,
  initializeOperator,
  normalizeCliArgs,
  retireOperator,
  restoreBackup,
  verifyBackup,
} from '../scripts/operator-kit.mjs'

ed.hashes.sha512 = sha512
ed.hashes.sha512Async = (message) => Promise.resolve(sha512(message))

const temporaryDirectories: string[] = []
const LOG_SEED = new Uint8Array(32).fill(7)
const WITNESS_SEED = new Uint8Array(32).fill(8)
const IMAGE = `ghcr.io/creatornader/atrib-witness-node@sha256:${'a'.repeat(64)}`

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    rmSync(temporaryDirectories.pop() as string, { recursive: true, force: true })
  }
})

describe('witness operator kit', () => {
  it('accepts the argument separator forwarded by pnpm', () => {
    expect(normalizeCliArgs(['--', 'init', '--name', 'witness.example'])).toEqual([
      'init',
      '--name',
      'witness.example',
    ])
  })

  it('writes a private seed file and a separate public trust root', async () => {
    const directory = temporaryDirectory()
    const envPath = join(directory, 'operator.env')
    const trustRootPath = join(directory, 'witness-trust-root.json')
    const logPublicKey = Buffer.alloc(32, 7).toString('base64url')
    const result = await initializeOperator({
      witnessName: 'witness.friend.example',
      logPublicKey,
      envPath,
      trustRootPath,
      epoch: 1,
      image: IMAGE,
    })

    const env = readFileSync(envPath, 'utf8')
    const seed = env.match(/^ATRIB_WITNESS_KEY=(.+)$/m)?.[1]
    expect(seed).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(statSync(envPath).mode & 0o777).toBe(0o600)
    expect(statSync(trustRootPath).mode & 0o777).toBe(0o644)
    expect(readFileSync(trustRootPath, 'utf8')).not.toContain(seed)
    expect(result.trustRoot.public_key).toBe(
      Buffer.from(await ed.getPublicKeyAsync(Buffer.from(seed as string, 'base64url'))).toString(
        'base64url',
      ),
    )
    expect(result.trustRoot).toMatchObject({ epoch: 1, status: 'active' })
    await expect(
      initializeOperator({
        witnessName: 'witness.friend.example',
        logPublicKey,
        envPath,
        trustRootPath,
        epoch: 1,
        image: IMAGE,
      }),
    ).rejects.toThrow('refusing to replace existing path')
  })

  it('backs up, verifies, and restores committed witness state', async () => {
    const directory = temporaryDirectory()
    const stateDirectory = join(directory, 'state')
    const backupDirectory = join(directory, 'backup')
    const restoredDirectory = join(directory, 'restored')
    await createFixtureState(stateDirectory)
    const witnessPublicKey = Buffer.from(await ed.getPublicKeyAsync(WITNESS_SEED)).toString(
      'base64url',
    )
    const logPublicKey = Buffer.from(await ed.getPublicKeyAsync(LOG_SEED)).toString('base64url')

    await expect(
      createBackup({
        stateDirectory,
        outputDirectory: backupDirectory,
        confirmStopped: false,
        witnessName: 'witness.friend.example',
        witnessEpoch: 1,
        witnessPublicKey,
        logPublicKey,
      }),
    ).rejects.toThrow('refusing an online backup')

    const backup = await createBackup({
      stateDirectory,
      outputDirectory: backupDirectory,
      confirmStopped: true,
      witnessName: 'witness.friend.example',
      witnessEpoch: 1,
      witnessPublicKey,
      logPublicKey,
    })
    expect(backup.manifest.states).toEqual([
      expect.objectContaining({ log_origin: 'log.fixture/v1', tree_size: 2 }),
    ])
    expect(backup.manifest.witness).toEqual({
      name: 'witness.friend.example',
      epoch: 1,
      public_key: witnessPublicKey,
    })
    expect((await verifyBackup(backupDirectory)).files.length).toBeGreaterThanOrEqual(3)

    await restoreBackup({ backupDirectory, stateDirectory: restoredDirectory })
    const restoredStore = new WitnessStore(restoredDirectory)
    const state = restoredStore.load('log.fixture/v1')
    expect(state?.treeSize).toBe(2)
    expect(restoredStore.loadLeafHashes(state as NonNullable<typeof state>)).toHaveLength(2)
  })

  it('rejects a backup whose state bytes changed after the manifest was written', async () => {
    const directory = temporaryDirectory()
    const stateDirectory = join(directory, 'state')
    const backupDirectory = join(directory, 'backup')
    await createFixtureState(stateDirectory)
    const witnessPublicKey = Buffer.from(await ed.getPublicKeyAsync(WITNESS_SEED)).toString(
      'base64url',
    )
    const logPublicKey = Buffer.from(await ed.getPublicKeyAsync(LOG_SEED)).toString('base64url')
    const backup = await createBackup({
      stateDirectory,
      outputDirectory: backupDirectory,
      confirmStopped: true,
      witnessName: 'witness.friend.example',
      witnessEpoch: 1,
      witnessPublicKey,
      logPublicKey,
    })
    const target = join(backupDirectory, 'state', backup.manifest.files[0]?.path as string)
    writeFileSync(target, 'tampered')
    await expect(verifyBackup(backupDirectory)).rejects.toThrow('integrity verification')
  })

  it('refuses to label a backup with trust roots that did not sign its state', async () => {
    const directory = temporaryDirectory()
    const stateDirectory = join(directory, 'state')
    await createFixtureState(stateDirectory)

    await expect(
      createBackup({
        stateDirectory,
        outputDirectory: join(directory, 'backup'),
        confirmStopped: true,
        witnessName: 'witness.friend.example',
        witnessEpoch: 1,
        witnessPublicKey: Buffer.alloc(32, 99).toString('base64url'),
        logPublicKey: Buffer.from(await ed.getPublicKeyAsync(LOG_SEED)).toString('base64url'),
      }),
    ).rejects.toThrow('does not match the supplied trust roots')
  })

  it('publishes a signed retirement without disclosing the witness seed', async () => {
    const directory = temporaryDirectory()
    const envPath = join(directory, 'operator.env')
    const trustRootPath = join(directory, 'witness-trust-root.json')
    const retirementPath = join(directory, 'witness-retirement.json')
    const initialized = await initializeOperator({
      witnessName: 'witness.friend.example',
      logPublicKey: Buffer.alloc(32, 7).toString('base64url'),
      envPath,
      trustRootPath,
      epoch: 1,
      image: IMAGE,
    })
    await expect(
      retireOperator({
        envPath,
        outputPath: retirementPath,
        epoch: 2,
        reason: 'operator ended the pilot',
      }),
    ).rejects.toThrow('retirement epoch does not match the operator environment')
    await expect(
      retireOperator({
        envPath,
        outputPath: retirementPath,
        epoch: 1,
        reason: 'operator ended the pilot',
        successorPublicKey: initialized.trustRoot.public_key,
      }),
    ).rejects.toThrow('successor public key must differ from the retired key')
    const retired = await retireOperator({
      envPath,
      outputPath: retirementPath,
      epoch: 1,
      reason: 'operator ended the pilot',
      retiredAt: '2026-10-25T00:00:00.000Z',
    })
    const { signature, ...unsigned } = retired.manifest
    expect(
      await ed.verifyAsync(
        Buffer.from(signature, 'base64url'),
        witnessRetirementSigningInput(unsigned),
        Buffer.from(initialized.trustRoot.public_key, 'base64url'),
      ),
    ).toBe(true)
    await expect(verifyWitnessRetirement(retired.manifest)).resolves.toMatchObject({
      valid: true,
    })
    const seed = readFileSync(envPath, 'utf8').match(/^ATRIB_WITNESS_KEY=(.+)$/m)?.[1]
    expect(readFileSync(retirementPath, 'utf8')).not.toContain(seed)
  })
})

function temporaryDirectory(): string {
  const path = mkdtempSync(join(tmpdir(), 'atrib-witness-operator-test-'))
  temporaryDirectories.push(path)
  return path
}

async function createFixtureState(stateDirectory: string): Promise<void> {
  const store = new WitnessStore(stateDirectory)
  const leafHashes = [new Uint8Array(32).fill(1), new Uint8Array(32).fill(2)]
  const rootHashBase64 = Buffer.from(checkpointRootFromLeafHashes(leafHashes)).toString('base64')
  const logPublicKey = await ed.getPublicKeyAsync(LOG_SEED)
  const checkpointBody = `log.fixture/v1\n2\n${rootHashBase64}\n`
  const operatorSignature = await ed.signAsync(new TextEncoder().encode(checkpointBody), LOG_SEED)
  const operatorPayload = Buffer.concat([
    Buffer.from(checkpointKeyId('log.fixture/v1', logPublicKey)),
    Buffer.from(operatorSignature),
  ])
  const checkpointNote =
    `${checkpointBody}\n` + `— log.fixture/v1 ${operatorPayload.toString('base64')}\n`
  const cosignature = await createWitnessCosignature({
    checkpointBody,
    witnessName: 'witness.friend.example',
    privateKey: WITNESS_SEED,
    timestampSeconds: 1_800_000_000,
  })
  store.commit(
    {
      logOrigin: 'log.fixture/v1',
      treeSize: 2,
      rootHashBase64,
      checkpointBody,
      checkpointNote,
      cosignature,
      witnessedAtSeconds: 1_800_000_000,
    },
    leafHashes,
  )
}
