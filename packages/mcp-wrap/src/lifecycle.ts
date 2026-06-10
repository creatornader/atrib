// SPDX-License-Identifier: Apache-2.0

export type WrapperShutdownReason =
  | 'SIGINT'
  | 'SIGTERM'
  | 'SIGHUP'
  | 'stdin-end'
  | 'stdin-close'
  | 'stdin-error'
  | 'parent-exit'
  | 'parent-reparented'
  | 'uncaught-exception'
  | 'unhandled-rejection'

export interface WrapperShutdownDetails {
  parentPid?: number
  currentParentPid?: number
  error?: string
}

export type WrapperLifecycleLog = (
  level: 'info' | 'warn' | 'error',
  msg: string,
  extra?: Record<string, unknown>,
) => void

interface ProcessLike {
  pid: number
  ppid: number
  stdin: StreamLike
  on(event: string, listener: (...args: unknown[]) => void): unknown
  off(event: string, listener: (...args: unknown[]) => void): unknown
  kill(pid: number, signal?: NodeJS.Signals | 0): boolean
  exit(code?: number): never | void
}

interface StreamLike {
  destroyed?: boolean
  readableEnded?: boolean
  on(event: string, listener: (...args: unknown[]) => void): unknown
  off(event: string, listener: (...args: unknown[]) => void): unknown
}

interface TimerLike {
  unref?(): void
}

export interface WrapperLifecycleOptions {
  shutdown: (
    reason: WrapperShutdownReason,
    details?: WrapperShutdownDetails,
  ) => Promise<void> | void
  log?: WrapperLifecycleLog
  process?: ProcessLike
  stdin?: StreamLike
  parentPid?: number
  parentPollMs?: number
  currentParentPid?: () => number
  pidAlive?: (pid: number) => boolean
  setIntervalFn?: (callback: () => void, ms: number) => TimerLike
  clearIntervalFn?: (timer: TimerLike) => void
  exit?: (code: number) => never | void
}

export interface InstalledWrapperLifecycle {
  shutdown(reason: WrapperShutdownReason, details?: WrapperShutdownDetails): void
  dispose(): void
}

const DEFAULT_PARENT_POLL_MS = 5_000
const WATCHED_SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isMissingProcessError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ESRCH'
  )
}

function defaultPidAlive(proc: ProcessLike, pid: number): boolean {
  try {
    proc.kill(pid, 0)
    return true
  } catch (error) {
    if (isMissingProcessError(error)) return false
    return true
  }
}

export function installWrapperLifecycle(
  options: WrapperLifecycleOptions,
): InstalledWrapperLifecycle {
  const proc = options.process ?? process
  const stdin = options.stdin ?? proc.stdin
  const parentPid = options.parentPid ?? proc.ppid
  const parentPollMs = options.parentPollMs ?? DEFAULT_PARENT_POLL_MS
  const currentParentPid = options.currentParentPid ?? (() => proc.ppid)
  const pidAlive = options.pidAlive ?? ((pid: number) => defaultPidAlive(proc, pid))
  const setIntervalFn =
    options.setIntervalFn ?? ((callback: () => void, ms: number) => setInterval(callback, ms))
  const clearIntervalFn =
    options.clearIntervalFn ?? ((timer: TimerLike) => clearInterval(timer as NodeJS.Timeout))
  const exit = options.exit ?? ((code: number) => proc.exit(code))

  let shuttingDown = false
  let disposed = false
  let parentTimer: TimerLike | undefined
  const cleanupFns: Array<() => void> = []

  const dispose = () => {
    if (disposed) return
    disposed = true
    for (const cleanup of cleanupFns.splice(0)) cleanup()
    if (parentTimer) {
      clearIntervalFn(parentTimer)
      parentTimer = undefined
    }
  }

  const shutdown = (reason: WrapperShutdownReason, details: WrapperShutdownDetails = {}) => {
    if (shuttingDown) return
    shuttingDown = true
    dispose()
    options.log?.('info', 'wrapper lifecycle shutting down', { reason, ...details })
    Promise.resolve()
      .then(() => options.shutdown(reason, details))
      .then(() => exit(0))
      .catch((error: unknown) => {
        options.log?.('error', 'wrapper lifecycle shutdown failed', {
          reason,
          ...details,
          error: errorMessage(error),
        })
        exit(1)
      })
  }

  for (const signal of WATCHED_SIGNALS) {
    const listener = () => shutdown(signal)
    proc.on(signal, listener)
    cleanupFns.push(() => proc.off(signal, listener))
  }

  const onStdinEnd = () => shutdown('stdin-end')
  const onStdinClose = () => shutdown('stdin-close')
  const onStdinError = (error: unknown) => shutdown('stdin-error', { error: errorMessage(error) })
  stdin.on('end', onStdinEnd)
  stdin.on('close', onStdinClose)
  stdin.on('error', onStdinError)
  cleanupFns.push(() => {
    stdin.off('end', onStdinEnd)
    stdin.off('close', onStdinClose)
    stdin.off('error', onStdinError)
  })

  const onUncaughtException = (error: unknown) =>
    shutdown('uncaught-exception', { error: errorMessage(error) })
  const onUnhandledRejection = (error: unknown) =>
    shutdown('unhandled-rejection', { error: errorMessage(error) })
  proc.on('uncaughtException', onUncaughtException)
  proc.on('unhandledRejection', onUnhandledRejection)
  cleanupFns.push(() => {
    proc.off('uncaughtException', onUncaughtException)
    proc.off('unhandledRejection', onUnhandledRejection)
  })

  if (parentPid > 1 && parentPollMs > 0) {
    parentTimer = setIntervalFn(() => {
      const current = currentParentPid()
      if (current === 1) {
        shutdown('parent-reparented', { parentPid, currentParentPid: current })
        return
      }
      if (!pidAlive(parentPid)) {
        shutdown('parent-exit', { parentPid, currentParentPid: current })
      }
    }, parentPollMs)
    parentTimer.unref?.()
  }

  if (stdin.destroyed || stdin.readableEnded) {
    queueMicrotask(() => shutdown(stdin.destroyed ? 'stdin-close' : 'stdin-end'))
  }

  return { shutdown, dispose }
}
