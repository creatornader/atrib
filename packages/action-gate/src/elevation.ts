// SPDX-License-Identifier: Apache-2.0

import { evaluateAuthority, type AuthorityLevel } from '@atrib/verify'

export interface Corroborator {
  /** The verified signer key that licenses the value. Distinctness is by this string. */
  signer_key: string
  /** The authority of this corroborator. Only 'trusted' corroborators count toward elevation. */
  authority: AuthorityLevel
}

export interface ActionBoundToken {
  /** Opaque binding string over (tool, value, amount, nonce, timestamp). */
  binding: string
  /** True if the caller has confirmed the token is unspent. */
  fresh: boolean
}

export interface ElevationInput {
  /** The record_hash of the memory value driving the security-relevant field of the action. */
  drivingRecordHash: string
  /** The graph the driving record lives in, for authority evaluation. */
  graph: ReadonlyMap<string, { record_hash: string; informed_by?: string[] }>
  /** Origin authority function, same shape @atrib/verify expects. */
  originAuthority: (r: { record_hash: string; informed_by?: string[] }) => AuthorityLevel
  /** Independent corroborators presented for elevation. */
  corroborators?: Corroborator[]
  /** The binding string the current action computes, for token match. */
  actionBinding?: string
  /** A presented action-bound token, if any. */
  token?: ActionBoundToken
  /** Minimum distinct trusted signers required for elevation. Default 2. */
  elevationThreshold?: number
}

export type ElevationOutcome = 'allow' | 'escalate' | 'error'

export interface ElevationDecision {
  outcome: ElevationOutcome
  /** Which rule fired: 'trusted-origin' | 'elevated' | 'token' | 'uncorroborated'. */
  reason: string
  /** Effective authority of the driving value. */
  valueAuthority: AuthorityLevel
  /** Count of DISTINCT trusted signer keys that corroborated. */
  distinctTrustedCorroborators: number
}

export function evaluateElevation(input: ElevationInput): ElevationDecision {
  const drivingRecord = input.graph.get(input.drivingRecordHash)
  if (drivingRecord === undefined) {
    return {
      outcome: 'error',
      reason: 'driving-record-not-in-graph',
      valueAuthority: 'untrusted',
      distinctTrustedCorroborators: 0,
    }
  }

  const valueAuthority = evaluateAuthority(drivingRecord, input.graph, {
    originAuthority: input.originAuthority,
  }).authority
  const trustedSignerKeys = new Set(
    (input.corroborators ?? [])
      .filter((corroborator) => corroborator.authority === 'trusted')
      .map((corroborator) => corroborator.signer_key),
  )
  const distinctTrustedCorroborators = trustedSignerKeys.size

  if (valueAuthority === 'agent' || valueAuthority === 'trusted') {
    return {
      outcome: 'allow',
      reason: 'trusted-origin',
      valueAuthority,
      distinctTrustedCorroborators,
    }
  }

  if (distinctTrustedCorroborators >= (input.elevationThreshold ?? 2)) {
    return {
      outcome: 'allow',
      reason: 'elevated',
      valueAuthority,
      distinctTrustedCorroborators,
    }
  }

  if (
    input.token?.fresh === true &&
    typeof input.actionBinding === 'string' &&
    input.actionBinding.length > 0 &&
    input.token.binding === input.actionBinding
  ) {
    return {
      outcome: 'allow',
      reason: 'token',
      valueAuthority,
      distinctTrustedCorroborators,
    }
  }

  return {
    outcome: 'escalate',
    reason: 'uncorroborated',
    valueAuthority,
    distinctTrustedCorroborators,
  }
}
