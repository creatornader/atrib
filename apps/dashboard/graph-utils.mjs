// Pure helpers extracted from the dashboard graph-rendering pipeline so
// they can be unit-tested without a browser. The HTML at index.html
// imports from this module via `<script type="module">`; the log-node
// server serves `apps/dashboard/*.mjs` so the import resolves at runtime.
//
// Every function here is pure (no DOM, no fetch, no globals) so vitest
// can exercise the optimization-relevant branches deterministically.
// DOM-side concerns (Sigma instantiation, attachCameraResetButton)
// stay in index.html.

/**
 * Edge types that imply a hierarchical (DAG-shaped) graph. Presence of
 * any of these in the edge set tips layout selection toward dagre TB
 * over the dense / non-hierarchical fallbacks.
 */
export const HIERARCHICAL_EDGE_TYPES = new Set([
  'CHAIN_PRECEDES',
  'INFORMED_BY',
  'PROVENANCE_OF',
  'ANNOTATES',
  'REVISES',
  'CONVERGES_ON',
])

/** Above this edge count dagre layout is too slow / unreadable. */
export const DAGRE_MAX_EDGES = 2000

/**
 * Above this node count Force-Atlas 2 simulation cost dominates render
 * time and the visual gain shrinks (everything looks like a colored
 * cloud). Fall through to circular fallback for the extreme-dense case.
 */
export const FA2_MAX_NODES = 5000

/**
 * Decide which layout algorithm to run for a given graph shape. Pure
 * function over the wire format (graphData = { nodes, edges } shape
 * graph-node returns).
 *
 * Returns one of: 'dagre' | 'fa2' | 'circular'.
 *
 * Selection rules (in order):
 *   1. Hierarchical edges present + total edges < DAGRE_MAX_EDGES
 *      AND (hierarchicalEdgeCount > 0 OR totalEdges < 100)
 *      → 'dagre' (the right tool for ancestry / chain views)
 *   2. Otherwise, totalNodes <= FA2_MAX_NODES
 *      → 'fa2' (organic spread; replaces circular hairball)
 *   3. Otherwise (extreme dense)
 *      → 'circular' (built-in fallback; FA2 too expensive)
 *
 * The `< 100 edges` short-circuit forces dagre even when no hierarchical
 * edges are present, because small graphs render cleanly under any
 * algorithm and dagre's TB orientation reads naturally for inspection.
 */
export function selectLayout(graphData) {
  const totalEdges = graphData.edges.length
  const totalNodes = graphData.nodes.length
  const hierarchicalEdgeCount = graphData.edges.filter((e) =>
    HIERARCHICAL_EDGE_TYPES.has(e.type),
  ).length
  const useDagre = totalEdges < DAGRE_MAX_EDGES && (hierarchicalEdgeCount > 0 || totalEdges < 100)
  if (useDagre) return 'dagre'
  if (totalNodes <= FA2_MAX_NODES) return 'fa2'
  return 'circular'
}

/**
 * Walk an edges array once; produce a Map<nodeId, degree> where degree
 * counts both incoming and outgoing edges (a node appearing as either
 * source or target adds 1 per appearance).
 *
 * Multi-edges between the same pair count separately (matches the
 * behavior the actual renderer uses — multi-edges are visualized as
 * distinct lines).
 *
 * Note. Equivalent in semantics to `graphology-metrics` `degreeCentrality(g)`
 * up to normalization (centrality returns degree/(n-1)). We keep this
 * helper because (a) it reads from the wire-format edges array directly
 * without instantiating a graphology graph, and (b) tests stay
 * dependency-light. When the dashboard is already inside a graphology
 * graph instance, prefer `degreeCentralityFromGraph` below.
 */
export function computeNodeDegrees(edges) {
  const degreeByNodeId = new Map()
  for (const e of edges) {
    degreeByNodeId.set(e.source, (degreeByNodeId.get(e.source) ?? 0) + 1)
    degreeByNodeId.set(e.target, (degreeByNodeId.get(e.target) ?? 0) + 1)
  }
  return degreeByNodeId
}

/**
 * Compute normalized degree centrality from a graphology graph.
 * Output values are in [0, 1] where 1 = node connected to every other
 * node. Equivalent to `graphology-metrics`'s `degreeCentrality(g)`
 * helper but inlined to keep this module dep-free and testable
 * without a graphology install.
 *
 * Used by the size-mapping path that prefers normalized centrality
 * over raw degree counts (so the scaling behaves consistently
 * regardless of graph size).
 */
export function degreeCentralityFromGraph(graph) {
  const n = graph.order
  const out = new Map()
  if (n <= 1) return out
  const denom = n - 1
  graph.forEachNode((id) => {
    const deg = graph.degree(id)
    out.set(id, deg / denom)
  })
  return out
}

/**
 * Size a node so the eye has an anchor in dense layouts. Pure
 * arithmetic; no graph state.
 *
 * Strategy:
 *   - Focal nodes (caller-flagged via isFocalNode) → focalSize verbatim.
 *   - Transactions → strong bump (settlement focal points should always
 *     read as anchors, even at low degree). Capped at focalSize so a
 *     high-degree transaction doesn't exceed the dedicated focal size.
 *   - Other nodes → log-scaled by degree, capped at 1.7× baseSize so a
 *     100-degree hub doesn't dwarf baseline records.
 *
 * The log-scaling on raw degree is a heuristic; for size-invariant
 * scaling across graphs of different totalNodes counts, see
 * `computeNodeSizeFromCentrality` below which uses normalized
 * centrality ∈ [0, 1] instead.
 */
export function computeNodeSize(node, isFocal, degree, baseSize, focalSize) {
  if (isFocal) return focalSize
  if (node.event_type === 'transaction') {
    return Math.min(focalSize, baseSize + 4 + Math.min(degree, 4))
  }
  const bump = Math.min(0.7, Math.log2(1 + degree) / 4)
  return baseSize * (1 + bump)
}

/**
 * Centrality-based size encoding (preferred over `computeNodeSize`
 * when totalNodes is known). Equivalent to graphology-metrics'
 * degreeCentrality output × a size scaling factor.
 *
 *   - Focal nodes → focalSize verbatim.
 *   - Transactions → focal-bump regardless of centrality (always read
 *     as settlement anchors). Same shape as `computeNodeSize`.
 *   - Other nodes → baseSize * (1 + 0.7 * centrality). A node connected
 *     to every other (centrality = 1) renders at 1.7× baseSize. A leaf
 *     (centrality near 0) renders at baseSize. Smooth, size-invariant.
 *
 * Pass `centrality = degree / Math.max(1, totalNodes - 1)` for nodes
 * computed via the wire-format edge walk; or use
 * `degreeCentralityFromGraph(g).get(id)` when the graphology graph
 * already exists.
 */
export function computeNodeSizeFromCentrality(node, isFocal, centrality, baseSize, focalSize) {
  if (isFocal) return focalSize
  if (node.event_type === 'transaction') {
    // Transactions: bump scales with centrality but always at least
    // baseSize + 4 so a low-centrality transaction reads as a focal
    // point. Capped at focalSize.
    const bump = 4 + Math.min(4, centrality * 8)
    return Math.min(focalSize, baseSize + bump)
  }
  const c = Math.max(0, Math.min(1, centrality))
  return baseSize * (1 + 0.7 * c)
}

/**
 * Compute the 1-hop neighborhood for a hovered node — used by the
 * reducer-state pattern (storybook story 4-use-reducers) to dim
 * everything except the hovered node + its direct neighbors.
 *
 * Returns `{ nodes: Set<nodeId>, edges: Set<edgeKey> }` where:
 *   - `nodes` includes the hovered node + all neighbors (in + out)
 *   - `edges` includes every edge incident to the hovered node
 *
 * Returns null when the hovered id isn't in the graph (defensive).
 *
 * The graphology graph passed in here is the rendered graph (with
 * multi-edges keyed). `forEachEdge`'s callback receives the edge key
 * which we collect for the reducer to test against.
 */
export function computeNeighborhood(graph, hoveredId) {
  if (!hoveredId || !graph.hasNode(hoveredId)) return null
  const nodes = new Set([hoveredId])
  const edges = new Set()
  graph.forEachEdge(hoveredId, (edgeKey, _attrs, source, target) => {
    edges.add(edgeKey)
    nodes.add(source)
    nodes.add(target)
  })
  return { nodes, edges }
}

/**
 * Compute the bounding box of a node-position iterable.
 *
 * Accepts either a graphology graph (with forEachNode) OR a simple
 * iterable of `{ x, y }` (test-friendly). Returns null when the input
 * is empty or every node has a non-finite coordinate (e.g., NaN from a
 * degenerate FA2 step).
 */
export function computeGraphBBox(positionsLike) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  let count = 0
  if (typeof positionsLike?.forEachNode === 'function') {
    positionsLike.forEachNode((_id, attrs) => {
      if (!isFinite(attrs.x) || !isFinite(attrs.y)) return
      count++
      if (attrs.x < minX) minX = attrs.x
      if (attrs.x > maxX) maxX = attrs.x
      if (attrs.y < minY) minY = attrs.y
      if (attrs.y > maxY) maxY = attrs.y
    })
  } else {
    for (const p of positionsLike) {
      if (!isFinite(p.x) || !isFinite(p.y)) continue
      count++
      if (p.x < minX) minX = p.x
      if (p.x > maxX) maxX = p.x
      if (p.y < minY) minY = p.y
      if (p.y > maxY) maxY = p.y
    }
  }
  if (count === 0) return null
  return { minX, maxX, minY, maxY, width: maxX - minX, height: maxY - minY }
}

/**
 * The Sigma 3 framed-graph default camera state.
 *
 * We learned the hard way (see commit fe3f04e): Sigma 3's camera
 * operates in normalized [0,1] framedGraph space, NOT raw graph
 * coordinates. The canonical "fit the entire graph to viewport"
 * state is `{x: 0.5, y: 0.5, ratio: 1, angle: 0}` — that's what
 * `camera.animatedReset()` returns to.
 *
 * Custom bbox-derived setState in raw coords (computing center +
 * width/dims ratio) sends Sigma's camera off-screen for any non-
 * trivial graph, because Sigma re-projects the supplied (x, y) as
 * if those values were already in normalized space.
 *
 * Exported as a constant so tests can assert callers are passing
 * exactly this state for "fit to graph" semantics, rather than
 * re-rolling the math.
 */
export const SIGMA_FRAMED_DEFAULT_CAMERA = Object.freeze({
  x: 0.5,
  y: 0.5,
  ratio: 1,
  angle: 0,
})
