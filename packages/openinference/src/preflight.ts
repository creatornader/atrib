// SPDX-License-Identifier: Apache-2.0

/**
 * Preflight verification: does the OpenTelemetry context manager actually
 * propagate trace context across an async boundary?
 *
 * Without an active context manager registered (the default state for a
 * bare BasicTracerProvider), spans crossing an `await` boundary lose
 * their parent context and emit as fresh root spans with distinct
 * trace_ids. Atrib's adapter then signs each into its own context_id,
 * breaking session chain composition.
 *
 * This helper performs a deterministic two-span test: opens a root span,
 * crosses an async boundary, opens a child span inside the root's
 * context, and verifies the child shares the root's trace_id. If not,
 * the host application is missing context propagation and should
 * register `AsyncHooksContextManager` (or use `NodeSDK` from
 * `@opentelemetry/sdk-node`, which registers one by default).
 *
 * Recommended usage: call once at application startup, before instantiating
 * your AtribSpanProcessor.
 */

import { context, trace, type TracerProvider } from '@opentelemetry/api'

export class ContextPropagationError extends Error {
  override readonly name = 'ContextPropagationError'
  constructor(message: string) {
    super(message)
  }
}

const FIX_INSTRUCTIONS = `
To fix: register an async-hooks context manager before creating your
TracerProvider:

  import { AsyncHooksContextManager } from '@opentelemetry/context-async-hooks'
  import { context } from '@opentelemetry/api'

  const ctxManager = new AsyncHooksContextManager()
  ctxManager.enable()
  context.setGlobalContextManager(ctxManager)

If you are using NodeSDK from @opentelemetry/sdk-node, this is already done
for you. The check above only fails for bare BasicTracerProvider setups.
See @atrib/openinference README for full guidance.`.trim()

/**
 * Verify that OpenTelemetry context propagates across async boundaries.
 *
 * @param provider The TracerProvider to test against. If omitted, uses
 *                 the global tracer provider.
 * @throws ContextPropagationError when context propagation is broken.
 */
export async function verifyOpenTelemetryContextPropagation(
  provider?: TracerProvider,
): Promise<void> {
  const tracer = (provider ?? trace.getTracerProvider()).getTracer(
    '@atrib/openinference:preflight',
  )

  const root = tracer.startSpan('atrib-preflight-root')
  const rootTraceId = root.spanContext().traceId

  // Capture the child's traceId from inside the root's active context
  // and across an async boundary. If context propagation is broken, the
  // child becomes a fresh root with its own traceId.
  let childTraceId: string | undefined
  await context.with(trace.setSpan(context.active(), root), async () => {
    // Force an async boundary -- this is exactly the case that breaks
    // when no context manager is registered.
    await new Promise<void>((resolve) => setImmediate(resolve))
    const child = tracer.startSpan('atrib-preflight-child')
    childTraceId = child.spanContext().traceId
    child.end()
  })
  root.end()

  if (childTraceId === undefined) {
    throw new ContextPropagationError(
      'atrib preflight: child span never executed. Tracer provider may be misconfigured.\n' +
        FIX_INSTRUCTIONS,
    )
  }

  if (childTraceId !== rootTraceId) {
    throw new ContextPropagationError(
      `atrib preflight: trace context is NOT propagating across async boundaries.\n` +
        `  root span trace_id:  ${rootTraceId}\n` +
        `  child span trace_id: ${childTraceId}\n` +
        `\n` +
        `Without context propagation, each Vercel AI SDK / framework span lands ` +
        `in its own atrib context_id, breaking session chain composition.\n` +
        `\n` +
        FIX_INSTRUCTIONS,
    )
  }
}
