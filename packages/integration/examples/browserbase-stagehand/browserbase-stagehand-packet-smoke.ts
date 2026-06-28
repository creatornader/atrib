// SPDX-License-Identifier: Apache-2.0

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  hashText,
  runWrappedMcpPacket,
  writeJson,
  type PacketActionGateOptions,
} from '../wrapped-mcp-proof-runner.js'

const PRIVATE_SESSION_ID = 'bb_session_private_20260623'
const PRIVATE_REPLAY_URL = 'https://browserbase.example.invalid/sessions/private-replay-20260623'
const PRIVATE_SELECTOR = '#private-checkout-control'
const PRIVATE_FORM_VALUE = 'private browserbase note'
const PRIVATE_PAGE_SNAPSHOT =
  '<html><body><button id="private-checkout-control">Ship</button></body></html>'
const PRIVATE_EXTRACTED_TEXT =
  'Internal quote: private browserbase note. Account tier: confidential.'

type PacketOptions = Parameters<typeof runWrappedMcpPacket>[0]

export type BrowserbaseStagehandPacketOptions = {
  env?: NodeJS.ProcessEnv
  liveMode?: boolean
  publicLog?: boolean
  proofUrl?: string
  observeInstruction?: string
  actAction?: string
  extractInstruction?: string
  timeoutMs?: number
  actionGate?: boolean
}

function requiredEnv(name: string, env: NodeJS.ProcessEnv): string {
  const value = env[name]
  if (!value) throw new Error(`${name} is required for ATRIB_BROWSERBASE_STAGEHAND_LIVE=1`)
  return value
}

function liveMaxAttempts(env: NodeJS.ProcessEnv): number {
  const parsed = Number(env.ATRIB_BROWSERBASE_LIVE_MAX_ATTEMPTS ?? '3')
  if (!Number.isFinite(parsed)) return 3
  return Math.max(1, Math.min(5, Math.trunc(parsed)))
}

function retryDelayMs(attempt: number): number {
  return Math.min(2500, 500 * attempt)
}

function isTransientBrowserbaseError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  if (!message.includes('upstream returned an error')) return false
  const lower = message.toLowerCase()
  return [
    'high demand',
    'capacity',
    'temporarily',
    'try again',
    'rate limit',
    'quota',
    '429',
    '503',
    'overloaded',
  ].some((marker) => lower.includes(marker))
}

async function runBrowserbasePacketWithRetry(
  options: PacketOptions,
  liveMode: boolean,
  env: NodeJS.ProcessEnv,
): Promise<Awaited<ReturnType<typeof runWrappedMcpPacket>>> {
  const attempts = liveMode ? liveMaxAttempts(env) : 1
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await runWrappedMcpPacket(options)
    } catch (error) {
      if (attempt >= attempts || !isTransientBrowserbaseError(error)) throw error
      console.error(
        `Browserbase live attempt ${attempt}/${attempts} failed with a transient upstream error; retrying.`,
      )
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs(attempt)))
    }
  }
  throw new Error('unreachable Browserbase retry state')
}

function artifactDir(integrationDir: string, env: NodeJS.ProcessEnv): string | undefined {
  if (env.ATRIB_PACKET_OUT_DIR) return env.ATRIB_PACKET_OUT_DIR
  if (env.ATRIB_PACKET_WRITE_ARTIFACTS === '1') {
    return join(integrationDir, '..', '..', 'proof-packets', 'browserbase-stagehand')
  }
  return undefined
}

function browserbaseMcpArgs(env: NodeJS.ProcessEnv): string[] {
  const args = ['-y', '@browserbasehq/mcp']
  const modelName = env.ATRIB_BROWSERBASE_MODEL_NAME
  if (modelName) args.push('--modelName', modelName)
  return args
}

function useHostedBrowserbaseMcp(env: NodeJS.ProcessEnv): boolean {
  return env.ATRIB_BROWSERBASE_UPSTREAM === 'hosted'
}

function browserbaseHostedMcpUrl(env: NodeJS.ProcessEnv): string {
  const url = new URL('https://mcp.browserbase.com/mcp')
  url.searchParams.set('browserbaseApiKey', requiredEnv('BROWSERBASE_API_KEY', env))
  return url.toString()
}

function browserbaseUpstream(liveHosted: boolean, env: NodeJS.ProcessEnv) {
  if (liveHosted) {
    return {
      type: 'http' as const,
      url: browserbaseHostedMcpUrl(env),
    }
  }
  return {
    command: 'npx',
    args: browserbaseMcpArgs(env),
    env: {
      BROWSERBASE_API_KEY: requiredEnv('BROWSERBASE_API_KEY', env),
      BROWSERBASE_PROJECT_ID: requiredEnv('BROWSERBASE_PROJECT_ID', env),
      GEMINI_API_KEY: requiredEnv('GEMINI_API_KEY', env),
    },
  }
}

function actionGateContextId(): string {
  return hashText('browserbase-stagehand-action-gate').slice('sha256:'.length, 'sha256:'.length + 32)
}

function browserbaseActionGate(mode: 'fixture' | 'live'): PacketActionGateOptions {
  return {
    privateKey: new Uint8Array(32).fill(31),
    contextId: actionGateContextId(),
    runId: `browserbase-stagehand-${mode}`,
    agentId: 'browserbase-stagehand-proof',
    surface: 'browser',
    toolNames: ['act'],
    risk: () => ['browser_action', 'external_write', 'stagehand_act'],
    refs: () => ({
      packet: 'browserbase-stagehand',
      automation_layer: 'browserbase-stagehand',
      control_layer: '@atrib/action-gate',
      mode,
    }),
    policy: () => ({
      outcome: 'allow',
      policy_id: 'browserbase-stagehand-action-policy',
      policy_version: '2026-06-28.1',
      reason: 'Stagehand act is allowed for this proof after a signed pre-action decision.',
      authority: { mode: 'host-policy' },
      approval: { required: false },
      evidence: {
        automation_layer: 'browserbase-stagehand',
        control_layer: '@atrib/action-gate',
      },
    }),
  }
}

function renderReadme(result: Awaited<ReturnType<typeof runWrappedMcpPacket>>): string {
  const logLabel = result.log.mode === 'public' ? 'Public log index' : 'Local log index'
  const representativeHash = result.record_hashes[0]
  const representativeHex = representativeHash?.replace('sha256:', '')
  const publicLinks =
    result.log.mode === 'public' && representativeHash && representativeHex
      ? `
Representative public links:

- Explorer: <https://explore.atrib.dev/action/${representativeHash}>
- Log proof: <https://log.atrib.dev/v1/proof/${representativeHex}>
`
      : ''
  const rows = result.operations
    .map(
      (operation, index) =>
        `| ${operation} | ${result.record_hashes[index] ?? 'missing'} | ${result.log_indexes[index] ?? 'missing'} |`,
    )
    .join('\n')
  const actionGateRows = result.action_gate?.gated_actions
    .map(
      (action) =>
        `| ${action.tool_name} | ${action.state} | ${action.decision_record_hash} | ${action.outcome_record_hash} | ${action.verification_valid ? 'yes' : 'no'} |`,
    )
    .join('\n')
  const actionGateSection = actionGateRows
    ? `
## Action Gate

\`@atrib/action-gate\` evaluated the high-impact \`act\` step before the Browserbase
automation call ran. Browserbase still owns browser execution. Atrib signs the
control decision and the outcome as separate extension records.

| Tool | Decision | Decision record | Outcome record | Verified |
| --- | --- | --- | --- | --- |
${actionGateRows}
`
    : `
## Action Gate

This packet was generated without the optional \`@atrib/action-gate\` wrapper.
Set \`ATRIB_BROWSERBASE_ACTION_GATE=1\` to sign a pre-action decision and outcome
around the \`act\` step.
`

  const upstreamLine =
    result.mode === 'live' && result.upstream_shape.includes('hosted')
      ? 'Browserbase hosted Streamable HTTP MCP endpoint.'
      : result.mode === 'live'
        ? 'Browserbase MCP self-hosted server launched with `npx -y @browserbasehq/mcp`.'
        : 'Browserbase MCP tool names, backed by a deterministic local fixture.'
  const weakness =
    result.mode === 'live'
      ? 'This proof run signs the wrapper path, record chain, hash-only disclosure, public log inclusion, verifier path, and real Browserbase MCP command path. It still keeps Browserbase replay material private. Hosted Browserbase MCP can return temporary model-capacity errors; public publication starts only after the full six-step flow verifies.'
      : 'The fixture path checks the wrapper, record chain, hash-only disclosure, and verifier path for the Browserbase MCP shape. It does not prove a Browserbase cloud replay. A hosted live run needs `BROWSERBASE_API_KEY`; a self-hosted live run also needs `BROWSERBASE_PROJECT_ID` and a model key for `npx -y @browserbasehq/mcp`.'
  const atribPath =
    result.mode === 'live' && result.upstream_shape.includes('hosted')
      ? '`@atrib/mcp-wrap` around a hosted Streamable HTTP MCP upstream.'
      : '`@atrib/mcp-wrap` around an MCP stdio server.'

  return `# Browserbase Stagehand proof artifact

This proof signs a Browserbase MCP shaped browser session through \`@atrib/mcp-wrap\`.

## Action path

\`start -> navigate -> observe -> act -> extract -> end\`

## What ran

- Upstream surface: ${upstreamLine}
- Atrib path: ${atribPath}
- Control path: ${result.action_gate?.enabled ? '`@atrib/action-gate` signs the `act` decision and outcome before the Browserbase action runs.' : 'not enabled for this artifact.'}
- Record policy: public records keep tool names plus \`args_hash\` and \`result_hash\`.
- Verification: \`@atrib/mcp\` verifies each Ed25519 record signature after the wrapper writes its mirror.
- Log proof: ${result.log.mode === 'public' ? `accepted records were submitted to \`${result.log.endpoint}\` after full-flow verification; inclusion was verified.` : 'local fixture log only.'}
- Publish policy: \`${result.log.publish_policy}\`

## Public record refs

| Tool | Record hash | ${logLabel} |
| --- | --- | --- |
${rows}

${publicLinks}
${actionGateSection}
## Redaction line

The wrapper saw private Browserbase-shaped payloads: session id, replay URL, page snapshot, selector, form value, and extracted page text. The public artifact stores only hashes for those fields. See \`redaction-manifest.json\`.

## Weakness

${weakness}

## Demo boundary

This is a fixed proof artifact plus a rerunnable local command. The resettable
demo server lives in
\`packages/integration/examples/browserbase-stagehand/live-demo/\`. Deployment is
a human gate. Do not share a hosted URL until demo-only credentials and rate
limits are in place.

## Regenerate

\`\`\`bash
ATRIB_BROWSERBASE_STAGEHAND_LIVE=1 \\
ATRIB_BROWSERBASE_UPSTREAM=hosted \\
ATRIB_PACKET_PUBLIC_LOG=1 \\
BROWSERBASE_API_KEY=... \\
ATRIB_PACKET_WRITE_ARTIFACTS=1 \\
  pnpm --filter @atrib/integration browserbase-stagehand-packet
\`\`\`

## Self-hosted STDIO variant

\`\`\`bash
ATRIB_BROWSERBASE_STAGEHAND_LIVE=1 \\
ATRIB_PACKET_PUBLIC_LOG=1 \\
BROWSERBASE_API_KEY=... \\
BROWSERBASE_PROJECT_ID=... \\
GEMINI_API_KEY=... \\
ATRIB_PACKET_WRITE_ARTIFACTS=1 \\
  pnpm --filter @atrib/integration browserbase-stagehand-packet
\`\`\`
`
}

export async function runBrowserbaseStagehandPacket(
  options: BrowserbaseStagehandPacketOptions = {},
): Promise<Awaited<ReturnType<typeof runWrappedMcpPacket>>> {
  const env = options.env ?? process.env
  const exampleDir = dirname(fileURLToPath(import.meta.url))
  const integrationDir = dirname(dirname(exampleDir))
  const liveMode = options.liveMode ?? env.ATRIB_BROWSERBASE_STAGEHAND_LIVE === '1'
  const liveHosted = liveMode && useHostedBrowserbaseMcp(env)
  const publicLog = options.publicLog ?? (liveMode && env.ATRIB_PACKET_PUBLIC_LOG !== '0')
  const actionGateEnabled = options.actionGate ?? env.ATRIB_BROWSERBASE_ACTION_GATE === '1'
  const proofUrl = options.proofUrl ?? env.ATRIB_BROWSERBASE_PROOF_URL ?? 'https://example.com'
  const observeInstruction =
    options.observeInstruction ??
    env.ATRIB_BROWSERBASE_OBSERVE_INSTRUCTION ??
    'Find the More information link'
  const actAction =
    options.actAction ?? env.ATRIB_BROWSERBASE_ACT_ACTION ?? 'Click the More information link'
  const extractInstruction =
    options.extractInstruction ??
    env.ATRIB_BROWSERBASE_EXTRACT_INSTRUCTION ??
    'Extract the page title and current URL'
  const packetOptions: PacketOptions = {
    packet: 'browserbase-stagehand',
    mode: liveMode ? 'live' : 'fixture',
    logMode: publicLog ? 'public' : 'local',
    upstreamShape:
      liveMode && liveHosted
        ? 'Browserbase hosted Streamable HTTP MCP endpoint at https://mcp.browserbase.com/mcp'
        : liveMode
          ? 'Browserbase MCP self-hosted stdio server launched with npx -y @browserbasehq/mcp'
          : 'Browserbase MCP self-hosted stdio server tools start, navigate, observe, act, extract, end',
    exampleDir,
    integrationDir,
    expectedTools: ['start', 'navigate', 'observe', 'act', 'extract', 'end'],
    calls: liveMode
      ? [
          { name: 'start' },
          { name: 'navigate', arguments: { url: proofUrl } },
          { name: 'observe', arguments: { instruction: observeInstruction } },
          { name: 'act', arguments: { action: actAction } },
          { name: 'extract', arguments: { instruction: extractInstruction } },
          { name: 'end' },
        ]
      : [
          { name: 'start', expectText: 'started' },
          {
            name: 'navigate',
            arguments: { url: 'https://example.invalid/vendor-quote' },
            expectText: 'navigated',
          },
          {
            name: 'observe',
            arguments: { instruction: 'Find the submit quote button' },
            expectText: 'observed',
          },
          {
            name: 'act',
            arguments: { action: 'Click the submit quote button' },
            expectText: 'acted',
          },
          {
            name: 'extract',
            arguments: { instruction: 'Extract the confirmation id and vendor name' },
            expectText: 'browserbase-stagehand-proof-001',
          },
          { name: 'end', expectText: 'ended' },
        ],
    privateNeedles: liveMode
      ? [
          proofUrl,
          observeInstruction,
          actAction,
          extractInstruction,
          env.BROWSERBASE_API_KEY ?? '',
          env.BROWSERBASE_PROJECT_ID ?? '',
          env.GEMINI_API_KEY ?? '',
        ]
      : [
          PRIVATE_SESSION_ID,
          PRIVATE_REPLAY_URL,
          PRIVATE_SELECTOR,
          PRIVATE_FORM_VALUE,
          PRIVATE_PAGE_SNAPSHOT,
          PRIVATE_EXTRACTED_TEXT,
        ],
  }
  if (env.ATRIB_PACKET_PUBLIC_LOG_ENDPOINT) {
    packetOptions.publicLogEndpoint = env.ATRIB_PACKET_PUBLIC_LOG_ENDPOINT
  }
  if (options.timeoutMs) {
    packetOptions.timeoutMs = options.timeoutMs
  }
  if (actionGateEnabled) {
    packetOptions.actionGate = browserbaseActionGate(liveMode ? 'live' : 'fixture')
  }
  if (liveMode) {
    packetOptions.upstream = browserbaseUpstream(liveHosted, env)
    packetOptions.cleanupOnFailure = { name: 'end', afterTool: 'start' }
  } else {
    packetOptions.fixtureServer = join(exampleDir, 'browserbase-fixture-mcp.ts')
  }

  return runBrowserbasePacketWithRetry(packetOptions, liveMode, env)
}

function writeBrowserbaseStagehandArtifacts(input: {
  result: Awaited<ReturnType<typeof runWrappedMcpPacket>>
  env: NodeJS.ProcessEnv
}): string | undefined {
  const exampleDir = dirname(fileURLToPath(import.meta.url))
  const integrationDir = dirname(dirname(exampleDir))
  const liveMode = input.result.mode === 'live'
  const proofUrl = input.env.ATRIB_BROWSERBASE_PROOF_URL ?? 'https://example.com'
  const observeInstruction =
    input.env.ATRIB_BROWSERBASE_OBSERVE_INSTRUCTION ?? 'Find the More information link'
  const actAction = input.env.ATRIB_BROWSERBASE_ACT_ACTION ?? 'Click the More information link'
  const extractInstruction =
    input.env.ATRIB_BROWSERBASE_EXTRACT_INSTRUCTION ?? 'Extract the page title and current URL'
  const result = input.result

  const verifierOutput = {
    schema: 'atrib.proof_packet.verifier_output.v1',
    packet: result.packet,
    mode: result.mode,
    live_upstream: result.mode === 'live',
    upstream_shape: result.upstream_shape,
    operations: result.operations,
    records: result.operations.map((tool_name, index) => ({
      tool_name,
      record_hash: result.record_hashes[index],
      log_index: result.log_indexes[index],
      proof: result.log.proofs[index],
    })),
    log: result.log,
    verifier: result.verifier,
    privacy: result.privacy,
    action_gate: result.action_gate ?? null,
    caveats: [
      result.mode === 'live'
        ? 'Live Browserbase MCP command path. Browserbase replay material remains private.'
        : 'Fixture run only. It does not prove Browserbase cloud session replay.',
      'Private Browserbase session and page material are represented by hashes only.',
    ],
  }

  const redactionManifest = {
    schema: 'atrib.proof_packet.redaction_manifest.v1',
    packet: result.packet,
    private_fields: liveMode
      ? [
          { field: 'target_url', disclosure: 'hash-only', hash: hashText(proofUrl) },
          {
            field: 'observe_instruction',
            disclosure: 'hash-only',
            hash: hashText(observeInstruction),
          },
          { field: 'act_action', disclosure: 'hash-only', hash: hashText(actAction) },
          {
            field: 'extract_instruction',
            disclosure: 'hash-only',
            hash: hashText(extractInstruction),
          },
          { field: 'browserbase_session_or_replay_url', disclosure: 'redacted-ref' },
          { field: 'page_snapshot', disclosure: 'result-hash-only' },
          { field: 'selectors', disclosure: 'result-hash-only' },
        ]
      : [
          {
            field: 'browserbase_session_id',
            disclosure: 'hash-only',
            hash: hashText(PRIVATE_SESSION_ID),
          },
          {
            field: 'browserbase_replay_url',
            disclosure: 'hash-only',
            hash: hashText(PRIVATE_REPLAY_URL),
          },
          {
            field: 'page_snapshot',
            disclosure: 'hash-only',
            hash: hashText(PRIVATE_PAGE_SNAPSHOT),
          },
          { field: 'selector', disclosure: 'hash-only', hash: hashText(PRIVATE_SELECTOR) },
          { field: 'form_value', disclosure: 'hash-only', hash: hashText(PRIVATE_FORM_VALUE) },
          {
            field: 'extracted_page_text',
            disclosure: 'hash-only',
            hash: hashText(PRIVATE_EXTRACTED_TEXT),
          },
        ],
  }

  const outDir = artifactDir(integrationDir, input.env)
  if (outDir) {
    mkdirSync(outDir, { recursive: true })
    writeFileSync(join(outDir, 'README.md'), renderReadme(result))
    writeJson(join(outDir, 'verifier-output.json'), verifierOutput)
    writeJson(join(outDir, 'redaction-manifest.json'), redactionManifest)
  }
  return outDir
}

async function main(): Promise<void> {
  const result = await runBrowserbaseStagehandPacket()
  const outDir = writeBrowserbaseStagehandArtifacts({ result, env: process.env })
  console.log(JSON.stringify({ ...result, artifact_dir: outDir ?? null }, null, 2))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
  })
}
