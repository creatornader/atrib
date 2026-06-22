# atrib end-to-end demo

A complete, runnable atrib attribution chain in a single process. One command to start, one CLI window to watch records flow.

```bash
ATRIB_PRIVATE_KEY=$(node -e 'console.log(Buffer.from(crypto.randomBytes(32)).toString("base64url"))') \
  pnpm --filter @atrib/integration demo
```

Or from the integration package directory:

```bash
cd packages/integration
ATRIB_PRIVATE_KEY=$(node -e 'console.log(Buffer.from(crypto.randomBytes(32)).toString("base64url"))') pnpm demo
```

## What this demo proves

In ~150 lines of TypeScript and one terminal window, this demo runs the **entire atrib protocol** end-to-end:

1. A **fake MCP merchant tool server** that pretends to be a search API. It uses `@atrib/mcp`'s `atrib()` middleware so every tool call it serves emits a signed attribution record.

2. A **fake AI agent** built on the raw `@modelcontextprotocol/sdk` Client (wrapped with `wrapMcpClient` from `@atrib/agent`), which calls the merchant's tool twice; chaining the second call to the first via `_meta.atrib`.

3. A **stubbed x402-style payment** detected by `@atrib/agent`'s transaction middleware; closing the chain with a transaction record per spec [§5.4](../../../../atrib-spec.md#54-atribagent-agent-middleware).

4. **`@atrib/log-dev`** in-process, receiving every signed record per spec [§2.6.1](../../../../atrib-spec.md#261-submit-entry), validating shape, and returning well-formed inclusion proofs.

5. A **CLI visualizer** that subscribes to the dev log via `onSubmit()` and pretty-prints each record as it lands; showing the chain build up step by step.

By the end of the demo, you have watched a full attribution chain form: tool
call → tool call → transaction, with chain linkage visible at each step, and
you have seen how an independent verifier checks the attribution after the fact.

## What you should see

```
[demo] starting dev log...
[demo] dev log running at http://127.0.0.1:55013
[demo] starting merchant tool server (fake search API)...
[demo] starting agent client...
[demo] agent connected to merchant
[demo] ─────────────────────────────────────────────────────────────
[demo] step 1: agent calls 'search' for the first time (genesis)
[demo] ─────────────────────────────────────────────────────────────
[log] +tool_call ctx=4bf92f35... chain=sha256:7e1f4a... idx=0
[demo] ─────────────────────────────────────────────────────────────
[demo] step 2: agent calls 'search' again (chained from step 1)
[demo] ─────────────────────────────────────────────────────────────
[log] +tool_call ctx=4bf92f35... chain=sha256:c3a8b2... idx=1
[demo] ─────────────────────────────────────────────────────────────
[demo] step 3: agent observes a fake x402 payment receipt
[demo] ─────────────────────────────────────────────────────────────
[log] +transaction ctx=4bf92f35... chain=sha256:9e2d1f... idx=2
[demo] ─────────────────────────────────────────────────────────────
[demo] final state:
[demo]   3 records in the log
[demo]   2 tool_call records
[demo]   1 transaction record
[demo]   chain length: 3 (genesis → tool_call → transaction)
[demo] done.
```

The colored chain hash on each line is what makes the chain visible: every record's `chain_root` references the hash of the previous record, and the visualizer prints them so you can see the references line up.

## What this demo is NOT

- **It is NOT a real attribution log.** `@atrib/log-dev` is an in-memory dev stub. The proof bundles it returns have placeholder hashes, not real Merkle hashes. They will not pass `@atrib/verify`'s strict cryptographic verification path. The production log lives at `log.atrib.dev/v1` (Tessera-backed, per spec [§2](../../../../atrib-spec.md#2-merkle-log-protocol)) and will exist as a separate Go service in `services/log/`.
- **It is NOT a real merchant server.** The merchant in this demo serves a hardcoded fake search response. A real merchant would integrate `@atrib/mcp` into their actual MCP server with real tool implementations.
- **It is NOT a real agent.** The agent in this demo issues two hardcoded tool calls and observes a hardcoded payment response. A real agent would be invoked by an LLM via one of the framework adapters in `@atrib/agent` (Vercel AI SDK, LangChain, Cloudflare Agents, etc.).

Despite all those simplifications, **the wire format and the cryptographic signatures and the chain linkage and the transaction detection are all real**. Everything you see in the CLI output is a real signed record, a real chain hash, and a real transaction event detected by the production transaction-detection logic in `@atrib/agent`'s `transaction.ts`. The fakery is in the surrounding environment, not in the protocol.

## How to use this demo as a walkthrough

This is the answer to "where does this go in 15 minutes?" When a developer wants
to see how atrib works, you can:

1. Run `pnpm tsx packages/integration/examples/end-to-end/demo.ts`
2. Watch the records flow
3. Point at each step in the CLI output and explain what's happening at the protocol level
4. Show which lines of code belong on the merchant side, roughly three lines:
   import, wrap, set log endpoint
5. Show which lines belong on the agent side, roughly two lines: import, wrap
6. Switch to the production answer: "this is the dev log; the production log is
   `log.atrib.dev/v1` and is Tessera-backed per spec
   [§2](../../../../atrib-spec.md#2-merkle-log-protocol); same wire format, same
   record shape, no client changes."

The demo makes the abstract protocol concrete in a way that the spec and the README cannot.
