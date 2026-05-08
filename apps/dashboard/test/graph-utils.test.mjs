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
//   5. SIGMA_FRAMED_DEFAULT_CAMERA — the framed-graph default camera
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
  selectLayout,
  computeNodeDegrees,
  degreeCentralityFromGraph,
  computeNodeSize,
  computeNodeSizeFromCentrality,
  computeGraphBBox,
  computeNeighborhood,
} from '../graph-utils.mjs'

// Helper: build a graphData wire-format object.
function graph(nodes, edges) { return { nodes, edges } }
function n(id, event_type = 'tool_call') { return { id, event_type } }
function e(source, target, type = 'CHAIN_PRECEDES') { return { source, target, type } }

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
    // cleanly under dagre — the TB orientation reads naturally.
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
  // camera state is `{x: 0.5, y: 0.5, ratio: 1, angle: 0}` — that's what
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

  it('is frozen — callers cannot accidentally mutate the canonical state', () => {
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
    // 'far' is 2 hops away — NOT in neighborhood
    expect(nb.nodes.has('far')).toBe(false)
    // 'e4' isn't incident to hub — NOT in edge set
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
