#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0

import { readdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const PENDING = 'pending'
const COMPLETE = 'complete'

function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function pendingReceipts(line) {
  if (!isObject(line) || !isObject(line._local) || !Array.isArray(line._local.ots_receipts)) {
    return []
  }
  return line._local.ots_receipts
    .map((receipt, index) => ({ receipt, index }))
    .filter(({ receipt }) => isObject(receipt) && receipt.status === PENDING)
}

function isCompleteReceipt(receipt) {
  return (
    isObject(receipt) &&
    receipt.status === COMPLETE &&
    typeof receipt.ots_b64 === 'string' &&
    typeof receipt.commitment_hex === 'string' &&
    Number.isFinite(receipt.attested_time_ms)
  )
}

async function defaultUpgradeReceipt(receipt) {
  const verify = await import('@atrib/verify')
  if (typeof verify.upgradeOpenTimestampsReceipt !== 'function') {
    throw new Error('the installed @atrib/verify package has no OTS receipt upgrade transport')
  }
  return verify.upgradeOpenTimestampsReceipt(receipt)
}

async function rewriteFile(path, upgradeReceipt, logger) {
  let text
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    logger(`atrib: OTS receipt worker skipped ${path}: ${error instanceof Error ? error.message : String(error)}`)
    return { files: 0, upgraded: 0, pending: 0, malformed: 1, unchanged: 0 }
  }

  const lines = text.split('\n')
  let changed = false
  const stats = { files: 1, upgraded: 0, pending: 0, malformed: 0, unchanged: 0 }
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const source = lines[lineIndex]
    if (!source.trim()) continue
    let envelope
    try {
      envelope = JSON.parse(source)
    } catch {
      stats.malformed += 1
      logger(`atrib: OTS receipt worker skipped malformed sidecar line in ${path}:${lineIndex + 1}`)
      continue
    }
    const receipts = pendingReceipts(envelope)
    if (receipts.length === 0) {
      stats.unchanged += 1
      continue
    }
    for (const { receipt, index } of receipts) {
      stats.pending += 1
      try {
        const upgraded = await upgradeReceipt(receipt)
        if (!isCompleteReceipt(upgraded)) {
          logger(`atrib: OTS receipt worker kept pending receipt in ${path}:${lineIndex + 1}`)
          continue
        }
        envelope._local.ots_receipts[index] = upgraded
        stats.upgraded += 1
        changed = true
      } catch (error) {
        logger(`atrib: OTS receipt worker kept pending receipt in ${path}:${lineIndex + 1}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    lines[lineIndex] = JSON.stringify(envelope)
  }

  if (changed) {
    const replacement = `${lines.join('\n')}${text.endsWith('\n') ? '' : '\n'}`
    const temporary = `${path}.ots-upgrade-${process.pid}.tmp`
    try {
      await writeFile(temporary, replacement, 'utf8')
      await rename(temporary, path)
    } catch (error) {
      logger(`atrib: OTS receipt worker could not update ${path}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return stats
}

export async function upgradeOtsReceipts({ mirrorDir, upgradeReceipt = defaultUpgradeReceipt, logger = console.warn }) {
  const total = { files: 0, upgraded: 0, pending: 0, malformed: 0, unchanged: 0 }
  let entries
  try {
    entries = await readdir(mirrorDir, { withFileTypes: true })
  } catch (error) {
    logger(`atrib: OTS receipt worker skipped ${mirrorDir}: ${error instanceof Error ? error.message : String(error)}`)
    return total
  }
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue
    const result = await rewriteFile(join(mirrorDir, entry.name), upgradeReceipt, logger)
    for (const key of Object.keys(total)) total[key] += result[key]
  }
  return total
}

function parseArgs(argv) {
  const args = { mirrorDir: undefined }
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] !== '--mirror-dir') throw new Error(`unknown argument: ${argv[index]}`)
    args.mirrorDir = argv[++index]
  }
  if (!args.mirrorDir) throw new Error('--mirror-dir is required')
  return args
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const report = await upgradeOtsReceipts({ mirrorDir: args.mirrorDir })
  console.log(JSON.stringify(report))
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((error) => {
    console.warn(`atrib: OTS receipt worker failed: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 0
  })
}
