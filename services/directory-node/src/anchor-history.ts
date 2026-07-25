import { existsSync } from 'node:fs'
import { mkdir, readFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import {
  directoryAnchorContextId,
  directoryAnchorGenesisRoot,
  hashDirectoryAnchor,
  verifyDirectoryAnchorSignature,
  type AnchorRecord,
} from './anchor.js'
import { appendJsonLineDurably } from './durable-jsonl.js'

interface PreparedAnchorEntry {
  state: 'prepared'
  record_hash: string
  record: AnchorRecord
}

interface CommittedAnchorEntry {
  state: 'committed'
  record_hash: string
}

interface BootstrapAnchorEntry {
  state: 'bootstrap'
  record_hash: string
}

type AnchorJournalEntry = BootstrapAnchorEntry | PreparedAnchorEntry | CommittedAnchorEntry

const RECORD_HASH_RE = /^sha256:[0-9a-f]{64}$/

/**
 * Durable directory-anchor body store and linear committed-chain index.
 *
 * A prepared entry is written before log submission. A committed entry is
 * written only after the log accepts the record or a lookup rediscovers it.
 * The unresolved prepared body remains available for exact retry after an
 * ambiguous response.
 */
export class AnchorHistory {
  private readonly byHash = new Map<string, AnchorRecord>()
  private readonly chronological: Array<{ recordHash: string; record: AnchorRecord }> = []
  private readonly pendingHashes: string[] = []
  private bootstrapRecordHash?: string

  private constructor(
    private readonly directoryOrigin: string,
    private readonly expectedCreatorKey: string,
    private readonly persistencePath?: string,
  ) {}

  static async create(
    directoryOrigin: string,
    expectedCreatorKey: string,
    persistencePath?: string,
  ): Promise<AnchorHistory> {
    const history = new AnchorHistory(directoryOrigin, expectedCreatorKey, persistencePath)
    if (!persistencePath) return history

    await mkdir(dirname(persistencePath), { recursive: true })
    if (!existsSync(persistencePath)) return history

    const text = await readFile(persistencePath, 'utf8')
    const lines = text.split('\n')
    const hasTornTail = text.length > 0 && !text.endsWith('\n')

    for (let index = 0; index < lines.length; index += 1) {
      const raw = lines[index]!.trim()
      if (!raw) continue

      let entry: AnchorJournalEntry
      try {
        entry = JSON.parse(raw) as AnchorJournalEntry
      } catch {
        if (hasTornTail && index === lines.length - 1) {
          // A crash may leave one incomplete tail. Earlier corruption is fatal.
          break
        }
        throw new Error(`directory anchor journal line ${index + 1} is not valid JSON`)
      }

      await history.applyReplayEntry(entry, index + 1)
    }

    return history
  }

  private async applyReplayEntry(entry: AnchorJournalEntry, line: number): Promise<void> {
    if (entry.state === 'bootstrap') {
      if (
        !RECORD_HASH_RE.test(entry.record_hash) ||
        this.bootstrapRecordHash ||
        this.byHash.size > 0
      ) {
        throw new Error(`directory anchor journal line ${line} has an invalid bootstrap`)
      }
      this.bootstrapRecordHash = entry.record_hash
      return
    }

    if (entry.state === 'prepared') {
      const record = entry.record
      if (
        !record ||
        entry.record_hash !== hashDirectoryAnchor(record) ||
        record.spec_version !== 'atrib/1.0' ||
        record.event_type !== 'https://atrib.dev/v1/types/directory_anchor' ||
        record.context_id !== directoryAnchorContextId(this.directoryOrigin) ||
        record.creator_key !== this.expectedCreatorKey ||
        record.metadata?.directory_origin !== this.directoryOrigin ||
        typeof record.metadata.directory_root !== 'string' ||
        typeof record.metadata.directory_epoch !== 'number' ||
        !(await verifyDirectoryAnchorSignature(record))
      ) {
        throw new Error(`directory anchor journal line ${line} has an invalid prepared record`)
      }
      if (this.byHash.has(entry.record_hash)) {
        throw new Error(
          `directory anchor journal line ${line} repeats prepared record ${entry.record_hash}`,
        )
      }
      if (this.pendingHashes.length > 0) {
        throw new Error(`directory anchor journal line ${line} prepares a second pending record`)
      }
      this.byHash.set(entry.record_hash, record)
      this.pendingHashes.push(entry.record_hash)
      return
    }

    if (entry.state !== 'committed' || typeof entry.record_hash !== 'string') {
      throw new Error(`directory anchor journal line ${line} has an unknown state`)
    }
    this.applyCommit(entry.record_hash, line)
  }

  private applyCommit(recordHash: string, line?: number): void {
    const record = this.byHash.get(recordHash)
    if (!record) {
      throw new Error(
        `directory anchor journal${line ? ` line ${line}` : ''} commits unknown record ${recordHash}`,
      )
    }

    const pendingIndex = this.pendingHashes.indexOf(recordHash)
    if (pendingIndex < 0) {
      throw new Error(
        `directory anchor journal${line ? ` line ${line}` : ''} repeats committed record ${recordHash}`,
      )
    }
    if (pendingIndex !== 0) {
      throw new Error(
        `directory anchor journal${line ? ` line ${line}` : ''} commits records out of order`,
      )
    }

    const expectedParent = this.latestCommittedHash()
    if (record.chain_root !== expectedParent) {
      throw new Error(
        `directory anchor journal${line ? ` line ${line}` : ''} breaks the anchor chain`,
      )
    }

    this.pendingHashes.shift()
    this.chronological.push({ recordHash, record })
  }

  async prepare(record: AnchorRecord, recordHash: string): Promise<void> {
    if (this.pendingHashes.length > 0) {
      throw new Error('cannot prepare a new directory anchor while another anchor is pending')
    }
    if (recordHash !== hashDirectoryAnchor(record)) {
      throw new Error('directory anchor record hash does not match its canonical body')
    }
    if (record.chain_root !== this.latestCommittedHash()) {
      throw new Error('directory anchor does not point to the current committed chain head')
    }

    if (this.persistencePath) {
      await appendJsonLineDurably(this.persistencePath, {
        state: 'prepared',
        record_hash: recordHash,
        record,
      })
    }
    this.byHash.set(recordHash, record)
    this.pendingHashes.push(recordHash)
  }

  async setBootstrapRecordHash(recordHash: string): Promise<void> {
    if (!RECORD_HASH_RE.test(recordHash) || this.bootstrapRecordHash || this.byHash.size > 0) {
      throw new Error('cannot set an invalid or conflicting directory anchor bootstrap')
    }
    if (this.persistencePath) {
      await appendJsonLineDurably(this.persistencePath, {
        state: 'bootstrap',
        record_hash: recordHash,
      })
    }
    this.bootstrapRecordHash = recordHash
  }

  async commit(recordHash: string): Promise<void> {
    if (this.persistencePath) {
      await appendJsonLineDurably(this.persistencePath, {
        state: 'committed',
        record_hash: recordHash,
      })
    }
    this.applyCommit(recordHash)
  }

  latestCommittedHash(): string {
    return (
      this.chronological.at(-1)?.recordHash ??
      this.bootstrapRecordHash ??
      directoryAnchorGenesisRoot(this.directoryOrigin)
    )
  }

  latestKnownRecord(): AnchorRecord | undefined {
    return this.pending()?.record ?? this.chronological.at(-1)?.record
  }

  hasBootstrap(): boolean {
    return this.bootstrapRecordHash !== undefined
  }

  pending(): { recordHash: string; record: AnchorRecord } | undefined {
    const recordHash = this.pendingHashes[0]
    if (!recordHash) return undefined
    return { recordHash, record: this.byHash.get(recordHash)! }
  }

  getByHash(recordHash: string): AnchorRecord | undefined {
    return this.byHash.get(recordHash)
  }

  recent(since?: number, limit = 100): AnchorRecord[] {
    const cap = Math.min(Math.max(1, limit), 1000)
    const filtered =
      typeof since === 'number'
        ? this.chronological.filter(({ record }) => record.timestamp > since)
        : this.chronological
    return filtered
      .slice()
      .reverse()
      .slice(0, cap)
      .map(({ record }) => record)
  }

  size(): number {
    return this.chronological.length
  }
}
