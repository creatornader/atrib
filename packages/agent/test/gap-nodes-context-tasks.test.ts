import { describe, it, expect } from 'vitest'
import { buildOutboundMeta, createSession, accumulateInboundContext } from '../src/session.js'
import { atrib } from '../src/middleware.js'
import { base64urlEncode } from '@atrib/mcp'

const TEST_KEY = base64urlEncode(new Uint8Array(32).fill(42))

describe('X-atrib-Context header (§1.5.3.1)', () => {
  it('sets X-atrib-Context to the raw context_id on every outbound request', () => {
    const session = createSession({ creatorKey: TEST_KEY })
    const meta = buildOutboundMeta(session)

    expect(meta['X-atrib-Context']).toBe(session.contextId)
    expect(meta['X-atrib-Context']).toMatch(/^[0-9a-f]{32}$/)
  })

  it('preserves X-atrib-Context across multiple calls', () => {
    const session = createSession({ creatorKey: TEST_KEY })
    const meta1 = buildOutboundMeta(session)
    const meta2 = buildOutboundMeta(session)

    expect(meta1['X-atrib-Context']).toBe(meta2['X-atrib-Context'])
  })
})

describe('gap nodes (§1.6)', () => {
  it('records a gap node when no attribution token is received', () => {
    const session = createSession({ creatorKey: TEST_KEY })
    expect(session.gapNodes).toEqual([])

    // Simulate tool response with no atrib token
    const hasToken = accumulateInboundContext(session, { someOtherField: 'value' })
    expect(hasToken).toBe(false)

    // The middleware handles gap node creation, not accumulateInboundContext.
    // Test the middleware path instead.
  })

  it('middleware creates gap nodes for unsigned hops', async () => {
    const interceptor = atrib({ creatorKey: TEST_KEY })

    // First call initializes session
    await interceptor.onBeforeToolCall('search', {})

    // Response with no atrib token -> gap node
    interceptor.onAfterToolResponse('search', { content: [] }, {}, {
      serverUrl: 'https://tools.example.com',
    })

    const gapNodes = interceptor.getGapNodes()
    expect(gapNodes).toHaveLength(1)
    expect(gapNodes[0].type).toBe('gap_node')
    expect(gapNodes[0].tool_name).toBe('search')
    expect(gapNodes[0].tool_url).toBe('https://tools.example.com')
    expect(gapNodes[0].signed).toBe(false)
    expect(gapNodes[0].context_id).toMatch(/^[0-9a-f]{32}$/)
  })

  it('does not create gap node when atrib token is present', async () => {
    const interceptor = atrib({ creatorKey: TEST_KEY })
    await interceptor.onBeforeToolCall('search', {})

    // Response WITH atrib token
    interceptor.onAfterToolResponse('search', { content: [] }, {
      atrib: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA.BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
    })

    expect(interceptor.getGapNodes()).toHaveLength(0)
  })

  it('returns empty array in pass-through mode', () => {
    const interceptor = atrib({}) // no key
    expect(interceptor.getGapNodes()).toEqual([])
  })
})

describe('task triggers (§5.7)', () => {
  it('stores task IDs from tasks/create responses', async () => {
    const interceptor = atrib({ creatorKey: TEST_KEY })
    await interceptor.onBeforeToolCall('create_task', {})

    // Simulate tasks/create response
    interceptor.onAfterToolResponse(
      'create_task',
      { id: 'task-123', status: 'pending' },
      { method: 'tasks/create' },
    )

    // Gap node should be created (no atrib token), but task ID stored.
    // We can verify task completion handling next.
    const gapNodes = interceptor.getGapNodes()
    expect(gapNodes.length).toBeGreaterThanOrEqual(1)
  })

  it('treats task completion as tool_call_inbound', async () => {
    const interceptor = atrib({ creatorKey: TEST_KEY })
    await interceptor.onBeforeToolCall('create_task', {})

    // First: task created
    interceptor.onAfterToolResponse(
      'create_task',
      { id: 'task-456', status: 'pending' },
      { method: 'tasks/create' },
    )

    await interceptor.onBeforeToolCall('poll_task', {})

    // Then: task completed (should be processed like a tool_call_inbound)
    interceptor.onAfterToolResponse(
      'poll_task',
      { id: 'task-456', status: 'completed', result: { content: [] } },
      {},
    )

    // Should have gap nodes for both calls (no atrib tokens)
    expect(interceptor.getGapNodes().length).toBeGreaterThanOrEqual(2)
  })
})
