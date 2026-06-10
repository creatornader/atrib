import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import {
  installWrapperLifecycle,
  type WrapperLifecycleOptions,
  type WrapperShutdownDetails,
  type WrapperShutdownReason,
} from '../src/lifecycle.js'

type FakeStream = EventEmitter & {
  destroyed?: boolean
  readableEnded?: boolean
}

type FakeProcess = EventEmitter & {
  pid: number
  ppid: number
  stdin: FakeStream
  kill: ReturnType<typeof vi.fn>
  exit: ReturnType<typeof vi.fn>
}

function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

function makeHarness() {
  const stdin = new EventEmitter() as FakeStream
  stdin.destroyed = false
  stdin.readableEnded = false

  const proc = new EventEmitter() as FakeProcess
  proc.pid = 200
  proc.ppid = 100
  proc.stdin = stdin
  proc.kill = vi.fn(() => true)
  proc.exit = vi.fn()

  const shutdown = vi.fn(
    async (_reason: WrapperShutdownReason, _details?: WrapperShutdownDetails) => {},
  )
  const log = vi.fn()

  return { proc, stdin, shutdown, log }
}

function installForTest(
  harness: ReturnType<typeof makeHarness>,
  options: Partial<WrapperLifecycleOptions> = {},
) {
  const exit = vi.fn()
  const lifecycle = installWrapperLifecycle({
    process: harness.proc as unknown as WrapperLifecycleOptions['process'],
    stdin: harness.stdin,
    shutdown: harness.shutdown,
    log: harness.log,
    parentPollMs: 0,
    exit,
    ...options,
  })
  return { lifecycle, exit }
}

describe('installWrapperLifecycle', () => {
  it('shuts down on host stdin close', async () => {
    const harness = makeHarness()
    const { exit } = installForTest(harness)

    harness.stdin.emit('close')
    await flush()

    expect(harness.shutdown).toHaveBeenCalledOnce()
    expect(harness.shutdown).toHaveBeenCalledWith('stdin-close', {})
    expect(exit).toHaveBeenCalledWith(0)
    expect(harness.stdin.listenerCount('close')).toBe(0)
  })

  it('runs shutdown only once across duplicate lifecycle events', async () => {
    const harness = makeHarness()
    const { exit } = installForTest(harness)

    harness.proc.emit('SIGTERM')
    harness.stdin.emit('close')
    await flush()

    expect(harness.shutdown).toHaveBeenCalledOnce()
    expect(harness.shutdown).toHaveBeenCalledWith('SIGTERM', {})
    expect(exit).toHaveBeenCalledOnce()
  })

  it('shuts down when the wrapper is reparented to launchd', async () => {
    const harness = makeHarness()
    let parentTick: (() => void) | undefined
    const timer = { unref: vi.fn() }
    const clearIntervalFn = vi.fn()
    const exit = vi.fn()

    installWrapperLifecycle({
      process: harness.proc as unknown as WrapperLifecycleOptions['process'],
      stdin: harness.stdin,
      shutdown: harness.shutdown,
      log: harness.log,
      parentPid: 100,
      currentParentPid: () => 1,
      setIntervalFn: (callback) => {
        parentTick = callback
        return timer
      },
      clearIntervalFn,
      exit,
    })

    parentTick?.()
    await flush()

    expect(harness.shutdown).toHaveBeenCalledWith('parent-reparented', {
      parentPid: 100,
      currentParentPid: 1,
    })
    expect(clearIntervalFn).toHaveBeenCalledWith(timer)
    expect(timer.unref).toHaveBeenCalledOnce()
    expect(exit).toHaveBeenCalledWith(0)
  })

  it('exits nonzero when shutdown fails', async () => {
    const harness = makeHarness()
    harness.shutdown.mockRejectedValueOnce(new Error('close failed'))
    const { exit } = installForTest(harness)

    harness.proc.emit('SIGINT')
    await flush()

    expect(harness.shutdown).toHaveBeenCalledWith('SIGINT', {})
    expect(harness.log).toHaveBeenCalledWith(
      'error',
      'wrapper lifecycle shutdown failed',
      expect.objectContaining({ reason: 'SIGINT', error: 'close failed' }),
    )
    expect(exit).toHaveBeenCalledWith(1)
  })
})
