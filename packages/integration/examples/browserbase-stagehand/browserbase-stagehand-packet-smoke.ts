// SPDX-License-Identifier: Apache-2.0

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { hashText, runWrappedMcpPacket, writeJson } from '../wrapped-mcp-proof-runner.js'
import {
  BROWSERBASE_ACTION_POLICY_EVENT_TYPE,
  BROWSERBASE_ACTION_POLICY_VERSION,
  browserbaseAllowedOrigins,
  createBrowserbaseActionPolicyGate,
  normalizeBrowserbaseActionPolicyMode,
  type BrowserbaseActionPolicyMode,
} from './action-policy.js'

const PRIVATE_SESSION_ID = 'bb_session_private_20260623'
const PRIVATE_REPLAY_URL = 'https://browserbase.example.invalid/sessions/private-replay-20260623'
const PRIVATE_SELECTOR = '#private-checkout-control'
const PRIVATE_FORM_VALUE = 'private browserbase note'
const PRIVATE_PAGE_SNAPSHOT =
  '<html><body><button id="private-checkout-control">Ship</button></body></html>'
const PRIVATE_EXTRACTED_TEXT =
  'Internal quote: private browserbase note. Account tier: confidential.'
const FIXTURE_PROOF_URL = 'https://example.invalid/vendor-quote'

type PacketOptions = Parameters<typeof runWrappedMcpPacket>[0]

export type BrowserbaseStagehandPacketOptions = {
  env?: NodeJS.ProcessEnv
  liveMode?: boolean
  publicLog?: boolean
  proofUrl?: string
  observeInstruction?: string
  actAction?: string
  extractInstruction?: string
  actionPolicyMode?: BrowserbaseActionPolicyMode
  allowedOrigins?: string[]
  timeoutMs?: number
  onToolResult?: PacketOptions['onToolResult']
  holdBeforeEndMs?: number
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

function positiveMs(value: number | undefined): number | undefined {
  if (!Number.isFinite(value)) return undefined
  return value && value > 0 ? Math.trunc(value) : undefined
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
  const policyRows = result.action_policy
    ? result.action_policy.decisions
        .map((decision) => {
          const outcome = result.action_policy?.outcomes.find(
            (candidate) => candidate.tool_name === decision.tool_name,
          )
          return `| ${decision.tool_name} | ${String(decision.content.decision)} | ${decision.record_hash} | ${decision.proof.log_index} | ${outcome?.record_hash ?? 'missing'} | ${outcome?.proof.log_index ?? 'missing'} |`
        })
        .join('\n')
    : ''
  const policySection = result.action_policy
    ? `
## Action policy gate

The runner evaluates \`${BROWSERBASE_ACTION_POLICY_VERSION}\` before \`act\`. The decision
record is signed before the Browserbase tool call. If the decision is \`block\`
or \`escalate\`, the runner stops before \`act\` and closes the session with
\`end\` when possible.

| Tool | Decision | Decision record | Decision index | Outcome record | Outcome index |
| --- | --- | --- | --- | --- | --- |
${policyRows}

- Policy event type: \`${BROWSERBASE_ACTION_POLICY_EVENT_TYPE}\`
- Stopped before: ${result.action_policy.stopped_before ?? 'none'}
- Blocked tool executed: ${String(result.action_policy.blocked_tool_executed)}
`
    : ''

  const upstreamLine =
    result.mode === 'live' && result.upstream_shape.includes('hosted')
      ? 'Browserbase hosted Streamable HTTP MCP endpoint.'
      : result.mode === 'live'
        ? 'Browserbase MCP self-hosted server launched with `npx -y @browserbasehq/mcp`.'
        : 'Browserbase MCP tool names, backed by a deterministic local fixture.'
  const weakness =
    result.mode === 'live'
      ? 'This proof run signs the wrapper path, record chain, hash-only disclosure, public log inclusion, verifier path, and real Browserbase MCP command path. It still keeps Browserbase Live View and replay material private. Hosted Browserbase MCP can return temporary model-capacity errors; public publication starts only after the full six-step flow verifies.'
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
- Control path: ${result.action_policy ? `\`${BROWSERBASE_ACTION_POLICY_VERSION}\` signs the \`act\` decision and outcome before the Browserbase action runs.` : 'not enabled for this artifact.'}
- Record policy: public records keep tool names plus \`args_hash\` and \`result_hash\`.
- Verification: \`@atrib/mcp\` verifies each Ed25519 record signature after the wrapper writes its mirror.
- Log proof: ${result.log.mode === 'public' ? `accepted records were submitted to \`${result.log.endpoint}\` after full-flow verification; inclusion was verified.` : 'local fixture log only.'}
- Publish policy: \`${result.log.publish_policy}\`

## Public record refs

| Tool | Record hash | ${logLabel} |
| --- | --- | --- |
${rows}

${publicLinks}
${policySection}
## Redaction line

The wrapper saw private Browserbase-shaped payloads: session id, replay URL, page snapshot, selector, form value, and extracted page text. The action policy also saw target/action/observed-state inputs. The public artifact stores only hashes for those fields. See \`redaction-manifest.json\`.

## Weakness

${weakness}

## Demo boundary

This is a fixed proof artifact plus a rerunnable local command. The resettable
demo server lives in
\`packages/integration/examples/browserbase-stagehand/live-demo/\`. It serves an
agent-ready WebMCP target app at \`/target\` and a proof console at \`/\`.
Deployment is a human gate. Do not share a hosted URL until demo-only
credentials and rate limits are in place.

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
  const policyTargetUrl = liveMode ? proofUrl : FIXTURE_PROOF_URL
  const actionPolicyMode = normalizeBrowserbaseActionPolicyMode(
    options.actionPolicyMode ?? env.ATRIB_BROWSERBASE_ACTION_POLICY,
  )
  const allowedOrigins = options.allowedOrigins ?? browserbaseAllowedOrigins(env, policyTargetUrl)
  const holdBeforeEndMs = positiveMs(options.holdBeforeEndMs)
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
    onToolResult: options.onToolResult,
    controlEventType: BROWSERBASE_ACTION_POLICY_EVENT_TYPE,
    policyGate: createBrowserbaseActionPolicyGate({
      mode: actionPolicyMode,
      targetUrl: policyTargetUrl,
      action: actAction,
      allowedOrigins,
    }),
    calls: liveMode
      ? [
          { name: 'start' },
          { name: 'navigate', arguments: { url: proofUrl } },
          { name: 'observe', arguments: { instruction: observeInstruction } },
          { name: 'act', arguments: { action: actAction } },
          {
            name: 'extract',
            arguments: { instruction: extractInstruction },
            ...(holdBeforeEndMs ? { delayAfterMs: holdBeforeEndMs } : {}),
          },
          { name: 'end' },
        ]
      : [
          { name: 'start', expectText: 'started' },
          {
            name: 'navigate',
            arguments: { url: FIXTURE_PROOF_URL },
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
  packetOptions.cleanupOnFailure = { name: 'end', afterTool: 'start' }
  if (liveMode) {
    packetOptions.upstream = browserbaseUpstream(liveHosted, env)
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
    action_policy: result.action_policy ?? null,
    log: result.log,
    verifier: result.verifier,
    privacy: result.privacy,
    caveats: [
      result.mode === 'live'
        ? 'Live Browserbase MCP command path. Browserbase replay material remains private.'
        : 'Fixture run only. It does not prove Browserbase cloud session replay.',
      'Private Browserbase session and page material are represented by hashes only.',
      `Action policy decisions use ${BROWSERBASE_ACTION_POLICY_VERSION} and are exported as signed policy records.`,
    ],
  }

  const redactionManifest = {
    schema: 'atrib.proof_packet.redaction_manifest.v1',
    packet: result.packet,
    action_policy: result.action_policy
      ? {
          event_type: BROWSERBASE_ACTION_POLICY_EVENT_TYPE,
          decisions: result.action_policy.decisions.map((decision) => ({
            decision: decision.content.decision,
            record_hash: decision.record_hash,
            reason_codes: decision.content.reason_codes,
            observed_record_hash: decision.content.observed_record_hash,
          })),
          outcomes: result.action_policy.outcomes.map((outcome) => ({
            decision: outcome.content.decision,
            executed: outcome.content.executed,
            record_hash: outcome.record_hash,
          })),
          stopped_before: result.action_policy.stopped_before,
          blocked_tool_executed: result.action_policy.blocked_tool_executed,
        }
      : null,
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
