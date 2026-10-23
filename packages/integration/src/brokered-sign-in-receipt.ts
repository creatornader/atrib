// SPDX-License-Identifier: Apache-2.0

import { randomBytes } from 'node:crypto'
import { canonicalRecord, hexEncode, sha256, verifyRecord } from '@atrib/mcp'
import type { AtribRecord } from '@atrib/mcp'
import { BrowserWorkflowReceiptRecorder } from './browser-workflow-receipt.js'
import type { BrowserWorkflowSidecar } from './browser-workflow-receipt.js'

/**
 * Brokered sign-in receipt proof.
 *
 * A credential broker releases a login into a page on the agent's behalf, so
 * the agent never holds the value. The agent records the broker's outcome as
 * its own signed tool_call, and every later action cites that record through
 * `informed_by`. The broker here is a local fixture. Its outcome is a
 * caller-attested claim: no broker artifact is verified.
 */

export type BrokerOutcome = 'granted' | 'denied'

export type BrokerApprover = (request: {
  task: string
  item_hint: string
}) => BrokerOutcome | Promise<BrokerOutcome>

/** Simulated broker. It holds the credential and fills it into the page itself. */
export class FixtureCredentialBroker {
  readonly brokerType = 'fixture-broker'

  constructor(
    private readonly credential: string,
    private readonly approver: BrokerApprover,
    private readonly available = true,
  ) {}

  async release(
    request: { task: string; item_hint: string },
    page: FixtureSignInPage,
  ): Promise<{ outcome: BrokerOutcome }> {
    if (!this.available) throw new Error('fixture broker unavailable')
    const outcome = await this.approver(request)
    if (outcome === 'granted') page.fillPasswordFromBroker(this.credential)
    return { outcome }
  }
}

export class FixtureSignInPage {
  private password = ''
  private signedIn = false

  constructor(readonly url: string) {}

  /** Only the broker calls this. The agent never sees the argument. */
  fillPasswordFromBroker(value: string): void {
    this.password = value
  }

  observe(): { url: string; signed_in: boolean; password_field_filled: boolean } {
    return { url: this.url, signed_in: this.signedIn, password_field_filled: this.password !== '' }
  }

  submit(): { status: 'signed-in'; session: string } {
    if (this.password === '') throw new Error('password field is empty')
    this.signedIn = true
    return { status: 'signed-in', session: 'fixture-session-001' }
  }
}

export interface BrokeredSignInOptions {
  outcome?: BrokerOutcome
  brokerAvailable?: boolean
  /** Per-record salt for the item commitment. Random when omitted. */
  itemSalt?: Uint8Array
}

export interface BrokeredSignInResult {
  ok: true
  note: string
  broker_outcome: BrokerOutcome | 'unavailable'
  signed_records: number
  operations: string[]
  credential_record_hash: string
  later_actions_cite_credential_record: boolean
  item_commitment: string
  privacy: {
    credential_absent_from_records: true
    credential_absent_from_sidecars: true
    site_and_item_local_only: true
  }
  records: AtribRecord[]
  sidecars: BrowserWorkflowSidecar[]
  caveats: string[]
}

/** Canary value. Tests assert it never appears in any output. */
export const FIXTURE_CREDENTIAL = 'canary-credential-7f3a9d'

export async function runBrokeredSignInReceiptSmoke(
  options: BrokeredSignInOptions = {},
): Promise<BrokeredSignInResult> {
  const privateKey = new Uint8Array(32).fill(29)
  const contextId = '62726f6b657265642d7369676e2d696e'
  const pageUrl = 'https://demo.browser-agent.local/sign-in'
  const itemRef = 'fixture-item:demo-account'
  const salt = options.itemSalt ?? randomBytes(16)
  const itemCommitment = `sha256:${hexEncode(sha256(new Uint8Array([...salt, ...new TextEncoder().encode(itemRef)])))}`
  const page = new FixtureSignInPage(pageUrl)
  const broker = new FixtureCredentialBroker(
    FIXTURE_CREDENTIAL,
    () => options.outcome ?? 'granted',
    options.brokerAvailable ?? true,
  )
  const recorder = new BrowserWorkflowReceiptRecorder({
    privateKey,
    contextId,
    serverUrl: 'browser-workflow://brokered-sign-in',
    logSubmission: 'disabled',
    now: timestampClock(1_779_840_300_000),
  })

  let brokerOutcome: BrokerOutcome | 'unavailable' = 'unavailable'
  try {
    const released = await recorder.action({
      operation: 'credential',
      pageUrl,
      args: {
        broker_type: broker.brokerType,
        simulated: true,
        item_commitment: itemCommitment,
        task: 'sign in to read the demo dashboard',
      },
      run: () =>
        broker.release({ task: 'sign in to read the demo dashboard', item_hint: itemRef }, page),
    })
    brokerOutcome = released.outcome
  } catch {
    // The broker failed. The agent stops here; atrib recorded the error outcome.
  }

  const credentialRecordHash = recorder.getLastRecordHash()
  if (!credentialRecordHash) throw new Error('credential outcome was not signed')

  if (brokerOutcome === 'granted') {
    const informedBy = [credentialRecordHash]
    await recorder.action({
      operation: 'submit',
      pageUrl,
      args: { page_url: pageUrl, selector: '#sign-in' },
      informedBy,
      run: () => page.submit(),
    })
    await recorder.action({
      operation: 'observe',
      pageUrl,
      args: { page_url: pageUrl },
      informedBy,
      run: () => page.observe(),
    })
  }

  await recorder.flushAtrib()
  const records = recorder.getSignedRecords()
  const sidecars = recorder.getSidecars()
  for (const record of records) {
    if (!(await verifyRecord(record))) throw new Error(`invalid signed record: ${record.tool_name}`)
  }
  if (JSON.stringify(records).includes(FIXTURE_CREDENTIAL)) {
    throw new Error('signed records leaked the credential')
  }
  if (JSON.stringify(sidecars).includes(FIXTURE_CREDENTIAL)) {
    throw new Error('local sidecars leaked the credential')
  }
  const publicJson = JSON.stringify(records)
  if (publicJson.includes(pageUrl) || publicJson.includes(itemRef)) {
    throw new Error('signed records leaked the site or item reference')
  }

  const later = records.slice(1)
  return {
    ok: true,
    note: 'Signs a simulated broker sign-in: the broker fills the login, the agent signs the outcome, and later actions cite it through informed_by.',
    broker_outcome: brokerOutcome,
    signed_records: records.length,
    operations: records.map((record) => record.tool_name ?? ''),
    credential_record_hash: credentialRecordHash,
    later_actions_cite_credential_record:
      later.length > 0 &&
      later.every((record) => record.informed_by?.includes(credentialRecordHash)),
    item_commitment: itemCommitment,
    privacy: {
      credential_absent_from_records: true,
      credential_absent_from_sidecars: true,
      site_and_item_local_only: true,
    },
    records,
    sidecars,
    caveats: [
      'The broker is a local fixture. No real credential broker is called.',
      "The broker outcome is the agent's own claim. No broker artifact is verified.",
      'Records are local only; nothing is submitted to a public log.',
    ],
  }
}

export function recordHash(record: AtribRecord): string {
  return `sha256:${hexEncode(sha256(canonicalRecord(record)))}`
}

function timestampClock(start: number): () => number {
  let offset = 0
  return () => start + offset++
}
