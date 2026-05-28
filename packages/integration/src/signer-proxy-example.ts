// SPDX-License-Identifier: Apache-2.0

import {
  EVENT_TYPE_TOOL_CALL_URI,
  base64urlEncode,
  canonicalRecord,
  computeContentId,
  genesisChainRoot,
  getPublicKey,
  hexEncode,
  sha256,
  signRecord,
} from '@atrib/mcp'
import type { AtribRecord } from '@atrib/mcp'

export type SandboxUnsignedRecord = Omit<AtribRecord, 'creator_key' | 'signature' | 'signers'>

export interface SandboxSigningRequest {
  reason: string
  unsignedRecord: SandboxUnsignedRecord
  sidecar?: {
    args: unknown
    result: unknown
    tool_name: string
  }
}

export type SignerProxyResponse =
  | {
      ok: true
      creator_key: string
      record: AtribRecord
      record_hash: string
    }
  | {
      ok: false
      error: string
    }

export type HostSigningPolicy = (input: {
  record: AtribRecord
  request: SandboxSigningRequest
}) => { ok: true } | { ok: false; error: string } | Promise<{ ok: true } | { ok: false; error: string }>

export interface HostSignerProxy {
  creatorKey(): Promise<string>
  sign(request: SandboxSigningRequest): Promise<SignerProxyResponse>
}

export function createHostSignerProxy(options: {
  privateKey: Uint8Array
  policy?: HostSigningPolicy
  submitRecord?: (record: AtribRecord) => Promise<void>
}): HostSignerProxy {
  const privateKey = new Uint8Array(options.privateKey)
  const creatorKeyReady = getPublicKey(privateKey).then(base64urlEncode)

  return Object.freeze({
    async creatorKey(): Promise<string> {
      return creatorKeyReady
    },

    async sign(request: SandboxSigningRequest): Promise<SignerProxyResponse> {
      const raw = request.unsignedRecord as Record<string, unknown>
      const forbidden = ['creator_key', 'signature', 'signers'].filter((field) =>
        Object.hasOwn(raw, field),
      )
      if (forbidden.length > 0) {
        return {
          ok: false,
          error: `sandbox request included signer-controlled field(s): ${forbidden.join(', ')}`,
        }
      }

      const creatorKey = await creatorKeyReady
      const record = {
        ...request.unsignedRecord,
        creator_key: creatorKey,
        signature: '',
      } as AtribRecord

      const policyDecision = options.policy
        ? await options.policy({ record, request })
        : { ok: true as const }
      if (!policyDecision.ok) return policyDecision

      const signed = await signRecord(record, privateKey)
      try {
        const submission = options.submitRecord?.(signed)
        if (submission) void submission.catch(() => {})
      } catch {
        // Optional submission must not affect the signing path.
      }

      return {
        ok: true,
        creator_key: creatorKey,
        record: signed,
        record_hash: `sha256:${hexEncode(sha256(canonicalRecord(signed)))}`,
      }
    },
  })
}

export function createSandboxSignerClient(options: {
  contextId: string
  serverUrl: string
  signer: HostSignerProxy
}) {
  return Object.freeze({
    async signToolCall(input: {
      args: unknown
      chainRoot?: string
      result: unknown
      timestamp?: number
      toolName: string
    }): Promise<SignerProxyResponse> {
      const unsignedRecord: SandboxUnsignedRecord = {
        chain_root: input.chainRoot ?? genesisChainRoot(options.contextId),
        content_id: computeContentId(options.serverUrl, input.toolName),
        context_id: options.contextId,
        event_type: EVENT_TYPE_TOOL_CALL_URI,
        spec_version: 'atrib/1.0',
        timestamp: input.timestamp ?? Date.now(),
      }

      return options.signer.sign({
        reason: `tool_call:${input.toolName}`,
        sidecar: {
          args: input.args,
          result: input.result,
          tool_name: input.toolName,
        },
        unsignedRecord,
      })
    },
  })
}
