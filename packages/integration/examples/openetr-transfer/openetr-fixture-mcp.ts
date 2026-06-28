// SPDX-License-Identifier: Apache-2.0

import { readFileSync } from 'node:fs'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'

const PRIVATE_OBJECT_DIGEST =
  'sha256:7f4b8b8e2f394fddad1ed04e94c456ff0c8fb7ee6f0c5d5017deac9a0f61d425'
const PRIVATE_DOCUMENT_TITLE = 'private warehouse receipt WR-2026-0628'
const PRIVATE_ISSUER_NPUB = 'npub1privateissueropenetr20260628'
const PRIVATE_BUYER_NPUB = 'npub1privatebuyeropenetr20260628'
const PRIVATE_RELAY = 'wss://relay.openetr.example/private-transfer'
const PRIVATE_ORIGIN_EVENT_ID = '1111111111111111111111111111111111111111111111111111111111111111'
const PRIVATE_INITIATE_EVENT_ID = '2222222222222222222222222222222222222222222222222222222222222222'
const PRIVATE_ACCEPT_EVENT_ID = '3333333333333333333333333333333333333333333333333333333333333333'

type SourceEvent = {
  id?: unknown
  kind?: unknown
  pubkey?: unknown
  tags?: unknown
  content?: unknown
}

type SourceRun = {
  schema?: unknown
  source?: { commit?: unknown; entrypoints?: unknown }
  runtime?: Record<string, unknown>
  object?: { digest?: unknown }
  parties?: {
    issuer_npub?: unknown
    issuer_pubkey_hex?: unknown
    buyer_npub?: unknown
    buyer_pubkey_hex?: unknown
  }
  events?: {
    origin?: SourceEvent
    initiate?: SourceEvent
    accept?: SourceEvent
  }
  query?: Record<string, unknown>
  checks?: Record<string, unknown>
  warnings?: unknown
}

function textJson(value: unknown): { content: Array<{ type: 'text'; text: string }> } {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] }
}

function toolSchema(name: string, properties: Record<string, unknown>, required: string[] = []) {
  return {
    name,
    inputSchema: {
      type: 'object',
      properties,
      required,
      additionalProperties: false,
    },
  }
}

function loadSourceRun(): SourceRun | null {
  const sourceRunPath = process.env.OPENETR_SOURCE_RUN_JSON
  if (!sourceRunPath) return null
  return JSON.parse(readFileSync(sourceRunPath, 'utf8')) as SourceRun
}

function eventTagValue(event: SourceEvent | undefined, tagName: string): string | null {
  const tags = event?.tags
  if (!Array.isArray(tags)) return null
  for (const tag of tags) {
    if (Array.isArray(tag) && tag.length > 1 && tag[0] === tagName && typeof tag[1] === 'string') {
      return tag[1]
    }
  }
  return null
}

async function main(): Promise<void> {
  const server = new McpServer(
    { name: 'openetr-transfer-fixture', version: '0.1.0' },
    { capabilities: { tools: {} } },
  )

  // The upstream OpenETR project currently exposes a CLI and HTTP demo, not an
  // MCP server. This fixture gives atrib a stable MCP-shaped proof boundary
  // while preserving the OpenETR action vocabulary and private payload classes.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const underlying = (server as any).server
  const sourceRun = loadSourceRun()

  const tools = [
    toolSchema(
      'openetr_issue',
      {
        object_digest: { type: 'string' },
        document_title: { type: 'string' },
        issuer_npub: { type: 'string' },
        relays: { type: 'array', items: { type: 'string' } },
      },
      ['object_digest', 'issuer_npub'],
    ),
    toolSchema(
      'openetr_transfer_initiate',
      {
        object_digest: { type: 'string' },
        prior_event_id: { type: 'string' },
        transferee_npub: { type: 'string' },
      },
      ['object_digest', 'prior_event_id', 'transferee_npub'],
    ),
    toolSchema(
      'openetr_transfer_accept',
      {
        object_digest: { type: 'string' },
        initiate_event_id: { type: 'string' },
        acceptor_npub: { type: 'string' },
      },
      ['object_digest', 'initiate_event_id', 'acceptor_npub'],
    ),
    toolSchema(
      'openetr_query_state',
      {
        object_digest: { type: 'string' },
        relays: { type: 'array', items: { type: 'string' } },
      },
      ['object_digest'],
    ),
  ]

  underlying.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }))
  underlying.setRequestHandler(
    CallToolRequestSchema,
    async (req: { params: { name: string; arguments?: Record<string, unknown> } }) => {
      const args = req.params.arguments ?? {}
      const objectDigest =
        typeof args.object_digest === 'string' ? args.object_digest : PRIVATE_OBJECT_DIGEST

      if (req.params.name === 'openetr_issue') {
        if (sourceRun) {
          const origin = sourceRun.events?.origin
          return textJson({
            status: 'published',
            source_backed: true,
            openetr_source_commit: sourceRun.source?.commit,
            openetr_entrypoint: 'openetr.services.issue_etr.publish_issue_etr',
            action: 'issue',
            kind: origin?.kind,
            object_digest: sourceRun.object?.digest,
            issuer_npub: sourceRun.parties?.issuer_npub,
            origin_event_id: origin?.id,
            raw_event: origin,
          })
        }
        return textJson({
          status: 'published',
          action: 'issue',
          kind: 31415,
          object_digest: objectDigest,
          document_title:
            typeof args.document_title === 'string' ? args.document_title : PRIVATE_DOCUMENT_TITLE,
          issuer_npub:
            typeof args.issuer_npub === 'string' ? args.issuer_npub : PRIVATE_ISSUER_NPUB,
          relays: Array.isArray(args.relays) ? args.relays : [PRIVATE_RELAY],
          origin_event_id: PRIVATE_ORIGIN_EVENT_ID,
        })
      }

      if (req.params.name === 'openetr_transfer_initiate') {
        if (sourceRun) {
          const initiate = sourceRun.events?.initiate
          return textJson({
            status: 'published',
            source_backed: true,
            openetr_source_commit: sourceRun.source?.commit,
            openetr_entrypoint: 'openetr.commands.publish.transfer initiate',
            action: 'initiate',
            kind: initiate?.kind,
            object_digest: sourceRun.object?.digest,
            prior_event_id: eventTagValue(initiate, 'e'),
            transferee_pubkey_hex: eventTagValue(initiate, 'p'),
            transfer_event_id: initiate?.id,
            raw_event: initiate,
          })
        }
        return textJson({
          status: 'published',
          action: 'initiate',
          kind: 31416,
          object_digest: objectDigest,
          prior_event_id:
            typeof args.prior_event_id === 'string' ? args.prior_event_id : PRIVATE_ORIGIN_EVENT_ID,
          transferee_npub:
            typeof args.transferee_npub === 'string' ? args.transferee_npub : PRIVATE_BUYER_NPUB,
          transfer_event_id: PRIVATE_INITIATE_EVENT_ID,
          p_tag_semantics: 'transferee',
        })
      }

      if (req.params.name === 'openetr_transfer_accept') {
        if (sourceRun) {
          const accept = sourceRun.events?.accept
          return textJson({
            status: 'published',
            source_backed: true,
            openetr_source_commit: sourceRun.source?.commit,
            openetr_entrypoint: 'openetr.commands.publish.transfer accept',
            action: 'accept',
            kind: accept?.kind,
            object_digest: sourceRun.object?.digest,
            initiate_event_id: eventTagValue(accept, 'e'),
            acceptor_npub: sourceRun.parties?.buyer_npub,
            accept_event_id: accept?.id,
            accept_p_tag_pubkey_hex: eventTagValue(accept, 'p'),
            raw_event: accept,
          })
        }
        return textJson({
          status: 'published',
          action: 'accept',
          kind: 31416,
          object_digest: objectDigest,
          initiate_event_id:
            typeof args.initiate_event_id === 'string'
              ? args.initiate_event_id
              : PRIVATE_INITIATE_EVENT_ID,
          acceptor_npub:
            typeof args.acceptor_npub === 'string' ? args.acceptor_npub : PRIVATE_BUYER_NPUB,
          accept_event_id: PRIVATE_ACCEPT_EVENT_ID,
          p_tag_semantics: 'initiator_reference_after_accept',
        })
      }

      if (req.params.name === 'openetr_query_state') {
        if (sourceRun) {
          const accept = sourceRun.events?.accept
          return textJson({
            status: 'queried',
            source_backed: true,
            openetr_source_commit: sourceRun.source?.commit,
            openetr_entrypoint: 'openetr.services.query_etr.build_query_etr_result',
            object_digest: sourceRun.object?.digest,
            latest_event_id: accept?.id,
            query: sourceRun.query,
            checks: sourceRun.checks,
            warnings: [
              ...(Array.isArray(sourceRun.warnings) ? sourceRun.warnings : []),
              {
                id: 'ambiguous_controller_warning',
                severity: 'review_required',
                detail:
                  'Source-backed OpenETR query reports the initiator after accept; recognition remains gated.',
              },
            ],
          })
        }
        return textJson({
          status: 'queried',
          object_digest: objectDigest,
          origin_event_id: PRIVATE_ORIGIN_EVENT_ID,
          latest_event_id: PRIVATE_ACCEPT_EVENT_ID,
          expected_controller_npub: PRIVATE_BUYER_NPUB,
          latest_p_tag_npub: PRIVATE_ISSUER_NPUB,
          relay: PRIVATE_RELAY,
          warnings: [
            {
              id: 'ambiguous_controller_warning',
              severity: 'review_required',
              detail:
                'Latest accept event p tag points at the initiator while the expected controller is the acceptor.',
            },
          ],
        })
      }

      return {
        isError: true,
        content: [{ type: 'text', text: `unknown tool: ${req.params.name}` }],
      }
    },
  )

  await server.connect(new StdioServerTransport())
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
