// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { checkpointRecallCancellation } from '../src/cancellation.js'

describe('recall cancellation checkpoint', () => {
  it('observes cancellation at the next cooperative phase boundary', async () => {
    const controller = new AbortController()
    const reason = new Error('operator cancelled recall')
    const checkpoint = checkpointRecallCancellation(controller.signal)
    controller.abort(reason)

    await expect(checkpoint).rejects.toBe(reason)
  })

  it('continues when the request remains active', async () => {
    await expect(
      checkpointRecallCancellation(new AbortController().signal),
    ).resolves.toBeUndefined()
  })
})
