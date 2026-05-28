#!/usr/bin/env node
/* eslint-disable no-console */
import { runAp2LiveInteropFromEnv } from '../src/ap2-live-interop.js'

try {
  const summary = await runAp2LiveInteropFromEnv()
  console.log(
    JSON.stringify(
      {
        ok: summary.ok,
        errors: summary.errors,
        detection: summary.detection,
        evidence_valid: summary.evidence?.valid,
        transaction_accepted: summary.evidence?.transactionAccepted,
      },
      null,
      2,
    ),
  )
  if (!summary.ok) process.exitCode = 1
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  console.error(message)
  process.exitCode = 1
}
