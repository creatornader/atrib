// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { BasicTracerProvider } from '@opentelemetry/sdk-trace-base'
import { context } from '@opentelemetry/api'
import { AsyncHooksContextManager } from '@opentelemetry/context-async-hooks'
import {
  verifyOpenTelemetryContextPropagation,
  ContextPropagationError,
} from '../src/preflight.js'

describe('verifyOpenTelemetryContextPropagation', () => {
  let originalManager: ReturnType<typeof getCurrentContextManager> | null = null

  beforeEach(() => {
    originalManager = getCurrentContextManager()
  })

  afterEach(() => {
    // Restore any prior manager.
    if (originalManager) {
      context.setGlobalContextManager(originalManager)
    }
  })

  it('passes when AsyncHooksContextManager is registered', async () => {
    const ctxManager = new AsyncHooksContextManager()
    ctxManager.enable()
    context.setGlobalContextManager(ctxManager)

    const provider = new BasicTracerProvider()
    await expect(verifyOpenTelemetryContextPropagation(provider)).resolves.toBeUndefined()
  })

  it('throws ContextPropagationError when no context manager is registered', async () => {
    // Force the no-op manager (default state without registration).
    context.disable()

    const provider = new BasicTracerProvider()
    let caught: unknown
    try {
      await verifyOpenTelemetryContextPropagation(provider)
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(ContextPropagationError)
    if (caught instanceof Error) {
      expect(caught.message).toContain('NOT propagating')
      expect(caught.message).toContain('AsyncHooksContextManager')
    }
  })

  it('error message includes the actionable fix instructions', async () => {
    context.disable()
    const provider = new BasicTracerProvider()
    try {
      await verifyOpenTelemetryContextPropagation(provider)
      throw new Error('expected verifyOpenTelemetryContextPropagation to throw')
    } catch (err) {
      if (!(err instanceof ContextPropagationError)) throw err
      expect(err.message).toContain('@opentelemetry/context-async-hooks')
      expect(err.message).toContain('setGlobalContextManager')
      expect(err.message).toContain('NodeSDK')
    }
  })

  it('uses the global tracer provider when no provider is passed', async () => {
    const ctxManager = new AsyncHooksContextManager()
    ctxManager.enable()
    context.setGlobalContextManager(ctxManager)
    // Without a provider arg, it falls through to the global default.
    // This should pass if the global default is functional, which it is
    // by virtue of the API's no-op fallback that still produces traces.
    await expect(verifyOpenTelemetryContextPropagation()).resolves.toBeUndefined()
  })
})

function getCurrentContextManager() {
  // The OTel public API doesn't expose the context manager directly. We
  // capture/restore a placeholder so tests can re-enable it after a
  // disable() call. Production code never needs this.
  return null as unknown as Parameters<typeof context.setGlobalContextManager>[0]
}
