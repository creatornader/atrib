// SPDX-License-Identifier: Apache-2.0

import { readdir, readFile, stat } from 'node:fs/promises'
import { extname, join, resolve } from 'node:path'
import { canonicalRecord, hexEncode, sha256, verifyRecord, type AtribRecord } from '@atrib/mcp'
import { parseOperatingEvent, type OperatingEntry, type OperatingEnvelope } from './model.js'

function recordHash(record: AtribRecord): string {
  return `sha256:${hexEncode(sha256(canonicalRecord(record)))}`
}

async function mirrorFiles(path: string): Promise<string[]> {
  const absolute = resolve(path)
  const pathStat = await stat(absolute)
  if (pathStat.isFile()) return [absolute]
  if (!pathStat.isDirectory()) return []
  const entries = await readdir(absolute, { withFileTypes: true })
  return entries
    .filter((entry) => entry.isFile() && extname(entry.name) === '.jsonl')
    .map((entry) => join(absolute, entry.name))
    .sort()
}

export async function mirrorFingerprint(path: string): Promise<string> {
  const files = await mirrorFiles(path)
  const rows = await Promise.all(
    files.map(async (file) => {
      const fileStat = await stat(file)
      return `${file}:${fileStat.size}:${fileStat.mtimeMs}`
    }),
  )
  return rows.join('|')
}

export async function loadOperatingEntries(
  path: string,
  maxRecords = 100_000,
): Promise<OperatingEntry[]> {
  const files = await mirrorFiles(path)
  const deduped = new Map<string, OperatingEntry>()
  let recordsRead = 0

  for (const file of files) {
    const lines = (await readFile(file, 'utf8')).split('\n')
    for (const line of lines) {
      if (!line.trim()) continue
      recordsRead += 1
      if (recordsRead > maxRecords) {
        throw new Error(`mirror record limit exceeded (${maxRecords})`)
      }
      let envelope: OperatingEnvelope
      try {
        envelope = JSON.parse(line) as OperatingEnvelope
      } catch {
        continue
      }
      if (!envelope.record || typeof envelope.record !== 'object') continue
      const event = parseOperatingEvent(envelope._local?.content)
      if (!event) continue
      const hash = recordHash(envelope.record)
      const signatureVerified = await verifyRecord(envelope.record).catch(() => false)
      deduped.set(hash, {
        record_hash: hash,
        record: envelope.record,
        event,
        signature_verified: signatureVerified,
        proof_supplied: envelope.proof !== undefined && envelope.proof !== null,
        producer: envelope._local?.producer ?? null,
      })
    }
  }
  return [...deduped.values()]
}
