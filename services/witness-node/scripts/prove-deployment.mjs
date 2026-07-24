#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0

import { verifyCheckpointWitnessThreshold, verifyOperatorCheckpoint } from '@atrib/verify'

const required = [
  'ATRIB_WITNESS_URL',
  'ATRIB_WITNESS_NAME',
  'ATRIB_WITNESS_PUBLIC_KEY',
  'ATRIB_WITNESS_LOG_URL',
  'ATRIB_WITNESS_LOG_ORIGIN',
  'ATRIB_WITNESS_LOG_PUBLIC_KEY',
]
const missing = required.filter((name) => !process.env[name])
if (missing.length > 0) {
  throw new Error(`missing ${missing.join(', ')}`)
}

const witnessUrl = process.env.ATRIB_WITNESS_URL.replace(/\/$/, '')
const logUrl = process.env.ATRIB_WITNESS_LOG_URL.replace(/\/$/, '')
const witnessName = process.env.ATRIB_WITNESS_NAME
const logOrigin = process.env.ATRIB_WITNESS_LOG_ORIGIN
const witnessPublicKey = process.env.ATRIB_WITNESS_PUBLIC_KEY
const logPublicKey = process.env.ATRIB_WITNESS_LOG_PUBLIC_KEY
const maxTreeLag = Number(process.env.ATRIB_WITNESS_MAX_TREE_LAG ?? 1000)
const maxAgeSeconds = Number(process.env.ATRIB_WITNESS_MAX_AGE_SECONDS ?? 300)
if (!Number.isSafeInteger(maxTreeLag) || maxTreeLag < 0) {
  throw new Error('ATRIB_WITNESS_MAX_TREE_LAG must be a non-negative safe integer')
}
if (!Number.isSafeInteger(maxAgeSeconds) || maxAgeSeconds < 0) {
  throw new Error('ATRIB_WITNESS_MAX_AGE_SECONDS must be a non-negative safe integer')
}

function base64ToBase64url(value) {
  return Buffer.from(value, 'base64').toString('base64url')
}

async function fetchText(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) })
  const body = await response.text()
  if (!response.ok) throw new Error(`${url} returned ${response.status}: ${body.slice(0, 200)}`)
  return body
}

async function fetchJson(url) {
  return JSON.parse(await fetchText(url))
}

const publishedKey = await fetchJson(`${witnessUrl}/v1/pubkey`)
if (publishedKey.origin !== witnessName || publishedKey.public_key !== witnessPublicKey) {
  throw new Error('witness key publication does not match the out-of-band trust root')
}

let proof
let witnessedTreeSize
let liveTreeSize
for (let attempt = 1; attempt <= 10; attempt += 1) {
  let snapshots
  try {
    snapshots = await Promise.all([
      fetchText(`${witnessUrl}/v1/checkpoint`),
      fetchText(`${logUrl}/v1/checkpoint`),
      fetchJson(`${witnessUrl}/v1/status`),
    ])
  } catch (error) {
    if (attempt === 10) throw error
    await new Promise((resolve) => setTimeout(resolve, 1_000))
    continue
  }
  const [witnessCheckpointNote, liveCheckpointNote, status] = snapshots
  if (status.error) throw new Error(`witness reports an update error: ${status.error}`)
  const [witnessOperator, liveOperator] = await Promise.all([
    verifyOperatorCheckpoint(witnessCheckpointNote, {
      name: logOrigin,
      publicKey: logPublicKey,
    }),
    verifyOperatorCheckpoint(liveCheckpointNote, {
      name: logOrigin,
      publicKey: logPublicKey,
    }),
  ])
  if (!witnessOperator.valid || !witnessOperator.checkpoint) {
    throw new Error(`witness checkpoint rejected: ${witnessOperator.reason}`)
  }
  if (!liveOperator.valid || !liveOperator.checkpoint) {
    throw new Error(`live log checkpoint rejected: ${liveOperator.reason}`)
  }
  witnessedTreeSize = witnessOperator.checkpoint.treeSize
  liveTreeSize = liveOperator.checkpoint.treeSize
  const witnessedRootHash = Buffer.from(witnessOperator.checkpoint.rootHash).toString('base64')
  if (
    witnessedTreeSize !== status.tree_size ||
    witnessedRootHash !== status.root_hash ||
    liveTreeSize < witnessedTreeSize ||
    liveTreeSize - witnessedTreeSize > maxTreeLag
  ) {
    if (attempt === 10) {
      throw new Error(
        `witness lag remained outside bounds: witnessed ${witnessedTreeSize}, live ${liveTreeSize}, maximum lag ${maxTreeLag}`,
      )
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000))
    continue
  }
  const rootHashBase64url = base64ToBase64url(witnessedRootHash)
  const cosignature = await fetchText(
    `${witnessUrl}/v1/cosig/${encodeURIComponent(logOrigin)}/${rootHashBase64url}`,
  )
  proof = await verifyCheckpointWitnessThreshold(
    `${witnessCheckpointNote.trimEnd()}\n${cosignature}`,
    {
      operatorKey: { name: logOrigin, publicKey: logPublicKey },
      witnessKeys: [{ name: witnessName, publicKey: witnessPublicKey }],
      requiredWitnesses: 1,
      maxAgeSeconds,
    },
  )
  break
}

if (!proof?.operator.valid || !proof.thresholdMet || proof.validWitnesses !== 1) {
  throw new Error(`witness verification failed: ${JSON.stringify(proof)}`)
}
process.stdout.write(
  JSON.stringify(
    {
      status: 'verified',
      witness: witnessName,
      log_origin: logOrigin,
      witnessed_tree_size: witnessedTreeSize,
      live_tree_size: liveTreeSize,
      tree_lag: liveTreeSize - witnessedTreeSize,
      valid_witnesses: proof.validWitnesses,
      required_witnesses: proof.requiredWitnesses,
    },
    null,
    2,
  ) + '\n',
)
