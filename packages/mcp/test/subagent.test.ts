import { describe, expect, it } from 'vitest'
import {
  ATRIB_CONTEXT_ID_ENV,
  buildSubagentProducerEnv,
  chainTailEnvName,
} from '../src/subagent.js'
import { ATRIB_PARENT_RECORD_HASH_ENV } from '../src/refs.js'

const CTX = '4bf92f3577b34da6a3ce929d0e0e4736'
const PARENT = `sha256:${'a'.repeat(64)}`
const TAIL = `sha256:${'b'.repeat(64)}`

describe('subagent producer env helpers', () => {
  it('builds the canonical same-session child producer env bundle', () => {
    const env = buildSubagentProducerEnv({
      contextId: CTX,
      parentRecordHash: PARENT,
      baseEnv: {
        PATH: '/usr/bin',
        EMPTY: undefined,
      },
    })

    expect(env).toEqual({
      PATH: '/usr/bin',
      [ATRIB_CONTEXT_ID_ENV]: CTX,
      [ATRIB_PARENT_RECORD_HASH_ENV]: PARENT,
      [`ATRIB_CHAIN_TAIL_${CTX}`]: PARENT,
    })
  })

  it('allows a fresher chain tail than the parent dispatch hash', () => {
    const env = buildSubagentProducerEnv({
      contextId: CTX,
      parentRecordHash: PARENT,
      chainTailRecordHash: TAIL,
    })

    expect(env[ATRIB_PARENT_RECORD_HASH_ENV]).toBe(PARENT)
    expect(env[`ATRIB_CHAIN_TAIL_${CTX}`]).toBe(TAIL)
  })

  it('drops malformed attribution hints without dropping unrelated env', () => {
    const env = buildSubagentProducerEnv({
      contextId: CTX.toUpperCase(),
      parentRecordHash: `sha256:${'A'.repeat(64)}`,
      chainTailRecordHash: 'not-a-hash',
      baseEnv: { HOME: '/tmp/test-home' },
    })

    expect(env).toEqual({ HOME: '/tmp/test-home' })
  })

  it('names chain-tail env vars only for canonical context ids', () => {
    expect(chainTailEnvName(CTX)).toBe(`ATRIB_CHAIN_TAIL_${CTX}`)
    expect(chainTailEnvName(CTX.toUpperCase())).toBeUndefined()
    expect(chainTailEnvName('abc')).toBeUndefined()
  })
})
