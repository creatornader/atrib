// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import * as ed from '@noble/ed25519'
import { sha512 } from '@noble/hashes/sha2.js'
import {
  verifyWitnessRetirement,
  witnessRetirementSigningInput,
  type UnsignedWitnessRetirement,
} from '../src/index.js'

ed.hashes.sha512 = sha512
ed.hashes.sha512Async = (message) => Promise.resolve(sha512(message))

const SEED = new Uint8Array(32).fill(31)

describe('witness retirement verification', () => {
  it('verifies a JCS-bound retirement artifact', async () => {
    const unsigned = await unsignedRetirement()
    const signature = await ed.signAsync(witnessRetirementSigningInput(unsigned), SEED)
    const result = await verifyWitnessRetirement({
      ...unsigned,
      signature: Buffer.from(signature).toString('base64url'),
    })

    expect(result).toMatchObject({
      valid: true,
      retirement: {
        witness_name: 'witness.example.org',
        epoch: 1,
      },
    })
  })

  it('rejects tampering and unknown fields', async () => {
    const unsigned = await unsignedRetirement()
    const signature = await ed.signAsync(witnessRetirementSigningInput(unsigned), SEED)
    const artifact = {
      ...unsigned,
      signature: Buffer.from(signature).toString('base64url'),
    }

    await expect(verifyWitnessRetirement({ ...artifact, epoch: 2 })).resolves.toMatchObject({
      valid: false,
      reason: 'witness retirement signature is invalid',
    })
    await expect(
      verifyWitnessRetirement({ ...artifact, endpoint: 'https://witness.example.org' }),
    ).resolves.toMatchObject({
      valid: false,
      reason: 'witness retirement contains an unknown field',
    })
  })
})

async function unsignedRetirement(): Promise<UnsignedWitnessRetirement> {
  return {
    schema: 'atrib.witness-retirement.v1',
    witness_name: 'witness.example.org',
    epoch: 1,
    public_key: Buffer.from(await ed.getPublicKeyAsync(SEED)).toString('base64url'),
    retired_at: '2026-10-25T00:00:00.000Z',
    reason: 'operator ended the pilot',
  }
}
