// SPDX-License-Identifier: Apache-2.0

export interface DpopReplayCacheKey {
  jti: string
  jkt?: string | null
  htm?: string | null
  htu?: string | null
  issuer?: string | null
  client_id?: string | null
}

export interface DpopReplayCache {
  /**
   * Atomically remember this proof key until `expiresAtSeconds`.
   *
   * Returns true when the key was new and is now stored. Returns false when
   * the key was already present and unexpired. Deployments can back this with
   * Redis, Durable Objects, Postgres, or any other shared compare-and-set
   * primitive. The in-memory implementation below is process-local only.
   */
  checkAndRemember(
    key: DpopReplayCacheKey,
    expiresAtSeconds: number,
  ): boolean | Promise<boolean>
}

export interface MemoryDpopReplayCacheOptions {
  maxEntries?: number
  nowSeconds?: () => number
}

export class MemoryDpopReplayCache implements DpopReplayCache {
  private readonly entries = new Map<string, number>()
  private readonly maxEntries: number
  private readonly nowSeconds: () => number

  constructor(options: MemoryDpopReplayCacheOptions = {}) {
    this.maxEntries = options.maxEntries ?? 10_000
    this.nowSeconds = options.nowSeconds ?? (() => Math.floor(Date.now() / 1000))
  }

  checkAndRemember(key: DpopReplayCacheKey, expiresAtSeconds: number): boolean {
    const now = this.nowSeconds()
    this.prune(now)
    const id = dpopReplayCacheKeyId(key)
    const existingExpiry = this.entries.get(id)
    if (existingExpiry !== undefined && existingExpiry > now) return false
    this.entries.set(id, Math.max(expiresAtSeconds, now + 1))
    this.pruneToMax()
    return true
  }

  size(): number {
    this.prune(this.nowSeconds())
    return this.entries.size
  }

  private prune(now: number): void {
    for (const [key, expiresAt] of this.entries) {
      if (expiresAt <= now) this.entries.delete(key)
    }
  }

  private pruneToMax(): void {
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value
      if (oldest === undefined) return
      this.entries.delete(oldest)
    }
  }
}

export function dpopReplayCacheKeyId(key: DpopReplayCacheKey): string {
  return JSON.stringify({
    issuer: key.issuer ?? null,
    client_id: key.client_id ?? null,
    jkt: key.jkt ?? null,
    htm: key.htm ?? null,
    htu: key.htu ?? null,
    jti: key.jti,
  })
}
