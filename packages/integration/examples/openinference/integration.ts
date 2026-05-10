/**
 * atrib + OpenInference. runnable integration snippet.
 *
 * Demonstrates atrib's `@atrib/openinference-processor` composing alongside
 * Arize's `@arizeai/openinference-vercel` reference SpanProcessor on a
 * shared OpenTelemetry TracerProvider. This is the canonical Pattern #4
 * shape from atrib-spec §9: one OpenInference instrumentation feeds two
 * sibling processors, one for capture (Arize -> Phoenix / Langfuse / OTLP)
 * and one for verifiable signing (atrib -> Merkle log).
 *
 * Run with:
 *   ATRIB_PRIVATE_KEY=<base64url-32-bytes> \
 *   ATRIB_LOG_ENDPOINT=https://log.atrib.dev/v1 \
 *   pnpm tsx examples/openinference/integration.ts
 *
 * NOTE: This file imports from `@arizeai/openinference-vercel` and
 * `@opentelemetry/sdk-trace-base`. Both are devDependencies of
 * `@atrib/integration` for example purposes; install them in your own
 * workspace if running the example outside this repo:
 *
 *   pnpm add @arizeai/openinference-vercel @opentelemetry/api @opentelemetry/sdk-trace-base
 *
 * For a real end-to-end run with Vercel AI SDK + a model provider, see
 * Arize's own example at
 * https://github.com/Arize-ai/openinference/tree/main/js/packages/openinference-vercel/examples
 * and add `AtribSpanProcessor` to the same TracerProvider's `spanProcessors`
 * array.
 */

import { BasicTracerProvider } from '@opentelemetry/sdk-trace-base'
import { SpanStatusCode } from '@opentelemetry/api'
import {
  OpenInferenceSimpleSpanProcessor,
  isOpenInferenceSpan,
} from '@arizeai/openinference-vercel'
import { SemanticConventions } from '@arizeai/openinference-semantic-conventions'
import {
  base64urlEncode,
  base64urlDecode,
  getPublicKey,
  verifyRecord,
  type AtribRecord,
} from '@atrib/mcp'
import { AtribSpanProcessor } from '@atrib/openinference-processor'

async function main() {
  // 1. Resolve the operator's atrib identity. In production this comes from
  //    Keychain or an env var (see @atrib/cli for key management).
  const privateKeyB64 = process.env.ATRIB_PRIVATE_KEY
  if (!privateKeyB64) {
    throw new Error(
      'ATRIB_PRIVATE_KEY not set. Generate one via `atrib keygen` (see @atrib/cli) or set a 32-byte base64url-encoded seed in the env.',
    )
  }
  const privateKey = base64urlDecode(privateKeyB64)
  const publicKey = await getPublicKey(privateKey)
  const creatorKey = base64urlEncode(publicKey)

  // 2. Construct the atrib SpanProcessor. The submit callback receives
  //    every signed record + sidecar metadata. In production, route to
  //    @atrib/mcp's createSubmissionQueue or a custom HTTP client.
  const submittedRecords: AtribRecord[] = []
  const atribProcessor = new AtribSpanProcessor({
    privateKey,
    creatorKey,
    serverUrl: 'https://your-agent.example/atrib-openinference-pilot',
    submit: async (signed, sidecar) => {
      submittedRecords.push(signed)
      console.log(
        `atrib: signed record ${signed.signature.slice(0, 16)}... ` +
          `tool=${sidecar.agentName ?? '<unknown>'} ` +
          `traceId=${sidecar.traceId.slice(0, 8)}...`,
      )
      // In production:
      //   await fetch(`${process.env.ATRIB_LOG_ENDPOINT}/entries`, {
      //     method: 'POST', body: JSON.stringify({ record: signed, sidecar })
      //   })
    },
    debug: true,
  })

  // 3. Construct Arize's reference SpanProcessor. In a real pipeline this
  //    exports to Phoenix, Langfuse, or any OTLP-compatible collector.
  //    Here we use a no-op exporter so the example is self-contained.
  const arizeProcessor = new OpenInferenceSimpleSpanProcessor({
    exporter: {
      export: (spans, resultCallback) => {
        console.log(`arize: exported ${spans.length} OpenInference span(s)`)
        resultCallback({ code: 0 })
      },
      shutdown: async () => {},
    },
    spanFilter: isOpenInferenceSpan,
  })

  // 4. Both processors share one TracerProvider. The OpenInference
  //    instrumentation (AISDKExporter from @vercel/otel, Phoenix
  //    instrumentor, etc.) writes spans here; both processors see every
  //    one, with their own filters applied.
  const provider = new BasicTracerProvider({
    spanProcessors: [arizeProcessor, atribProcessor],
  })
  // Get the tracer from THIS provider directly. In a real Vercel AI SDK
  // pipeline you'd call `provider.register()` to install it as the global,
  // and OpenInference's instrumentation hooks would emit spans through
  // `trace.getTracer(...)` automatically.
  const tracer = provider.getTracer('atrib-openinference-pilot')

  // 5. Emit a synthetic OpenInference TOOL span matching the canonical
  //    schema Vercel AI SDK + openinference-instrumentation-vercel emits.
  //    In a real run this fires automatically when streamText/generateText
  //    invokes a tool; the snippet below documents the attribute shape.
  const span = tracer.startSpan('search_web')
  span.setAttribute(SemanticConventions.OPENINFERENCE_SPAN_KIND, 'TOOL')
  span.setAttribute(SemanticConventions.TOOL_NAME, 'search_web')
  span.setAttribute(SemanticConventions.SESSION_ID, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
  span.setAttribute(SemanticConventions.AGENT_NAME, 'Researcher')
  span.setAttribute(SemanticConventions.INPUT_VALUE, '{"query":"vercel ai sdk openinference"}')
  span.setAttribute(SemanticConventions.OUTPUT_VALUE, '[{"title":"...","url":"..."}]')
  span.setStatus({ code: SpanStatusCode.OK })
  span.end()

  // 6. Both processors are async; flush before reading.
  await new Promise((r) => setImmediate(r))
  await new Promise((r) => setImmediate(r))

  // 7. Verify the atrib record is well-formed and signature-valid.
  if (submittedRecords.length !== 1) {
    throw new Error(
      `expected 1 atrib record, got ${submittedRecords.length}. ` +
        `the OpenInference span did not flow through atrib's filter.`,
    )
  }
  const record = submittedRecords[0]!
  const valid = await verifyRecord(record)
  console.log(
    `atrib: record verified=${valid} ` +
      `event_type=${record.event_type} ` +
      `context_id=${record.context_id} ` +
      `creator_key=${record.creator_key.slice(0, 8)}...`,
  )

  // 8. Cleanup.
  await atribProcessor.shutdown()
  await arizeProcessor.shutdown()
  await provider.shutdown()
}

main().catch((err) => {
  console.error('integration failed:', err)
  process.exit(1)
})
