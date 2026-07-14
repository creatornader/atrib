// SPDX-License-Identifier: Apache-2.0

import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  buildSessionTranscriptProof,
  manifestSessionTranscriptFile,
} from '../../src/session-transcript-runtime-log.js'

const inputPath = process.argv.slice(2).find((arg: string) => arg !== '--')

if (inputPath) {
  const window = await manifestSessionTranscriptFile(inputPath)
  console.log(
    JSON.stringify({
      ok: window.verification.valid,
      strategy: 'session-transcript-runtime-log-v0',
      manifest_hashes: { main: window.verification.manifest_hash },
      event_counts: { main: window.manifest.event_count },
      checks: window.verification.checks,
      issue_codes: window.verification.issues.map((issue) => issue.code),
      privacy: {
        raw_bodies_in_jsonl: true,
        manifests_are_hash_only: true,
        public_log_not_required: true,
      },
    }),
  )
} else {
  const proof = await buildSessionTranscriptProof(
    await mkdtemp(join(tmpdir(), 'atrib-session-transcript-runtime-log-smoke-')),
  )
  console.log(
    JSON.stringify({
      ok: proof.ok,
      strategy: proof.strategy,
      manifest_hashes: proof.manifest_hashes,
      event_counts: {
        main: proof.main.manifest.event_count,
        fork: proof.fork.manifest.event_count,
        continuation: proof.continuation.manifest.event_count,
      },
      checks: {
        main: proof.main.verification.checks,
        fork: proof.fork.verification.checks,
        continuation: proof.continuation.verification.checks,
        signed_records: proof.signed_records.every((record) => record.signature_verified),
      },
      issue_codes: [
        ...proof.main.verification.issues,
        ...proof.fork.verification.issues,
        ...proof.continuation.verification.issues,
      ].map((issue) => issue.code),
      privacy: proof.privacy,
    }),
  )
}
