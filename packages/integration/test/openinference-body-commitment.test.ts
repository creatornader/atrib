// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { BasicTracerProvider } from '@opentelemetry/sdk-trace-base'
import { SemanticConventions } from '@arizeai/openinference-semantic-conventions'
import {
  base64urlEncode,
  canonicalRecord,
  getPublicKey,
  hexEncode,
  sha256,
  type AtribRecord,
} from '@atrib/mcp'
import { AtribSpanProcessor } from '@atrib/openinference'
import { handoffClaimsFromEvidencePacket, verifyHandoffClaims } from '@atrib/verify'

const TEST_KEY_BYTES = new Uint8Array(32).fill(9)

function recordHash(record: AtribRecord): string {
  return `sha256:${hexEncode(sha256(canonicalRecord(record)))}`
}

describe('OpenInference body commitments', () => {
  it('replays args_hash and result_hash from supplied body material', async () => {
    const submitted: AtribRecord[] = []
    const creatorKey = base64urlEncode(await getPublicKey(TEST_KEY_BYTES))
    const processor = new AtribSpanProcessor({
      privateKey: TEST_KEY_BYTES,
      creatorKey,
      serverUrl: 'https://example.test/atrib-openinference-body',
      submit: (record) => {
        submitted.push(record)
      },
      argsResultHashPosture: 'plain',
    })
    const provider = new BasicTracerProvider({ spanProcessors: [processor] })
    const tracer = provider.getTracer('openinference-body-commitment-test')

    const span = tracer.startSpan('get_weather')
    span.setAttribute(SemanticConventions.OPENINFERENCE_SPAN_KIND, 'TOOL')
    span.setAttribute(SemanticConventions.TOOL_NAME, 'get_weather')
    span.setAttribute(SemanticConventions.INPUT_VALUE, '{"city":"Austin","units":"fahrenheit"}')
    span.setAttribute(SemanticConventions.OUTPUT_VALUE, '{"forecast":"clear","temp":64}')
    span.end()

    await processor.forceFlush()
    await provider.shutdown()

    const record = submitted[0]!
    expect(record.args_hash).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(record.result_hash).toMatch(/^sha256:[a-f0-9]{64}$/)

    const packet = {
      records: [
        {
          record_hash: recordHash(record),
          record,
          args: { units: 'fahrenheit', city: 'Austin' },
          result: { temp: 64, forecast: 'clear' },
        },
      ],
    }
    const accepted = await verifyHandoffClaims(handoffClaimsFromEvidencePacket(packet), {
      require_body: true,
      require_body_commitment: true,
    })

    expect(accepted.all_accepted).toBe(true)
    expect(accepted.accepted[0]?.body?.args_hash_ok).toBe(true)
    expect(accepted.accepted[0]?.body?.result_hash_ok).toBe(true)

    const tampered = await verifyHandoffClaims(
      handoffClaimsFromEvidencePacket({
        records: [
          {
            record_hash: recordHash(record),
            record,
            args: { city: 'Austin', units: 'fahrenheit' },
            result: { forecast: 'rain', temp: 64 },
          },
        ],
      }),
      {
        require_body: true,
        require_body_commitment: true,
      },
    )

    expect(tampered.all_accepted).toBe(false)
    expect(tampered.rejected[0]?.rejection_reasons).toContain('body_hash_mismatch')
  })
})
