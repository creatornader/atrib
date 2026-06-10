// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'

describe('production endpoint fetch guard', () => {
  it('blocks accidental production log fetches inside integration tests', () => {
    expect(() => fetch('https://log.atrib.dev/v1/checkpoint')).toThrow(
      '[atrib integration test guard] refusing to fetch production endpoint',
    )
  })

  it('blocks accidental production archive fetches inside integration tests', () => {
    expect(() => fetch('https://archive.atrib.dev/v1/record/sha256:test')).toThrow(
      '[atrib integration test guard] refusing to fetch production endpoint',
    )
  })
})
