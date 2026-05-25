// Tests for the dashboard graph-rendering pure helpers.
//
// Covers each of the user-flagged P0 graph optimization paths shipped
// across atrib commits 26b2021 (initial), 4bb073c (defensive guards),
// and fe3f04e (Sigma 3 native fit-to-graph reset).
//
//   1. Layout selection (dagre / fa2 / circular based on graph shape)
//   2. Degree computation (edge-walk → degree map)
//   3. Node-size encoding (degree-based with transaction bias)
//   4. BBox math (used for callers that need to know graph extents)
//   5. SIGMA_FRAMED_DEFAULT_CAMERA, the framed-graph default camera
//      state Sigma 3 normalizes into. Tests guard against re-introducing
//      the off-screen-camera bug that produced blank graphs in
//      production (Sigma 3's setState({x, y}) operates in [0, 1]
//      normalized space; raw graph coords sent it thousands of viewport
//      pixels off-screen).

import { describe, it, expect } from 'vitest'
import {
  HIERARCHICAL_EDGE_TYPES,
  DAGRE_MAX_EDGES,
  FA2_MAX_NODES,
  SIGMA_FRAMED_DEFAULT_CAMERA,
  LAYOUT_MODES,
  selectLayout,
  resolveLayoutMode,
  clusterSeedPositions,
  computeNodeDegrees,
  hasParallelEdges,
  degreeCentralityFromGraph,
  computeNodeSize,
  computeNodeSizeFromCentrality,
  computeGraphBBox,
  computeNeighborhood,
  buildReplayGraphFromEntries,
} from '../graph-utils.mjs'

// Helper: build a graphData wire-format object.
function graph(nodes, edges) { return { nodes, edges } }
function n(id, event_type = 'tool_call') { return { id, event_type } }
function e(source, target, type = 'CHAIN_PRECEDES') { return { source, target, type } }
function recent(recordHash, contextId, timestampMs, eventType = 'tool_call') {
  return {
    record_hash: recordHash,
    context_id: contextId,
    timestamp_ms: timestampMs,
    event_type: eventType,
    creator_key: 'creator',
  }
}

describe('HIERARCHICAL_EDGE_TYPES', () => {
  it('contains all edge types the spec defines as hierarchical', () => {
    // Per atrib-spec §3.2.3 + §3.2.4 the hierarchical-edge set is:
    // CHAIN_PRECEDES, INFORMED_BY, PROVENANCE_OF, ANNOTATES, REVISES, CONVERGES_ON.
    expect(HIERARCHICAL_EDGE_TYPES.has('CHAIN_PRECEDES')).toBe(true)
    expect(HIERARCHICAL_EDGE_TYPES.has('INFORMED_BY')).toBe(true)
    expect(HIERARCHICAL_EDGE_TYPES.has('PROVENANCE_OF')).toBe(true)
    expect(HIERARCHICAL_EDGE_TYPES.has('ANNOTATES')).toBe(true)
    expect(HIERARCHICAL_EDGE_TYPES.has('REVISES')).toBe(true)
    expect(HIERARCHICAL_EDGE_TYPES.has('CONVERGES_ON')).toBe(true)
  })

  it('does not contain non-hierarchical edge types', () => {
    // SESSION_PRECEDES, SESSION_PARALLEL, CROSS_SESSION are non-hierarchical
    // per §3.2.3; they describe lateral / across-session relations, not
    // ancestry. Including them in the set would force dagre on every
    // session view and produce tall sparse columns.
    expect(HIERARCHICAL_EDGE_TYPES.has('SESSION_PRECEDES')).toBe(false)
    expect(HIERARCHICAL_EDGE_TYPES.has('SESSION_PARALLEL')).toBe(false)
    expect(HIERARCHICAL_EDGE_TYPES.has('CROSS_SESSION')).toBe(false)
  })
})

describe('selectLayout', () => {
  it('returns "dagre" for a typical trace view (hierarchical edges + small)', () => {
    // Trace view: a few records connected by INFORMED_BY edges.
    const g = graph(
      [n('a'), n('b'), n('c')],
      [e('b', 'a', 'INFORMED_BY'), e('c', 'b', 'INFORMED_BY')],
    )
    expect(selectLayout(g)).toBe('dagre')
  })

  it('returns "dagre" for a small graph with no hierarchical edges (under-100-edges short-circuit)', () => {
    // Even with non-hierarchical edges, < 100 total edges renders
    // cleanly under dagre, the TB orientation reads naturally.
    const g = graph([n('a'), n('b')], [e('a', 'b', 'SESSION_PRECEDES')])
    expect(selectLayout(g)).toBe('dagre')
  })

  it('returns "fa2" for a dense non-hierarchical graph (no chain reconstruction)', () => {
    // A session with all-pairs SESSION_PRECEDES edges (n*(n-1)/2)
    // exceeds the 100-edges short-circuit but stays under DAGRE_MAX_EDGES.
    // Without hierarchical edges, dagre's TB orientation produces a
    // tall sparse column; FA2 spreads organically.
    const nodes = []
    const edges = []
    for (let i = 0; i < 20; i++) nodes.push(n(`n${i}`))
    // 100 edges, none hierarchical
    for (let i = 0; i < 20; i++) {
      for (let j = i + 1; j < 20 && edges.length < 200; j++) {
        edges.push(e(`n${i}`, `n${j}`, 'SESSION_PRECEDES'))
      }
    }
    expect(selectLayout(graph(nodes, edges))).toBe('fa2')
  })

  it('returns "fa2" for a graph with edges >= DAGRE_MAX_EDGES even with hierarchical edges', () => {
    // Above DAGRE_MAX_EDGES dagre is too slow regardless of edge mix;
    // fall through to FA2 (assuming nodes <= FA2_MAX_NODES).
    const nodes = []
    const edges = []
    for (let i = 0; i < 50; i++) nodes.push(n(`n${i}`))
    for (let i = 0; i < DAGRE_MAX_EDGES; i++) {
      edges.push(e(`n${i % 50}`, `n${(i + 1) % 50}`, 'CHAIN_PRECEDES'))
    }
    expect(selectLayout(graph(nodes, edges))).toBe('fa2')
  })

  it('returns "circular" for an extreme-density graph (nodes > FA2_MAX_NODES)', () => {
    // Beyond FA2_MAX_NODES the simulation cost dominates render time.
    // Fall back to circular so the graph at least renders.
    const nodes = []
    const edges = []
    for (let i = 0; i <= FA2_MAX_NODES; i++) nodes.push(n(`n${i}`))
    // Single long path; no hierarchical edges → no dagre.
    for (let i = 0; i < FA2_MAX_NODES; i++) {
      edges.push(e(`n${i}`, `n${i + 1}`, 'SESSION_PRECEDES'))
    }
    expect(selectLayout(graph(nodes, edges))).toBe('circular')
  })

  it('returns "dagre" for an empty graph (no edges; the < 100-edges short-circuit applies)', () => {
    // Edge case: empty edges array. The < 100 branch fires; dagre runs
    // on isolated nodes (and just lays them out in a row).
    expect(selectLayout(graph([n('a'), n('b')], []))).toBe('dagre')
  })
})

describe('computeNodeDegrees', () => {
  it('counts incoming + outgoing edges per node', () => {
    const degrees = computeNodeDegrees([
      e('a', 'b'), e('a', 'c'), e('c', 'b'),
    ])
    expect(degrees.get('a')).toBe(2) // 2 outgoing
    expect(degrees.get('b')).toBe(2) // 2 incoming
    expect(degrees.get('c')).toBe(2) // 1 incoming + 1 outgoing
  })

  it('returns 0 for isolated nodes (not present in edges)', () => {
    const degrees = computeNodeDegrees([e('a', 'b')])
    expect(degrees.get('c') ?? 0).toBe(0)
  })

  it('counts multi-edges between the same pair separately', () => {
    // The dashboard renders multi-edges as distinct lines (different
    // edge types between the same pair). Each must contribute to the
    // visual density at that node.
    const degrees = computeNodeDegrees([
      e('a', 'b', 'CHAIN_PRECEDES'),
      e('a', 'b', 'INFORMED_BY'),
      e('a', 'b', 'ANNOTATES'),
    ])
    expect(degrees.get('a')).toBe(3)
    expect(degrees.get('b')).toBe(3)
  })

  it('returns an empty Map for an empty edge list', () => {
    expect(computeNodeDegrees([]).size).toBe(0)
  })
})

describe('hasParallelEdges', () => {
  it('returns true when two edges share a directed source and target', () => {
    expect(hasParallelEdges([
      e('a', 'b', 'CHAIN_PRECEDES'),
      e('a', 'b', 'INFORMED_BY'),
    ])).toBe(true)
  })

  it('returns false for reverse-direction and unrelated edges', () => {
    expect(hasParallelEdges([
      e('a', 'b', 'CHAIN_PRECEDES'),
      e('b', 'a', 'INFORMED_BY'),
      e('a', 'c', 'ANNOTATES'),
    ])).toBe(false)
  })

  it('returns false for an empty edge list', () => {
    expect(hasParallelEdges([])).toBe(false)
  })
})

describe('computeNodeSize', () => {
  const BASE = 10
  const FOCAL = 16

  it('focal nodes always use focalSize verbatim', () => {
    // Even if degree is 0 and event_type would otherwise pick a smaller
    // size, isFocal=true wins immediately.
    expect(computeNodeSize(n('x', 'tool_call'), true, 0, BASE, FOCAL)).toBe(FOCAL)
    expect(computeNodeSize(n('x', 'transaction'), true, 0, BASE, FOCAL)).toBe(FOCAL)
  })

  it('transactions float between baseSize+4 and focalSize regardless of degree', () => {
    // Settlement views need transactions to read as the focal point
    // even when the transaction has low connectivity.
    const tLow = computeNodeSize(n('t', 'transaction'), false, 0, BASE, FOCAL)
    expect(tLow).toBe(BASE + 4)
    const tMid = computeNodeSize(n('t', 'transaction'), false, 2, BASE, FOCAL)
    expect(tMid).toBe(BASE + 4 + 2)
    const tHigh = computeNodeSize(n('t', 'transaction'), false, 100, BASE, FOCAL)
    // Capped at min(focalSize, baseSize+4+min(degree,4)) = min(16, 18) = 16.
    expect(tHigh).toBe(FOCAL)
  })

  it('non-transaction nodes scale by degree, capped at 1.7× baseSize', () => {
    const isolated = computeNodeSize(n('x', 'tool_call'), false, 0, BASE, FOCAL)
    expect(isolated).toBe(BASE) // log2(1)/4 = 0; 1+0 = 1; 10*1 = 10
    const degree3 = computeNodeSize(n('x', 'tool_call'), false, 3, BASE, FOCAL)
    // log2(4)/4 = 0.5; 1.5 * 10 = 15
    expect(degree3).toBe(15)
    const huge = computeNodeSize(n('x', 'tool_call'), false, 1000, BASE, FOCAL)
    // log2(1001)/4 ≈ 2.5; capped at 0.7 → 1.7 * 10 = 17
    expect(huge).toBe(BASE * 1.7)
  })

  it('different event types apart from "transaction" follow the degree-scaled path', () => {
    // observation, annotation, revision should size identically to
    // tool_call at the same degree (no special-casing).
    const dx = computeNodeSize(n('x', 'tool_call'), false, 5, BASE, FOCAL)
    const da = computeNodeSize(n('x', 'annotation'), false, 5, BASE, FOCAL)
    const dr = computeNodeSize(n('x', 'revision'), false, 5, BASE, FOCAL)
    const do_ = computeNodeSize(n('x', 'observation'), false, 5, BASE, FOCAL)
    expect(dx).toBe(da)
    expect(da).toBe(dr)
    expect(dr).toBe(do_)
  })
})

describe('computeGraphBBox', () => {
  it('returns null for an empty position list', () => {
    expect(computeGraphBBox([])).toBeNull()
  })

  it('computes bbox from a simple iterable of {x, y}', () => {
    const bbox = computeGraphBBox([
      { x: -10, y: 5 },
      { x: 30, y: -20 },
      { x: 0, y: 0 },
    ])
    expect(bbox).not.toBeNull()
    expect(bbox.minX).toBe(-10)
    expect(bbox.maxX).toBe(30)
    expect(bbox.minY).toBe(-20)
    expect(bbox.maxY).toBe(5)
    expect(bbox.width).toBe(40)
    expect(bbox.height).toBe(25)
  })

  it('handles a single-node graph (zero width and height)', () => {
    const bbox = computeGraphBBox([{ x: 5, y: 7 }])
    expect(bbox.width).toBe(0)
    expect(bbox.height).toBe(0)
    expect(bbox.minX).toBe(5)
    expect(bbox.maxY).toBe(7)
  })

  it('skips non-finite positions and returns null when all positions are non-finite', () => {
    expect(computeGraphBBox([{ x: NaN, y: 0 }, { x: 0, y: Infinity }])).toBeNull()
  })

  it('skips non-finite positions but still computes bbox over the finite ones', () => {
    const bbox = computeGraphBBox([
      { x: NaN, y: NaN },
      { x: 5, y: 10 },
      { x: 15, y: 20 },
    ])
    expect(bbox.minX).toBe(5)
    expect(bbox.maxX).toBe(15)
    expect(bbox.minY).toBe(10)
    expect(bbox.maxY).toBe(20)
  })

  it('accepts a graphology-like object via forEachNode', () => {
    // Mock graphology graph: provides `forEachNode((id, attrs) => ...)`.
    const mockGraph = {
      forEachNode(cb) {
        cb('a', { x: 0, y: 0 })
        cb('b', { x: 100, y: 50 })
      },
    }
    const bbox = computeGraphBBox(mockGraph)
    expect(bbox.minX).toBe(0)
    expect(bbox.maxX).toBe(100)
  })
})

describe('SIGMA_FRAMED_DEFAULT_CAMERA', () => {
  // This constant is a regression guard. Sigma 3's framed-graph default
  // camera state is `{x: 0.5, y: 0.5, ratio: 1, angle: 0}`, that's what
  // animatedReset() returns to, and it produces the fit-to-graph view.
  // An earlier commit (26b2021) used custom bbox-derived setState in raw
  // graph coords; that broke production because Sigma 3 normalizes
  // internally. The fix in fe3f04e was to delegate to Sigma's native
  // animatedReset and stop computing custom state. These tests pin the
  // canonical state values so a future refactor can't silently
  // re-introduce the bug.

  it('exports the Sigma 3 framed-graph default state shape', () => {
    expect(SIGMA_FRAMED_DEFAULT_CAMERA).toEqual({ x: 0.5, y: 0.5, ratio: 1, angle: 0 })
  })

  it('is frozen, callers cannot accidentally mutate the canonical state', () => {
    expect(Object.isFrozen(SIGMA_FRAMED_DEFAULT_CAMERA)).toBe(true)
  })

  it('uses normalized [0, 1] coordinates (NOT raw graph coords)', () => {
    // Regression guard against the production bug. Sigma 3's camera
    // state x/y is in [0, 1] framed-graph space; passing raw graph
    // coords (e.g. x=2627 for a graph centered at that x) sent the
    // camera ~46000 viewport pixels off-screen and produced a blank
    // canvas. If a future refactor proposes raw graph coords, these
    // assertions catch it.
    expect(SIGMA_FRAMED_DEFAULT_CAMERA.x).toBeGreaterThanOrEqual(0)
    expect(SIGMA_FRAMED_DEFAULT_CAMERA.x).toBeLessThanOrEqual(1)
    expect(SIGMA_FRAMED_DEFAULT_CAMERA.y).toBeGreaterThanOrEqual(0)
    expect(SIGMA_FRAMED_DEFAULT_CAMERA.y).toBeLessThanOrEqual(1)
    // ratio = 1 means "fit to graph"; < 1 zooms in, > 1 zooms out.
    // Anything substantially different from 1 would NOT be the framed
    // default, so guard the canonical value.
    expect(SIGMA_FRAMED_DEFAULT_CAMERA.ratio).toBe(1)
  })
})

describe('computeNodeSizeFromCentrality', () => {
  const BASE = 10
  const FOCAL = 16

  it('focal nodes always use focalSize verbatim', () => {
    expect(computeNodeSizeFromCentrality(n('x', 'tool_call'), true, 0, BASE, FOCAL)).toBe(FOCAL)
    expect(computeNodeSizeFromCentrality(n('x', 'transaction'), true, 1, BASE, FOCAL)).toBe(FOCAL)
  })

  it('transactions size with centrality, capped at focalSize', () => {
    // bump = 4 + min(4, c*8). At c=0 → 4; at c=0.5 → 8; at c≥0.5 → 8.
    const tLow = computeNodeSizeFromCentrality(n('t', 'transaction'), false, 0, BASE, FOCAL)
    expect(tLow).toBe(BASE + 4) // 14
    const tHalf = computeNodeSizeFromCentrality(n('t', 'transaction'), false, 0.5, BASE, FOCAL)
    expect(tHalf).toBeGreaterThan(BASE + 4)
    expect(tHalf).toBeLessThanOrEqual(FOCAL)
    const tFull = computeNodeSizeFromCentrality(n('t', 'transaction'), false, 1, BASE, FOCAL)
    expect(tFull).toBe(FOCAL) // capped
  })

  it('non-transaction nodes scale linearly with centrality', () => {
    const isolated = computeNodeSizeFromCentrality(n('x', 'tool_call'), false, 0, BASE, FOCAL)
    expect(isolated).toBe(BASE)
    const half = computeNodeSizeFromCentrality(n('x', 'tool_call'), false, 0.5, BASE, FOCAL)
    expect(half).toBeCloseTo(BASE * (1 + 0.7 * 0.5), 5) // 13.5
    const full = computeNodeSizeFromCentrality(n('x', 'tool_call'), false, 1, BASE, FOCAL)
    expect(full).toBeCloseTo(BASE * 1.7, 5) // 17
  })

  it('clamps centrality to [0, 1] (defensive)', () => {
    // negative or > 1 centrality (e.g., from a buggy upstream metric)
    // should saturate, not produce nonsense sizes.
    const neg = computeNodeSizeFromCentrality(n('x', 'tool_call'), false, -0.5, BASE, FOCAL)
    expect(neg).toBe(BASE)
    const huge = computeNodeSizeFromCentrality(n('x', 'tool_call'), false, 5, BASE, FOCAL)
    expect(huge).toBeCloseTo(BASE * 1.7, 5)
  })

  it('produces size-invariant scaling: same centrality → same size regardless of graph size', () => {
    // The whole point of the centrality-based path: a 0.5-centrality
    // node looks the same on a 10-node graph and a 1000-node graph.
    // (Compare with computeNodeSize, where degree=5 looks different
    // depending on graph size.)
    const small = computeNodeSizeFromCentrality(n('x', 'tool_call'), false, 0.5, BASE, FOCAL)
    const large = computeNodeSizeFromCentrality(n('x', 'tool_call'), false, 0.5, BASE, FOCAL)
    expect(small).toBe(large)
  })
})

describe('degreeCentralityFromGraph', () => {
  // Mock graphology graph: implements `order`, `forEachNode`, `degree`.
  function mockGraph(adjacency) {
    const nodeIds = Object.keys(adjacency)
    return {
      order: nodeIds.length,
      forEachNode(cb) { for (const id of nodeIds) cb(id) },
      degree(id) { return adjacency[id] ?? 0 },
      hasNode(id) { return id in adjacency },
    }
  }

  it('returns empty Map for graphs with 0 or 1 nodes (no centrality defined)', () => {
    expect(degreeCentralityFromGraph(mockGraph({})).size).toBe(0)
    expect(degreeCentralityFromGraph(mockGraph({ a: 0 })).size).toBe(0)
  })

  it('normalizes degree to [0, 1] (0 = isolated, 1 = connected to every other node)', () => {
    // 4 nodes; node "hub" connects to all 3 others (degree 3, max possible).
    const c = degreeCentralityFromGraph(mockGraph({ hub: 3, a: 1, b: 1, c: 1 }))
    expect(c.get('hub')).toBe(1) // 3 / (4-1) = 1
    expect(c.get('a')).toBeCloseTo(1 / 3, 5)
  })

  it('handles isolated nodes correctly (centrality = 0)', () => {
    const c = degreeCentralityFromGraph(mockGraph({ a: 0, b: 1, c: 1 }))
    expect(c.get('a')).toBe(0)
    expect(c.get('b')).toBeCloseTo(0.5, 5)
  })
})

describe('computeNeighborhood', () => {
  // Mock graphology graph: implements `hasNode`, `forEachEdge` for an
  // edge-keyed multigraph. Edges keyed by source + '->' + target + '#' + idx.
  function mockMultiGraph(nodes, edges) {
    return {
      hasNode(id) { return nodes.includes(id) },
      forEachEdge(nodeOrCallback, cb) {
        // graphology supports two signatures; we use forEachEdge(node, cb)
        const node = nodeOrCallback
        const callback = cb
        for (const [key, source, target] of edges) {
          if (source === node || target === node) callback(key, {}, source, target)
        }
      },
    }
  }

  it('returns null when the hovered node is not in the graph', () => {
    const g = mockMultiGraph(['a', 'b'], [['e1', 'a', 'b']])
    expect(computeNeighborhood(g, 'missing')).toBeNull()
    expect(computeNeighborhood(g, null)).toBeNull()
    expect(computeNeighborhood(g, undefined)).toBeNull()
  })

  it('returns the hovered node + its 1-hop neighbors', () => {
    // Star graph: hub connects to a, b, c.
    const g = mockMultiGraph(
      ['hub', 'a', 'b', 'c', 'far'],
      [['e1', 'hub', 'a'], ['e2', 'hub', 'b'], ['e3', 'hub', 'c'], ['e4', 'a', 'far']],
    )
    const nb = computeNeighborhood(g, 'hub')
    expect(nb).not.toBeNull()
    expect(nb.nodes).toEqual(new Set(['hub', 'a', 'b', 'c']))
    expect(nb.edges).toEqual(new Set(['e1', 'e2', 'e3']))
    // 'far' is 2 hops away, NOT in neighborhood
    expect(nb.nodes.has('far')).toBe(false)
    // 'e4' isn't incident to hub, NOT in edge set
    expect(nb.edges.has('e4')).toBe(false)
  })

  it('handles a leaf node (only 1 incident edge)', () => {
    const g = mockMultiGraph(['hub', 'leaf'], [['e1', 'hub', 'leaf']])
    const nb = computeNeighborhood(g, 'leaf')
    expect(nb.nodes).toEqual(new Set(['leaf', 'hub']))
    expect(nb.edges).toEqual(new Set(['e1']))
  })

  it('handles isolated nodes (zero incident edges)', () => {
    const g = mockMultiGraph(['lonely', 'a', 'b'], [['e1', 'a', 'b']])
    const nb = computeNeighborhood(g, 'lonely')
    expect(nb.nodes).toEqual(new Set(['lonely']))
    expect(nb.edges.size).toBe(0)
  })

  it('handles multi-edges between the same pair (each gets its own edge key)', () => {
    const g = mockMultiGraph(
      ['a', 'b'],
      [['e1', 'a', 'b'], ['e2', 'a', 'b'], ['e3', 'a', 'b']],
    )
    const nb = computeNeighborhood(g, 'a')
    expect(nb.nodes).toEqual(new Set(['a', 'b']))
    expect(nb.edges).toEqual(new Set(['e1', 'e2', 'e3']))
  })
})

describe('LAYOUT_MODES', () => {
  it('exports the three modes plus auto', () => {
    expect(LAYOUT_MODES).toEqual(['auto', 'timeline', 'organic', 'cluster'])
  })
})

describe('resolveLayoutMode', () => {
  // Pure function over graphData = { nodes, edges }. Returns one of
  // 'timeline' | 'organic' | 'cluster'. Test the explicit-mode pass-
  // through and the 'auto' heuristic branches.

  it('passes through explicit modes verbatim', () => {
    const g = graph([n('a')], [])
    expect(resolveLayoutMode('timeline', g)).toBe('timeline')
    expect(resolveLayoutMode('organic', g)).toBe('organic')
    expect(resolveLayoutMode('cluster', g)).toBe('cluster')
  })

  it('auto picks timeline for chain-shaped graphs (any size)', () => {
    // Tiny graph
    const small = graph([n('a'), n('b'), n('c')], [e('a', 'b'), e('b', 'c')])
    expect(resolveLayoutMode('auto', small)).toBe('timeline')
    // Medium chain
    const nodes = []
    const edges = []
    for (let i = 0; i < 100; i++) nodes.push(n(`n${i}`))
    for (let i = 0; i < 99; i++) edges.push(e(`n${i}`, `n${i + 1}`))
    expect(resolveLayoutMode('auto', graph(nodes, edges))).toBe('timeline')
  })

  it('auto picks cluster for hub-and-spoke graphs (edges/nodes > 2.5)', () => {
    const nodes = []
    const edges = []
    for (let i = 0; i < 30; i++) nodes.push(n(`n${i}`))
    // 30 nodes, 90 edges → ratio 3.0
    for (let i = 0; i < 90; i++) edges.push(e(`n${i % 30}`, `n${(i + 1) % 30}`))
    expect(resolveLayoutMode('auto', graph(nodes, edges))).toBe('cluster')
  })

  it('treats unknown / undefined modes as auto (timeline default)', () => {
    const nodes = []
    for (let i = 0; i < 50; i++) nodes.push(n(`n${i}`))
    const g = graph(nodes, [])
    expect(resolveLayoutMode('mystery', g)).toBe('timeline')
    expect(resolveLayoutMode(undefined, g)).toBe('timeline')
    expect(resolveLayoutMode(null, g)).toBe('timeline')
  })
})

describe('clusterSeedPositions', () => {
  it('returns empty Map for empty input', () => {
    expect(clusterSeedPositions([]).size).toBe(0)
  })

  it('places nodes of the same event_type in the same cluster region', () => {
    const nodes = [
      n('a', 'tool_call'), n('b', 'tool_call'), n('c', 'tool_call'),
      n('x', 'transaction'), n('y', 'transaction'),
    ]
    const positions = clusterSeedPositions(nodes, { clusterRadius: 1000, intraClusterRadius: 100 })
    // Tool_call nodes should be near each other; same for transactions.
    const toolCallPositions = ['a', 'b', 'c'].map(id => positions.get(id))
    const txPositions = ['x', 'y'].map(id => positions.get(id))
    // Centroid of each cluster
    const centroidOf = ps => ({
      x: ps.reduce((s, p) => s + p.x, 0) / ps.length,
      y: ps.reduce((s, p) => s + p.y, 0) / ps.length,
    })
    const tcCenter = centroidOf(toolCallPositions)
    const txCenter = centroidOf(txPositions)
    // Distance between cluster centers should be roughly clusterRadius
    // (since they're placed on a circle of that radius around origin).
    const interClusterDist = Math.hypot(tcCenter.x - txCenter.x, tcCenter.y - txCenter.y)
    expect(interClusterDist).toBeGreaterThan(500)
    // Distance within a cluster should be much smaller
    const intraDist = Math.hypot(toolCallPositions[0].x - toolCallPositions[1].x, toolCallPositions[0].y - toolCallPositions[1].y)
    expect(intraDist).toBeLessThan(interClusterDist)
  })

  it('places single-member cluster at exactly the cluster center (innerR=0)', () => {
    const positions = clusterSeedPositions([n('lonely', 'observation')], { clusterRadius: 500 })
    const p = positions.get('lonely')
    expect(p).toBeDefined()
    // With G=1, groupAngle=0; cx = cos(0)*500 = 500, cy = 0. innerR = 0
    // because M=1 (single member), so position = cluster center exactly.
    expect(p.x).toBe(500)
    expect(p.y).toBe(0)
  })

  it('produces deterministic output for the same input', () => {
    const nodes = [n('a', 'tool_call'), n('b', 'observation'), n('c', 'transaction')]
    const p1 = clusterSeedPositions(nodes)
    const p2 = clusterSeedPositions(nodes)
    for (const id of ['a', 'b', 'c']) {
      expect(p1.get(id)).toEqual(p2.get(id))
    }
  })

  it('handles missing event_type gracefully (defaults to "unknown" group)', () => {
    const nodes = [{ id: 'a' }, { id: 'b' }] // no event_type field
    const positions = clusterSeedPositions(nodes)
    expect(positions.size).toBe(2)
    // Both end up in the same 'unknown' cluster
    const a = positions.get('a')
    const b = positions.get('b')
    const dist = Math.hypot(a.x - b.x, a.y - b.y)
    // Same cluster, so within intraClusterRadius * 2 (default 200 * 2 = 400)
    expect(dist).toBeLessThan(500)
  })
})

describe('buildReplayGraphFromEntries', () => {
  it('builds chronological nodes and same-context chain edges', () => {
    const replay = buildReplayGraphFromEntries([
      recent('b', 'ctx1', 2000),
      recent('a', 'ctx1', 1000),
      recent('c', 'ctx2', 3000),
      recent('d', 'ctx1', 4000),
    ])

    expect(replay.nodes.map((node) => node.id)).toEqual(['a', 'b', 'c', 'd'])
    expect(replay.edges).toEqual([
      { source: 'a', target: 'b', type: 'CHAIN_PRECEDES' },
      { source: 'b', target: 'd', type: 'CHAIN_PRECEDES' },
    ])
    expect(replay.node_count).toBe(4)
    expect(replay.edge_count).toBe(2)
    expect(replay.replay).toBe(true)
  })

  it('keeps the newest entries when a limit is supplied', () => {
    const replay = buildReplayGraphFromEntries([
      recent('a', 'ctx', 1000),
      recent('b', 'ctx', 2000),
      recent('c', 'ctx', 3000),
    ], { limit: 2 })

    expect(replay.nodes.map((node) => node.id)).toEqual(['b', 'c'])
    expect(replay.edges).toEqual([
      { source: 'b', target: 'c', type: 'CHAIN_PRECEDES' },
    ])
  })

  it('drops malformed entries instead of creating broken graph edges', () => {
    const replay = buildReplayGraphFromEntries([
      { record_hash: 'missing-context', timestamp_ms: 1000 },
      { context_id: 'ctx', timestamp_ms: 2000 },
      recent('ok', 'ctx', 3000),
    ])

    expect(replay.nodes.map((node) => node.id)).toEqual(['ok'])
    expect(replay.edges).toEqual([])
  })
})
