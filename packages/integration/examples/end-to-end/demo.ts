/**
 * atrib end-to-end demo. single-process runnable showcase.
 *
 * Run with:
 *   ATRIB_PRIVATE_KEY=$(node -e 'console.log(Buffer.from(crypto.randomBytes(32)).toString("base64url"))') \
 *     pnpm tsx packages/integration/examples/end-to-end/demo.ts
 *
 * What this demonstrates in ~150 lines:
 *   1. @atrib/log-dev running in-process at a free port
 *   2. A fake MCP merchant tool server wrapped with @atrib/mcp's atrib()
 *      middleware. every tool call it serves emits a signed record
 *   3. A fake agent built on raw @modelcontextprotocol/sdk Client wrapped
 *      with @atrib/agent's wrapMcpClient. its outbound calls carry
 *      attribution context and chain to each other
 *   4. A stubbed x402-style payment receipt that closes the chain via
 *      @atrib/agent's transaction detection (spec §5.4)
 *   5. A CLI visualizer that prints each record as it lands in the dev log
 *
 * The mock is limited to the surrounding environment (fake search results,
 * in-memory transport, stubbed payment header). All attribution logic.
 * signing, chaining, transaction detection. runs the production code paths.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { atrib as wrapServer } from '@atrib/mcp'
import { atrib as createInterceptor, wrapMcpClient } from '@atrib/agent'
import { startDevLog } from '@atrib/log-dev'

// ── Pretty-print helpers ───────────────────────────────────────────────────
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`
const green = (s: string) => `\x1b[32m${s}\x1b[0m`
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`
const magenta = (s: string) => `\x1b[35m${s}\x1b[0m`
const sep = '─'.repeat(70)

function step(label: string): void {
  console.log()
  console.log(dim('[demo] ' + sep))
  console.log(`${dim('[demo]')} ${bold(label)}`)
  console.log(dim('[demo] ' + sep))
}

function info(msg: string): void {
  console.log(`${dim('[demo]')} ${msg}`)
}

async function main(): Promise<void> {
  if (!process.env.ATRIB_PRIVATE_KEY) {
    console.error('error: ATRIB_PRIVATE_KEY env var is required')
    console.error()
    console.error('generate one with:')
    console.error(
      '  node -e \'console.log(Buffer.from(crypto.randomBytes(32)).toString("base64url"))\'',
    )
    process.exit(1)
  }

  // ── 1. Spin up the dev log on a free port ────────────────────────────────
  info('starting dev log...')
  const log = await startDevLog({ port: 0 })
  info(`dev log running at ${cyan(log.url)}`)

  // Subscribe to the dev log so we can pretty-print every admitted record.
  log.onSubmit((entry) => {
    const evt =
      entry.record.event_type === 'https://atrib.dev/v1/types/transaction'
        ? magenta('+transaction')
        : entry.record.event_type === 'https://atrib.dev/v1/types/observation'
          ? cyan('+observation')
          : green('+tool_call  ')
    const ctx = yellow(entry.record.context_id.slice(0, 8) + '…')
    const chain = entry.record.chain_root
      ? cyan(entry.record.chain_root.slice(0, 16) + '…')
      : dim('genesis')
    console.log(`${dim('[log]')} ${evt} ctx=${ctx} chain=${chain} idx=${entry.logIndex}`)
  })

  // ── 2. Fake merchant tool server ─────────────────────────────────────────
  info('starting merchant tool server (fake search API)...')
  const merchantServer = new McpServer({ name: 'merchant-search', version: '1.0.0' })

  // Wrap the server with @atrib/mcp's atrib() middleware. Every tool call
  // it serves now emits a signed attribution record.
  wrapServer(merchantServer, {
    creatorKey: process.env.ATRIB_PRIVATE_KEY,
    serverUrl: 'https://merchant.example.com',
    logEndpoint: log.submissionEndpoint,
  })

  // Register a single fake search tool. Returns hardcoded results. the
  // value of this demo is in the attribution flow, not the search results.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(merchantServer as any).tool('search', async () => ({
    content: [
      { type: 'text', text: 'Found 3 results for query.' },
      { type: 'text', text: '1. atrib protocol overview' },
      { type: 'text', text: '2. Implementation guide' },
      { type: 'text', text: '3. Spec §2 Merkle log' },
    ],
  }))

  // ── 3. Fake agent client ─────────────────────────────────────────────────
  info('starting agent client...')

  // The agent uses a different keypair than the merchant. it's a separate
  // attributing party. In a real deployment this would be the agent
  // operator's key, distinct from the merchant's.
  const agentKey = Buffer.from(new Uint8Array(32).map((_, i) => (i + 100) & 0xff)).toString(
    'base64url',
  )

  const agentInterceptor = createInterceptor({
    creatorKey: agentKey,
    merchantDomain: 'https://merchant.example.com',
    serverUrls: ['https://merchant.example.com'],
    logEndpoint: log.submissionEndpoint,
  })

  // Connect agent to merchant via in-process transport (no network needed).
  const [agentTransport, merchantTransport] = InMemoryTransport.createLinkedPair()
  await Promise.all([
    merchantServer.connect(merchantTransport),
    (async () => {
      // The agent uses a raw @modelcontextprotocol/sdk Client wrapped with
      // wrapMcpClient. the same pattern as any of the framework adapters.
      const rawClient = new Client({ name: 'demo-agent', version: '1.0.0' }, { capabilities: {} })
      await rawClient.connect(agentTransport)
      const client = wrapMcpClient(rawClient, agentInterceptor, {
        serverUrl: 'https://merchant.example.com',
      })
      // Stash on the global so the rest of main() can use it without
      // hoisting it out of the connection setup.
      ;(globalThis as unknown as { agentClient: typeof client }).agentClient = client
    })(),
  ])
  info('agent connected to merchant')

  const agentClient = (
    globalThis as unknown as {
      agentClient: ReturnType<typeof wrapMcpClient<Client>>
    }
  ).agentClient

  // ── 4. The actual demo flow ──────────────────────────────────────────────
  step("step 1: agent calls 'search' for the first time (genesis)")
  await agentClient.callTool({
    name: 'search',
    arguments: { query: 'atrib protocol' },
  })

  // Give the submission queues a tick to drain so the visualizer prints
  // the record before the next step header. The flush() at the end will
  // ensure nothing is lost; this is purely cosmetic for the live output.
  await sleep(60)

  step("step 2: agent calls 'search' again (chained from step 1)")
  await agentClient.callTool({
    name: 'search',
    arguments: { query: 'merkle log' },
  })
  await sleep(60)

  step('step 3: agent observes a fake x402 payment receipt')

  // Stub an x402-style payment-completed response and feed it to the
  // agent's interceptor's onAfterToolResponse. The transaction detector
  // recognizes the x402 signal (PAYMENT-RESPONSE shape) and emits a
  // transaction record per spec §1.7.3 + §5.4.
  const fakePaymentResponse = {
    // The detection signal in transaction.ts looks for a top-level
    // header-like field. We pass the response object plus the headers
    // object the detector reads from in the synthetic case.
    headers: {
      'PAYMENT-RESPONSE':
        'eyJzdWNjZXNzIjp0cnVlLCJ0cmFuc2FjdGlvbiI6IjB4MTIzYWJjIiwibmV0d29yayI6ImJhc2UifQ==',
    },
    // Some content the agent saw alongside the payment header
    content: [{ type: 'text', text: 'Payment confirmed.' }],
  }
  agentInterceptor.onAfterToolResponse(
    'checkout',
    fakePaymentResponse,
    {},
    {
      serverUrl: 'https://merchant.example.com',
    },
  )
  await sleep(60)

  // ── 5. Drain everything and report ───────────────────────────────────────
  await agentInterceptor.flush()
  await sleep(100) // give the merchant-side queue a moment too

  step('final state')
  const total = log.size
  const toolCalls = log.entries.filter(
    (e) => e.record.event_type === 'https://atrib.dev/v1/types/tool_call',
  ).length
  const transactions = log.entries.filter(
    (e) => e.record.event_type === 'https://atrib.dev/v1/types/transaction',
  ).length
  info(`${bold(String(total))} records in the log`)
  info(`  ${green(String(toolCalls))} tool_call records`)
  info(`  ${magenta(String(transactions))} transaction record${transactions === 1 ? '' : 's'}`)
  info('chain length: ' + bold(String(total)))
  info('done.')

  // ── 6. Cleanup ───────────────────────────────────────────────────────────
  await agentClient.close().catch(() => {})
  await merchantServer.close().catch(() => {})
  await log.close()
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

main().catch((err) => {
  console.error('demo failed:', err)
  process.exit(1)
})
