// SPDX-License-Identifier: Apache-2.0

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { hashText, runWrappedMcpPacket, writeJson } from '../wrapped-mcp-proof-runner.js'

const PRIVATE_QUERY = 'private acquisition research query'
const PRIVATE_URL = 'https://example.invalid/private-firecrawl-source'
const PRIVATE_MARKDOWN = '# Private vendor page\n\nConfidential pricing: private firecrawl text.'
const PRIVATE_HTML = '<main><h1>Private vendor page</h1><p>Confidential pricing</p></main>'
const PRIVATE_EXTRACT = 'private firecrawl extracted account note'
const PRIVATE_CRAWL_JOB_ID = 'crawl_private_job_20260623'

function requiredFirecrawlEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  if (process.env.FIRECRAWL_API_KEY) env.FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY
  if (process.env.FIRECRAWL_API_URL) env.FIRECRAWL_API_URL = process.env.FIRECRAWL_API_URL
  if (!env.FIRECRAWL_API_KEY && !env.FIRECRAWL_API_URL) {
    throw new Error(
      'FIRECRAWL_API_KEY or FIRECRAWL_API_URL is required for ATRIB_FIRECRAWL_WEB_INGESTION_LIVE=1',
    )
  }
  return env
}

function artifactDir(integrationDir: string): string | undefined {
  if (process.env.ATRIB_PACKET_OUT_DIR) return process.env.ATRIB_PACKET_OUT_DIR
  if (process.env.ATRIB_PACKET_WRITE_ARTIFACTS === '1') {
    return join(integrationDir, '..', '..', 'proof-packets', 'firecrawl-web-ingestion')
  }
  return undefined
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

The crawl step is capped to \`maxDepth: 1\` and \`limit: 2\`.

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
FIRECRAWL_API_KEY=... \\
ATRIB_PACKET_WRITE_ARTIFACTS=1 \\
  pnpm --filter @atrib/integration firecrawl-web-ingestion-packet
\`\`\`
`
}

async function main(): Promise<void> {
  const exampleDir = dirname(fileURLToPath(import.meta.url))
  const integrationDir = dirname(dirname(exampleDir))
  const liveMode = process.env.ATRIB_FIRECRAWL_WEB_INGESTION_LIVE === '1'
  const publicLog = liveMode && process.env.ATRIB_PACKET_PUBLIC_LOG !== '0'
  const query = process.env.ATRIB_FIRECRAWL_QUERY ?? PRIVATE_QUERY
  const sourceUrl = process.env.ATRIB_FIRECRAWL_URL ?? PRIVATE_URL
  const extractPrompt =
    process.env.ATRIB_FIRECRAWL_EXTRACT_PROMPT ?? 'Extract vendor and account note'
  const result = await runWrappedMcpPacket({
    packet: 'firecrawl-web-ingestion',
    mode: liveMode ? 'live' : 'fixture',
    logMode: publicLog ? 'public' : 'local',
    publicLogEndpoint: process.env.ATRIB_PACKET_PUBLIC_LOG_ENDPOINT,
    upstreamShape: liveMode
      ? 'Firecrawl MCP stdio server launched with npx -y firecrawl-mcp'
      : 'Firecrawl MCP stdio server tools firecrawl_search, firecrawl_scrape, firecrawl_extract, firecrawl_crawl',
    exampleDir,
    integrationDir,
    fixtureServer: liveMode ? undefined : join(exampleDir, 'firecrawl-fixture-mcp.ts'),
    upstream: liveMode
      ? {
          command: 'npx',
          args: ['-y', 'firecrawl-mcp'],
          env: requiredFirecrawlEnv(),
        }
      : undefined,
    expectedTools: ['firecrawl_search', 'firecrawl_scrape', 'firecrawl_extract', 'firecrawl_crawl'],
    calls: [
      {
        name: 'firecrawl_search',
        arguments: { query, limit: 1 },
        expectText: liveMode ? undefined : 'Private vendor page',
      },
      {
        name: 'firecrawl_scrape',
        arguments: { url: sourceUrl, formats: ['markdown', 'html'] },
        expectText: liveMode ? undefined : 'success',
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
        expectText: liveMode ? undefined : 'Fixture Vendor',
      },
      {
        name: 'firecrawl_crawl',
        arguments: { url: sourceUrl, maxDepth: 1, limit: 2 },
        expectText: liveMode ? undefined : 'queued',
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
  })

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
    crawl_cap: {
      maxDepth: 1,
      limit: 2,
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

  const outDir = artifactDir(integrationDir)
  if (outDir) {
    mkdirSync(outDir, { recursive: true })
    writeFileSync(join(outDir, 'README.md'), renderReadme(result))
    writeJson(join(outDir, 'verifier-output.json'), verifierOutput)
    writeJson(join(outDir, 'redaction-manifest.json'), redactionManifest)
  }

  console.log(JSON.stringify({ ...result, artifact_dir: outDir ?? null }, null, 2))
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
