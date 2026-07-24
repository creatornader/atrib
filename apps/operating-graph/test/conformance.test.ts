// SPDX-License-Identifier: Apache-2.0

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { AtribRecord } from '@atrib/mcp'
import {
  projectOperatingView,
  taskIdsVisibleToAgent,
  type OperatingEntry,
  type OperatingEvent,
} from '../src/model.js'

interface FixtureEntry {
  id: string
  hash_character: string
  timestamp: number
  informed_by?: string[]
  event: OperatingEvent & {
    accepted_head?: string
    resolves?: string[]
  }
}

interface Fixture {
  schema: string
  workspace_id: string
  receiving_agent_id: string
  entries: FixtureEntry[]
  checkpoints: Array<{
    after_entries: number
    cell_status: string
    accepted_entry_id: string | null
  }>
  expected_receiving_agent_task_ids: string[]
  expected_receiving_agent_entry_ids: string[]
}

const HERE = dirname(fileURLToPath(import.meta.url))
const fixture = JSON.parse(
  readFileSync(resolve(HERE, '..', 'conformance', 'operating-view-v1.json'), 'utf8'),
) as Fixture

function hash(character: string): string {
  return `sha256:${character.repeat(64)}`
}

function expandEntries(): OperatingEntry[] {
  const hashes = new Map(fixture.entries.map((entry) => [entry.id, hash(entry.hash_character)]))
  return fixture.entries.map((entry) => {
    const event = {
      ...entry.event,
      ...(entry.event.accepted_head
        ? { accepted_head: hashes.get(entry.event.accepted_head) }
        : {}),
      ...(entry.event.resolves
        ? { resolves: entry.event.resolves.map((id) => hashes.get(id)!) }
        : {}),
    }
    return {
      record_hash: hashes.get(entry.id)!,
      record: {
        spec_version: 'atrib/1.0',
        content_id: hash('f'),
        creator_key: event.agent?.id ?? 'fixture',
        chain_root: hash('0'),
        event_type: 'https://atrib.dev/v1/types/observation',
        context_id: '1'.repeat(32),
        timestamp: entry.timestamp,
        signature: 'fixture-signature',
        ...(entry.informed_by
          ? { informed_by: entry.informed_by.map((id) => hashes.get(id)!) }
          : {}),
      } as AtribRecord,
      event,
      signature_verified: true,
      proof_supplied: false,
      producer: 'application-conformance',
    }
  })
}

describe('operating-view application conformance', () => {
  it('matches the published conflict, resolution, and handoff fixture', () => {
    expect(fixture.schema).toBe('atrib.operating-view-conformance/v1')
    const entries = expandEntries()

    for (const checkpoint of fixture.checkpoints) {
      const view = projectOperatingView(entries.slice(0, checkpoint.after_entries), {
        workspace_id: fixture.workspace_id,
      })
      expect(view.cells[0]?.status).toBe(checkpoint.cell_status)
      const expectedHash =
        checkpoint.accepted_entry_id === null
          ? null
          : entries.find((_, index) => fixture.entries[index]?.id === checkpoint.accepted_entry_id)
              ?.record_hash
      expect(view.cells[0]?.accepted_head).toBe(expectedHash)
    }

    expect(
      taskIdsVisibleToAgent(entries, fixture.workspace_id, fixture.receiving_agent_id),
    ).toEqual(fixture.expected_receiving_agent_task_ids)
    const receivingView = projectOperatingView(entries, {
      workspace_id: fixture.workspace_id,
      agent_id: fixture.receiving_agent_id,
    })
    expect(receivingView.activity.map((entry) => entry.record_hash)).toEqual(
      fixture.expected_receiving_agent_entry_ids.map(
        (id) => entries[fixture.entries.findIndex((entry) => entry.id === id)]!.record_hash,
      ),
    )
  })
})
