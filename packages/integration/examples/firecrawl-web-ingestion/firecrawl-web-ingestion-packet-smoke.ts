// SPDX-License-Identifier: Apache-2.0

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  hashText,
  runWrappedMcpPacket,
  type WrappedMcpPacketResult,
  writeJson,
} from '../wrapped-mcp-proof-runner.js'

const PRIVATE_QUERY = 'private acquisition research query'
const PRIVATE_URL = 'https://example.invalid/private-firecrawl-source'
const PRIVATE_MARKDOWN = '# Private vendor page\n\nConfidential pricing: private firecrawl text.'
const PRIVATE_HTML = '<main><h1>Private vendor page</h1><p>Confidential pricing</p></main>'
const PRIVATE_EXTRACT = 'private firecrawl extracted account note'
const PRIVATE_CRAWL_JOB_ID = 'crawl_private_job_20260623'
export const LIVE_DEFAULT_QUERY = 'site:example.com Example Domain'
export const LIVE_DEFAULT_URL = 'https://example.com'
export const LIVE_DEFAULT_EXTRACT_PROMPT =
  'Extract the organization name and a short account note from this public page.'

export const CRAWL_CAP = {
  maxDepth: 1,
  limit: 2,
} as const

type PolicyDecisionArtifact = ReturnType<typeof buildPolicyDecision>
type PacketOptions = Parameters<typeof runWrappedMcpPacket>[0]

export type FirecrawlWebIngestionPacketOptions = {
  env?: NodeJS.ProcessEnv
  liveMode?: boolean
  publicLog?: boolean
  query?: string
  sourceUrl?: string
  extractPrompt?: string
  timeoutMs?: number
  outDir?: string
  writeArtifacts?: boolean
}

export type FirecrawlWebIngestionPacketRun = {
  result: WrappedMcpPacketResult
  verifierOutput: unknown
  redactionManifest: unknown
  policyDecision: PolicyDecisionArtifact
  artifact_dir: string | null
}

function requiredFirecrawlEnv(envSource: NodeJS.ProcessEnv): Record<string, string> {
  const env: Record<string, string> = {}
  if (envSource.FIRECRAWL_API_KEY) env.FIRECRAWL_API_KEY = envSource.FIRECRAWL_API_KEY
  if (envSource.FIRECRAWL_API_URL) env.FIRECRAWL_API_URL = envSource.FIRECRAWL_API_URL
  if (!env.FIRECRAWL_API_KEY && !env.FIRECRAWL_API_URL) {
    throw new Error(
      'FIRECRAWL_API_KEY or FIRECRAWL_API_URL is required for ATRIB_FIRECRAWL_WEB_INGESTION_LIVE=1',
    )
  }
  return env
}

function artifactDir(
  integrationDir: string,
  env: NodeJS.ProcessEnv,
  options: FirecrawlWebIngestionPacketOptions,
): string | undefined {
  if (options.outDir) return options.outDir
  if (env.ATRIB_PACKET_OUT_DIR) return env.ATRIB_PACKET_OUT_DIR
  if (options.writeArtifacts || env.ATRIB_PACKET_WRITE_ARTIFACTS === '1') {
    return join(integrationDir, '..', '..', 'proof-packets', 'firecrawl-web-ingestion')
  }
  return undefined
}

function stableJsonHash(value: unknown): string {
  return hashText(JSON.stringify(value))
}

function buildPolicyDecision(result: WrappedMcpPacketResult) {
  const base = {
    schema: 'atrib.proof_packet.policy_decision.v1',
    packet: result.packet,
    mode: result.mode,
    evaluator: 'firecrawl-ingestion-policy-v0',
    decision: 'escalate_before_customer_email',
    decision_status: 'review_required',
    proposed_next_action: {
      action_type: 'customer_email',
      description: 'Use web-ingested content in an outbound customer message.',
      risk_class: 'external_customer_message',
    },
    inputs: {
      operation_order: result.operations,
      record_hashes: result.record_hashes,
      log_indexes: result.log_indexes,
      log_mode: result.log.mode,
      log_endpoint: result.log.endpoint,
      crawl_cap: CRAWL_CAP,
      verifier: result.verifier,
      privacy: result.privacy,
    },
    rule_results: [
      {
        id: 'signed_ingestion_records_present',
        outcome: result.verifier.record_valid ? 'pass' : 'fail',
        evidence: `${result.signed_records} verified Firecrawl tool-call records`,
      },
      {
        id: 'log_refs_present',
        outcome: result.log_indexes.length === result.signed_records ? 'pass' : 'fail',
        evidence:
          result.log.mode === 'public'
            ? 'public log indexes and inclusion proofs are present'
            : 'local capture log indexes are present for the fixture proof',
      },
      {
        id: 'bounded_crawl_cap_present',
        outcome: 'pass',
        evidence: `crawl cap maxDepth=${CRAWL_CAP.maxDepth}, limit=${CRAWL_CAP.limit}`,
      },
      {
        id: 'raw_web_content_private',
        outcome: result.privacy.public_records_hash_only ? 'pass' : 'fail',
        evidence: 'query, URL, scraped content, extracted text, and crawl job id stay private',
      },
      {
        id: 'customer_message_requires_review',
        outcome: 'escalate',
        evidence: 'untrusted web-ingested content would influence an outbound customer message',
      },
    ],
    allowed_without_review: ['internal_research_summary', 'source_triage'],
    escalated_actions: [
      'customer_email',
      'account_update',
      'refund_or_payment_change',
      'production_code_change',
      'vendor_procurement_action',
    ],
    public_fields: [
      'tool_names',
      'args_hash',
      'result_hash',
      'record_hashes',
      'log_indexes',
      'crawl_cap',
      'verifier_result',
      'policy_decision_hash',
    ],
    private_fields: [
      'raw_query',
      'source_url',
      'scraped_content',
      'extracted_page_text',
      'crawl_job_id',
      'auth_token',
    ],
    caveats: [
      'The policy decision artifact is deterministic and hash-bound to signed Firecrawl records.',
      'The policy decision artifact is not a signed atrib record yet.',
      'A live enforcement surface would still need to stop or route the downstream action at runtime.',
    ],
  }
  return {
    decision_hash: stableJsonHash(base),
    ...base,
  }
}

function renderReadme(
  result: WrappedMcpPacketResult,
  policyDecision: PolicyDecisionArtifact,
): string {
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

  const upstreamLine =
    result.mode === 'live'
      ? 'Firecrawl MCP server launched with `npx -y firecrawl-mcp`.'
      : 'Firecrawl MCP tool names, backed by a deterministic local fixture.'
  const weakness =
    result.mode === 'live'
      ? 'This proof run signs the wrapper path, record chain, hash-only disclosure, bounded crawl cap, public log inclusion, verifier path, and real Firecrawl MCP command path. Hosted Firecrawl content remains private.'
      : 'The fixture path checks the wrapper, record chain, hash-only disclosure, bounded crawl cap, and verifier path for the Firecrawl MCP shape. It does not prove a hosted Firecrawl API run. A live run needs `FIRECRAWL_API_KEY` or a self-hosted `FIRECRAWL_API_URL` for `npx -y firecrawl-mcp`.'

  return `# Firecrawl web ingestion proof artifact

This proof signs a Firecrawl MCP shaped ingestion flow through \`@atrib/mcp-wrap\`.

## Action path

\`firecrawl_search -> firecrawl_scrape -> firecrawl_extract -> firecrawl_crawl\`

The crawl step is capped to \`maxDepth: ${CRAWL_CAP.maxDepth}\` and \`limit: ${CRAWL_CAP.limit}\`.

## What ran

- Upstream surface: ${upstreamLine}
- Atrib path: \`@atrib/mcp-wrap\` around an MCP stdio server.
- Record policy: public records keep selected tool names plus \`args_hash\` and \`result_hash\`.
- Verification: \`@atrib/mcp\` verifies each Ed25519 record signature after the wrapper writes its mirror.
- Log proof: ${result.log.mode === 'public' ? `accepted records were submitted to \`${result.log.endpoint}\` after full-flow verification; inclusion was verified.` : 'local fixture log only.'}
- Publish policy: \`${result.log.publish_policy}\`

## Public record refs

| Tool | Record hash | ${logLabel} |
| --- | --- | --- |
${rows}

${publicLinks}
## Redaction line

The wrapper saw private Firecrawl-shaped payloads: query, URL, scraped Markdown, HTML, extracted text, and crawl job id. The public artifact stores only hashes for those fields. See \`redaction-manifest.json\`.

## Control-plane fit

Firecrawl is the untrusted web-ingestion boundary, not the sensitive downstream
action. This packet is meant to sit before a customer email, account update,
refund or payment change, production code change, or vendor workflow that
depends on web-derived context.

A verifier can see which ingestion tools ran, that the crawl was capped, that
records landed in the log, and that raw web content stayed private.

## Policy decision artifact

\`policy-decision.json\` models the next gate after ingestion:
\`${policyDecision.decision}\`. It binds to the signed Firecrawl records, log
indexes, crawl cap, verifier result, and redaction boundary.

Allowed without review: \`${policyDecision.allowed_without_review.join('`, `')}\`.

Escalated before execution: \`${policyDecision.escalated_actions.join('`, `')}\`.

Policy decision hash: \`${policyDecision.decision_hash}\`.

The policy decision file is deterministic and hash-bound to the signed
ingestion records. It is not a signed atrib record yet. The signed evidence in
this packet is the wrapped Firecrawl tool-call chain.

## Loop receipt

The implementation loop contract and pass receipts live in \`LOOP.md\`.

## Weakness

${weakness}

## Demo boundary

This is a fixed proof artifact plus a rerunnable local command. It is not a
hosted interactive demo yet. A hosted ingestion demo would let a reviewer run a
bounded URL or replay a fixed target and inspect receipts without local
credential setup.

## Regenerate

\`\`\`bash
ATRIB_PACKET_WRITE_ARTIFACTS=1 pnpm --filter @atrib/integration firecrawl-web-ingestion-packet
\`\`\`

## Live upstream run

\`\`\`bash
ATRIB_FIRECRAWL_WEB_INGESTION_LIVE=1 \\
ATRIB_PACKET_PUBLIC_LOG=1 \\
ATRIB_PACKET_WRITE_ARTIFACTS=1 \\
  pnpm --filter @atrib/integration firecrawl-web-ingestion-packet
\`\`\`

Live mode expects \`FIRECRAWL_API_KEY\` in the shell environment. On the operator
machine, \`~/.zshenv\` seeds it from \`~/.atrib/secrets/firecrawl-api-key\`
first, then asks 1Password only in an interactive shell if the cache is empty.
The runner does not call \`op read\`.
`
}

export async function runFirecrawlWebIngestionPacket(
  options: FirecrawlWebIngestionPacketOptions = {},
): Promise<FirecrawlWebIngestionPacketRun> {
  const env = options.env ?? process.env
  const exampleDir = dirname(fileURLToPath(import.meta.url))
  const integrationDir = dirname(dirname(exampleDir))
  const liveMode = options.liveMode ?? env.ATRIB_FIRECRAWL_WEB_INGESTION_LIVE === '1'
  const publicLog = options.publicLog ?? (liveMode && env.ATRIB_PACKET_PUBLIC_LOG !== '0')
  const query =
    options.query ?? env.ATRIB_FIRECRAWL_QUERY ?? (liveMode ? LIVE_DEFAULT_QUERY : PRIVATE_QUERY)
  const sourceUrl =
    options.sourceUrl ?? env.ATRIB_FIRECRAWL_URL ?? (liveMode ? LIVE_DEFAULT_URL : PRIVATE_URL)
  const extractPrompt =
    options.extractPrompt ??
    env.ATRIB_FIRECRAWL_EXTRACT_PROMPT ??
    (liveMode ? LIVE_DEFAULT_EXTRACT_PROMPT : 'Extract vendor and account note')
  const expectText = (value: string) => (liveMode ? {} : { expectText: value })
  const packetOptions: PacketOptions = {
    packet: 'firecrawl-web-ingestion',
    mode: liveMode ? 'live' : 'fixture',
    logMode: publicLog ? 'public' : 'local',
    upstreamShape: liveMode
      ? 'Firecrawl MCP stdio server launched with npx -y firecrawl-mcp'
      : 'Firecrawl MCP stdio server tools firecrawl_search, firecrawl_scrape, firecrawl_extract, firecrawl_crawl',
    exampleDir,
    integrationDir,
    ...(env.ATRIB_PACKET_PUBLIC_LOG_ENDPOINT
      ? { publicLogEndpoint: env.ATRIB_PACKET_PUBLIC_LOG_ENDPOINT }
      : {}),
    ...(liveMode
      ? {
          upstream: {
            command: 'npx',
            args: ['-y', 'firecrawl-mcp'],
            env: requiredFirecrawlEnv(env),
          },
        }
      : { fixtureServer: join(exampleDir, 'firecrawl-fixture-mcp.ts') }),
    expectedTools: ['firecrawl_search', 'firecrawl_scrape', 'firecrawl_extract', 'firecrawl_crawl'],
    calls: [
      {
        name: 'firecrawl_search',
        arguments: { query, limit: 1 },
        ...expectText('Private vendor page'),
      },
      {
        name: 'firecrawl_scrape',
        arguments: { url: sourceUrl, formats: ['markdown', 'html'] },
        ...expectText('success'),
      },
      {
        name: 'firecrawl_extract',
        arguments: {
          urls: [sourceUrl],
          prompt: extractPrompt,
          schema: {
            type: 'object',
            properties: {
              company: { type: 'string' },
              account_note: { type: 'string' },
            },
          },
        },
        ...expectText('Fixture Vendor'),
      },
      {
        name: 'firecrawl_crawl',
        arguments: { url: sourceUrl, ...CRAWL_CAP },
        ...expectText('queued'),
      },
    ],
    privateNeedles: liveMode
      ? [query, sourceUrl, extractPrompt]
      : [
          PRIVATE_QUERY,
          PRIVATE_URL,
          PRIVATE_MARKDOWN,
          PRIVATE_HTML,
          PRIVATE_EXTRACT,
          PRIVATE_CRAWL_JOB_ID,
        ],
    ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
  }
  const result = await runWrappedMcpPacket(packetOptions)

  const policyDecision = buildPolicyDecision(result)

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
    crawl_cap: CRAWL_CAP,
    policy_decision: {
      artifact: 'policy-decision.json',
      decision: policyDecision.decision,
      decision_status: policyDecision.decision_status,
      decision_hash: policyDecision.decision_hash,
      signed_policy_record: false,
      caveat:
        'Policy decision is a deterministic artifact bound to signed records, not a signed atrib record.',
    },
    caveats: [
      result.mode === 'live'
        ? 'Live Firecrawl MCP command path. Raw Firecrawl content remains private.'
        : 'Fixture run only. It does not prove hosted Firecrawl API output.',
      'Private query, URL, page content, extracted text, and crawl job id are represented by hashes only.',
    ],
  }

  const redactionManifest = {
    schema: 'atrib.proof_packet.redaction_manifest.v1',
    packet: result.packet,
    private_fields: liveMode
      ? [
          { field: 'query', disclosure: 'hash-only', hash: hashText(query) },
          { field: 'source_url', disclosure: 'hash-only', hash: hashText(sourceUrl) },
          { field: 'extract_prompt', disclosure: 'hash-only', hash: hashText(extractPrompt) },
          { field: 'raw_scraped_content', disclosure: 'result-hash-only' },
          { field: 'extracted_page_text', disclosure: 'result-hash-only' },
          { field: 'crawl_job_id', disclosure: 'result-hash-only' },
        ]
      : [
          { field: 'query', disclosure: 'hash-only', hash: hashText(PRIVATE_QUERY) },
          { field: 'source_url', disclosure: 'hash-only', hash: hashText(PRIVATE_URL) },
          { field: 'scraped_markdown', disclosure: 'hash-only', hash: hashText(PRIVATE_MARKDOWN) },
          { field: 'scraped_html', disclosure: 'hash-only', hash: hashText(PRIVATE_HTML) },
          {
            field: 'extracted_page_text',
            disclosure: 'hash-only',
            hash: hashText(PRIVATE_EXTRACT),
          },
          { field: 'crawl_job_id', disclosure: 'hash-only', hash: hashText(PRIVATE_CRAWL_JOB_ID) },
        ],
  }

  const outDir = artifactDir(integrationDir, env, options)
  if (outDir) {
    mkdirSync(outDir, { recursive: true })
    writeFileSync(join(outDir, 'README.md'), renderReadme(result, policyDecision))
    writeJson(join(outDir, 'verifier-output.json'), verifierOutput)
    writeJson(join(outDir, 'redaction-manifest.json'), redactionManifest)
    writeJson(join(outDir, 'policy-decision.json'), policyDecision)
  }

  return {
    result,
    verifierOutput,
    redactionManifest,
    policyDecision,
    artifact_dir: outDir ?? null,
  }
}

async function main(): Promise<void> {
  const packet = await runFirecrawlWebIngestionPacket()
  const { result, policyDecision, artifact_dir } = packet
  console.log(
    JSON.stringify(
      {
        ...result,
        policy_decision: {
          artifact: 'policy-decision.json',
          decision: policyDecision.decision,
          decision_hash: policyDecision.decision_hash,
        },
        artifact_dir,
      },
      null,
      2,
    ),
  )
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
  })
}
