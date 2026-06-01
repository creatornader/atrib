// SPDX-License-Identifier: Apache-2.0

import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { BetaLocalFilesystemMemoryTool } from '@anthropic-ai/sdk/tools/memory/node'
import { verifyRecord } from '@atrib/mcp'
import { createAtribMemoryTool } from '../src/index.js'
import type { AtribRecord } from '@atrib/mcp'

const privateKey = new Uint8Array(32).fill(42)
const contextId = '4bf92f3577b34da6a3ce929d0e0e4736'

const root = await mkdtemp(join(tmpdir(), 'atrib-memory-tool-'))
const records: AtribRecord[] = []

try {
  const fsMemory = await BetaLocalFilesystemMemoryTool.init(root)
  const memory = await createAtribMemoryTool(fsMemory, {
    privateKey,
    contextId,
    logSubmission: 'disabled',
    signReads: true,
    onRecord: (record) => records.push(record),
  })

  await memory.create({
    command: 'create',
    path: '/memories/preferences.txt',
    file_text: 'timezone=America/Chicago\nstatus=active\n',
  })
  await memory.str_replace({
    command: 'str_replace',
    path: '/memories/preferences.txt',
    old_str: 'status=active',
    new_str: 'status=verified',
  })
  await memory.view({
    command: 'view',
    path: '/memories/preferences.txt',
  })
  await memory.delete({
    command: 'delete',
    path: '/memories/preferences.txt',
  })

  const invalid = []
  for (const record of records) {
    if (!(await verifyRecord(record))) invalid.push(record.tool_name)
  }
  if (invalid.length > 0) {
    throw new Error(`invalid signed record(s): ${invalid.join(', ')}`)
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        commands: records.map((record) => record.tool_name),
        context_id: contextId,
        signed_records: records.length,
        last_record_hash: memory.getLastRecordHash(),
      },
      null,
      2,
    ),
  )
} finally {
  await rm(root, { force: true, recursive: true })
}
