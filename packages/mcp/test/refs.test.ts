import { describe, expect, it } from 'vitest'
import { extractRecordHashes, extractRecordReferenceCandidates } from '../src/refs.js'

const RECORD_A = 'sha256:' + 'a'.repeat(64)
const RECORD_B = 'sha256:' + 'b'.repeat(64)
const RECORD_C = 'sha256:' + 'c'.repeat(64)
const RECORD_D = 'sha256:' + 'd'.repeat(64)
const RECORD_E = 'sha256:' + 'e'.repeat(64)
const RECORD_F = 'sha256:' + 'f'.repeat(64)

describe('record reference extraction', () => {
  it('keeps broad extraction available for callers that need prose scanning', () => {
    expect(
      [...extractRecordHashes({ content: `mentioned ${RECORD_A}`, args_hash: RECORD_B })].sort(),
    ).toEqual([RECORD_A, RECORD_B])
  })

  it('extracts auto-detect candidates only from structured record-reference fields', () => {
    const candidates = extractRecordReferenceCandidates({
      name: 'emit',
      arguments: {
        content: {
          what: `mentioned ${RECORD_A}`,
        },
        informed_by: [RECORD_B],
        record_hash: RECORD_C,
        args_hash: RECORD_D,
        result_hash: RECORD_E,
        nested: {
          accepted_record_hashes: [RECORD_F],
          metadata: {
            message_envelope: {
              informed_by: RECORD_A,
            },
          },
        },
      },
    })

    expect([...candidates].sort()).toEqual([RECORD_C, RECORD_F])
  })

  it('extracts annotation and revision target fields as record-reference candidates', () => {
    expect(
      [
        ...extractRecordReferenceCandidates({
          arguments: {
            annotates: RECORD_A,
            revises: RECORD_B,
          },
        }),
      ].sort(),
    ).toEqual([RECORD_A, RECORD_B])
  })
})
