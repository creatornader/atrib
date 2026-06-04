// SPDX-License-Identifier: Apache-2.0

import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import canonicalize from 'canonicalize'
import {
  base64urlEncode,
  canonicalRecord,
  computeContentId,
  EVENT_TYPE_TOOL_CALL_URI,
  getPublicKey,
  hexEncode,
  resolveChainRoot,
  sha256,
  signRecord,
  verifyRecord,
} from '@atrib/mcp'
import type { AtribRecord } from '@atrib/mcp'

type GoogleAdkPythonEvent = {
  index: number
  operation: 'after_tool_callback'
  tool_name: string
  function_call_id?: string | null
  invocation_id?: string | null
  agent_name?: string | null
  user_id?: string | null
  args: unknown
  result: unknown
}

type GoogleAdkPythonProof = {
  ok: true
  google_adk_version: string
  runtime: {
    runner: 'InMemoryRunner'
    plugin: 'BasePlugin'
    tool: 'FunctionTool'
    model: 'BaseLlm'
  }
  session: {
    app_name: string
    user_id: string
    session_id: string
  }
  events: GoogleAdkPythonEvent[]
  summary: {
    yielded_events: number
    function_call_events: number
    function_response_events: number
    final_text: string
    plugin_event_count: number
    private_phrase_in_plugin_events: boolean
  }
}

type SmokeResult = {
  ok: true
  note: string
  google_adk_python: {
    python_package: 'google-adk'
    version: string
    runner: 'InMemoryRunner'
    plugin: 'BasePlugin'
    tool: 'FunctionTool'
    model: 'BaseLlm'
    transient_python_packages: ['google-adk==2.1.0']
  }
  context_id: string
  signed_records: number
  operations: string[]
  record_hashes: string[]
  event_counts: GoogleAdkPythonProof['summary']
  chain: {
    first_record_is_genesis: boolean
    subsequent_records_chain: boolean
    subsequent_records_inform_by_previous: boolean
  }
  final_text: string
  privacy: {
    public_records_hash_only: true
    local_sidecars_keep_payloads: true
  }
  caveats: string[]
}

const privateKey = Buffer.from(
  '435465768798a9bacbdcedfeef102132435465768798a9bacbdcedfeef102132',
  'hex',
)
const contextId = '676f6f676c652d61646b2d70792d3031'
const serverUrl = 'google-adk-python://runner-plugin'
const privatePhrase = 'quiet ADK Python tool note'
const baseTimestamp = 1_779_842_000_000

export async function runGoogleAdkPythonPluginSmoke(): Promise<SmokeResult> {
  const proof = runPythonProof()
  const creatorKey = base64urlEncode(await getPublicKey(privateKey))
  const records: AtribRecord[] = []
  const sidecars: Array<{
    framework: 'google-adk-python'
    runtime: GoogleAdkPythonProof['runtime']
    session: GoogleAdkPythonProof['session']
    event: GoogleAdkPythonEvent
    operation: string
    record_hash: string
  }> = []
  let lastRecordHashHex: string | undefined
  let lastRecordHash: string | undefined

  for (const event of proof.events) {
    const operation = `google.adk.python.tool.${event.tool_name}`
    const record: AtribRecord = {
      spec_version: 'atrib/1.0',
      content_id: computeContentId(serverUrl, operation),
      creator_key: creatorKey,
      chain_root: resolveChainRoot({
        contextId,
        autoChainTailHex: lastRecordHashHex,
      }),
      event_type: EVENT_TYPE_TOOL_CALL_URI,
      context_id: contextId,
      timestamp: baseTimestamp + event.index,
      signature: '',
      args_hash: hashCanonical({
        package: 'google-adk',
        package_version: proof.google_adk_version,
        runtime: proof.runtime,
        session: proof.session,
        tool_name: event.tool_name,
        agent_name: event.agent_name,
        user_id: event.user_id,
        args: event.args,
      }),
      result_hash: hashCanonical({
        operation: event.operation,
        tool_name: event.tool_name,
        result: event.result,
      }),
      tool_name: operation,
      ...(lastRecordHash ? { informed_by: [lastRecordHash] } : {}),
    }
    const signed = await signRecord(record, privateKey)
    const recordHashHex = hexEncode(sha256(canonicalRecord(signed)))
    const recordHash = `sha256:${recordHashHex}`
    lastRecordHashHex = recordHashHex
    lastRecordHash = recordHash
    records.push(signed)
    sidecars.push({
      framework: 'google-adk-python',
      runtime: proof.runtime,
      session: proof.session,
      event,
      operation,
      record_hash: recordHash,
    })
  }

  const invalid = []
  for (const record of records) {
    if (!(await verifyRecord(record))) invalid.push(record.tool_name)
  }
  if (invalid.length > 0) {
    throw new Error(`invalid signed record(s): ${invalid.join(', ')}`)
  }
  if (records.length !== 1) {
    throw new Error(`expected one signed Google ADK Python record, got ${records.length}`)
  }
  if (!proof.summary.private_phrase_in_plugin_events) {
    throw new Error('Google ADK Python plugin did not retain private material locally')
  }

  const publicRecordJson = JSON.stringify(records)
  if (publicRecordJson.includes(privatePhrase)) {
    throw new Error('public records leaked the private Google ADK Python payload')
  }
  if (!JSON.stringify(sidecars).includes(privatePhrase)) {
    throw new Error('local sidecars should keep inspectable Google ADK Python material')
  }

  const recordHashes = records.map(
    (record) => `sha256:${hexEncode(sha256(canonicalRecord(record)))}`,
  )
  const subsequentRecords = records.slice(1)

  return {
    ok: true,
    note: 'Runs a real google-adk Python InMemoryRunner with a BasePlugin tool callback, then signs one hash-only atrib record for the captured tool outcome.',
    google_adk_python: {
      python_package: 'google-adk',
      version: proof.google_adk_version,
      runner: proof.runtime.runner,
      plugin: proof.runtime.plugin,
      tool: proof.runtime.tool,
      model: proof.runtime.model,
      transient_python_packages: ['google-adk==2.1.0'],
    },
    context_id: contextId,
    signed_records: records.length,
    operations: records.map((record) => record.tool_name ?? ''),
    record_hashes: recordHashes,
    event_counts: proof.summary,
    chain: {
      first_record_is_genesis: records[0]?.chain_root === resolveChainRoot({ contextId }),
      subsequent_records_chain: subsequentRecords.every(
        (record, index) => record.chain_root === recordHashes[index],
      ),
      subsequent_records_inform_by_previous: subsequentRecords.every(
        (record, index) => record.informed_by?.[0] === recordHashes[index],
      ),
    },
    final_text: proof.summary.final_text,
    privacy: {
      public_records_hash_only: true,
      local_sidecars_keep_payloads: true,
    },
    caveats: [
      'This proves local google-adk Python InMemoryRunner plugin callbacks, not Agent Platform Runtime or Gemini Enterprise deployment.',
      'It signs the Python ADK tool callback boundary, not BigQuery Agent Analytics event export, Memory Bank, or trajectory evaluation.',
      'It does not prove upstream acceptance, maintainer interest, a hosted model call, or a production Google Cloud run.',
    ],
  }
}

function runPythonProof(): GoogleAdkPythonProof {
  const exampleDir = dirname(fileURLToPath(import.meta.url))
  const pythonScript = join(exampleDir, 'google-adk-python-proof.py')
  const result = spawnSync(
    'uv',
    ['run', '--quiet', '--with', 'google-adk==2.1.0', 'python', pythonScript],
    {
      cwd: exampleDir,
      env: { ...process.env, PYTHONWARNINGS: 'ignore' },
      encoding: 'utf8',
      maxBuffer: 1024 * 1024 * 10,
    },
  )

  if (result.status !== 0) {
    throw new Error(
      [
        'Google ADK Python proof failed.',
        'The smoke requires uv plus transient Python package google-adk==2.1.0.',
        'stdout:',
        result.stdout.trim(),
        'stderr:',
        result.stderr.trim(),
      ].join('\n'),
    )
  }

  const raw = result.stdout.trim()
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) {
    throw new Error(`Google ADK Python proof did not print JSON: ${result.stdout}`)
  }
  const parsed = JSON.parse(raw.slice(start, end + 1)) as GoogleAdkPythonProof
  if (!parsed.ok || parsed.events.length !== 1) {
    throw new Error(`unexpected Google ADK Python proof output: ${result.stdout}`)
  }
  return parsed
}

function hashCanonical(value: unknown): string {
  const encoded = canonicalize(value)
  if (!encoded) throw new Error('failed to canonicalize Google ADK Python material')
  return `sha256:${hexEncode(sha256(new TextEncoder().encode(encoded)))}`
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = await runGoogleAdkPythonPluginSmoke()
  console.log(JSON.stringify(result, null, 2))
}
