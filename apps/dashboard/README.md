# atrib explorer (option 1)

Public read-only inspection surface over [`log.atrib.dev`](https://log.atrib.dev/v1), [`graph.atrib.dev`](https://graph.atrib.dev/v1), and [`directory.atrib.dev`](https://directory.atrib.dev/v6). Composes data from the three services into seven views: overview, identity (by `creator_key`), session (by `context_id`), action (by `record_hash`), demo, trace (provenance ancestry by `record_hash`), anchoring.

This is **option 1 of a three-stage build** per [D054](../../DECISIONS.md#d054-unified-public-explorer-vs-per-service-admin-uis): single HTML file, no build step, no framework, vanilla JavaScript with `fetch` against the public APIs.

Option 2 (Vite/Next.js SPA) ships when dogfood metrics produce useful signal. Option 3 (block-explorer-grade with search indexing + real-time updates) ships after the broader implementation work completes.

## Use it locally

```bash
# from repo root
cd apps/dashboard
python3 -m http.server 8080
# open http://localhost:8080/
```

## Use it against local services

Append URL params:

```
http://localhost:8080/?log=http://localhost:3100/v1&graph=http://localhost:3200/v1&directory=http://localhost:3300/v6
```

The defaults point at the production endpoints (`log.atrib.dev`, `graph.atrib.dev`, `directory.atrib.dev`).

## Hosting

Live at **https://explore.atrib.dev/**.

log-node serves the dashboard inline. The Dockerfile copies `apps/dashboard/index.html` into the image at build time; the server reads it once at startup, caches in memory, and returns it with `Cache-Control: public, max-age=60`. When the request hostname is `explore.atrib.dev`, log-node returns the dashboard at `/`; for any other hostname (e.g. `log.atrib.dev`) it preserves API behavior at `/v1/*` and returns a JSON 404 hint at `/`. The dashboard is also accessible at `https://log.atrib.dev/dashboard` as a fallback.

`explore.atrib.dev` (not `dashboard.atrib.dev`) is intentional: `explore` reads as block-explorer; `dashboard.atrib.dev` is reserved for the auth-gated personal dashboard product that ships separately.

When option 2 (Vite/Next.js SPA) lands, it gets its own hosting (likely Cloudflare Pages); the inline log-node route stays as a fallback.

CORS is configured on log-node, graph-node, and directory-node (`Access-Control-Allow-Origin: *` on all read endpoints) so the explorer can also be loaded from any other origin during local development.

## What this is NOT

- **Not a personal dashboard.** This shows everybody's public data, not your account. There is no "logged-in user" concept. A separate authenticated personal-dashboard product is queued for after public outreach starts (tracked in operator memory, not in the repo).
- **Not a build artifact.** No transpilation, no bundling, no dependencies. The HTML file is the dashboard.
- **Auto-refreshes.** The overview polls `/v1/recent` + `/v1/stats` + `/v1/checkpoint` every few seconds and prepends new entries without disrupting the user's loaded-older state. Detail views (identity, session, action, trace, anchoring) soft-refresh every 60s by re-running `route()`, long enough to avoid flicker, short enough that newly-arrived records become visible without a manual reload. Refresh pauses when the tab is backgrounded.

## Seven views

| Path | Anchor | Composes | Graph? |
|---|---|---|---|
| `#/` | (default) | `/v1/stats` + `/v1/checkpoint` + `/v1/recent` from log; search bar | ❌ |
| `#/identity/<creator_key>` | base64url 43-char Ed25519 pubkey | directory `/v6/lookup` + `/v6/history`; graph `/v1/creators/<key>/sessions` + `/v1/creators/<key>/graph` | ✅ activity-map DAG (cross-session edges) with time-window selector |
| `#/session/<context_id>` | 32-hex context_id | graph `/v1/graph/<id>` (fallback: log `/v1/by-context/<id>`) | ✅ session DAG (dagre or circular layout per [D066](../../DECISIONS.md#d066-dashboard-graph-viz-library-set-sigmajs--dagre--graphology--cosmosgl-lazy-loaded-cdn-no-build-step) adaptive selector); records-only table when no edges |
| `#/action/<record_hash>` | `sha256:<64-hex>` or just `<64-hex>` | log `/v1/lookup/<hex>` | ❌ |
| `#/demo` | (none) | log `/v1/recent` + graph `/v1/graph/<context_id>` when available | ✅ live replay graph paired with a concise agent-session timeline |
| `#/trace/<record_hash>` | `sha256:<64-hex>` or just `<64-hex>` | graph `/v1/trace/<hex>` + `/v1/chain/<hex>` merged | ✅ provenance-ancestry DAG (all 9 edge types when present) + chain-timeline list |
| `#/anchoring` | (none) | log `/v1/stats` + `/v1/checkpoint` + directory `/v6/anchor` | ❌ |

`#/about` is the static explainer for these views. It is not counted as a data view.

## Graph surfaces

Of the seven dashboard views above, the trace, session, identity, and demo views render Sigma DAGs in the current implementation; the others are non-graph views. The identity activity map was added with [§3.4.7](../../atrib-spec.md#347-get-v1creatorscreator_keygraph) / [D068](../../DECISIONS.md#d068-trace-operations-split--provenance-trace-vs-causal-chain). Per [D066](../../DECISIONS.md#d066-dashboard-graph-viz-library-set-sigmajs--dagre--graphology--cosmosgl-lazy-loaded-cdn-no-build-step) consequences, additional graph surfaces are planned but not yet built:

| Surface | Status | Library | Notes |
|---|---|---|---|
| Trace view (`#/trace/<hash>`) | ✅ Live | Sigma + dagre | All 9 edge types when present (4 producer-claimed + 5 substrate-derived). Pairs with chain-timeline list section. |
| Session DAG (`#/session/<id>`) | ✅ Live | Sigma + dagre/circular | Adaptive layout per [D066](../../DECISIONS.md#d066-dashboard-graph-viz-library-set-sigmajs--dagre--graphology--cosmosgl-lazy-loaded-cdn-no-build-step): dagre when hierarchical edges + edges < 2000; circular fallback for large all-pairs sessions. Intra-session edges are emitted under graph-node's compaction rule per [§3.4.1.1](../../atrib-spec.md#3411-intra-session-edge-compaction): SESSION_PRECEDES / SESSION_PARALLEL between transitively-chained records are skipped (CHAIN_PRECEDES already encodes their order), and across chain components only adjacent-in-time pairs are emitted. The reduction is information-preserving and folds a 1484-record fully-chained session from ~1.1M candidate edges to N-1 chain edges. |
| Identity activity map (`#/identity/<key>`) | ✅ Live | Sigma + dagre | Cross-session edges only by default (intra-session edges filtered per [§3.4.7](../../atrib-spec.md#347-get-v1creatorscreator_keygraph)). Time-window selector (last 6h / 24h / 7d / 30d / all time). |
| Live demo replay (`#/demo`) | ✅ Live | Sigma + dagre | Selects the busiest recent session, renders a concise agent timeline, and animates nodes and edges into view. Falls back to a tested log-derived replay graph if graph-node has no usable graph for the session. |
| Transaction settlement view | 📋 Planned | Sigma + dagre | Either a new `#/transaction/<hash>` route or an upgraded action view when `event_type=transaction`. Renders `CONVERGES_ON` edges from contributing records to the transaction node. |
| Cross-creator network | 📋 Planned | Sigma (small) / cosmos.gl (large) | Two or more `creator_key`s + records they jointly informed/annotated/revised. No route assigned yet. |
| Global view | 📋 Planned | cosmos.gl | The 100k+ node scale view at `#/global`, second renderer beyond Sigma. Same `{nodes, edges}` data adapter. |

This table is the canonical breakdown of dashboard graph surfaces. Update it alongside [D066](../../DECISIONS.md#d066-dashboard-graph-viz-library-set-sigmajs--dagre--graphology--cosmosgl-lazy-loaded-cdn-no-build-step) consequences when shipping a new graph view, and update the [Seven views](#seven-views) table's "Graph?" column.

## Graph viz dependencies (lazy-loaded)

The graph-rendering views (trace, session, identity activity map) load three CDN-pinned libraries: [graphology](https://graphology.github.io/) (~74KB) for the data structure, [dagre](https://github.com/dagrejs/dagre) (~284KB) for hierarchical layout, and [Sigma.js](https://www.sigmajs.org/) (~186KB) for canvas/WebGL rendering. They load only when a graph view is first rendered; overview / action / anchoring / about pages never pay the bytes. Versions + sha384 SRI integrity hashes pinned in `index.html` under `GRAPH_LIB_URLS` per [D066](../../DECISIONS.md#d066-dashboard-graph-viz-library-set-sigmajs--dagre--graphology--cosmosgl-lazy-loaded-cdn-no-build-step), if jsDelivr serves a tampered file, the browser blocks it and the graph render fails closed.

## Files

- `index.html`, the entire explorer in one file (CSS + JS embedded). ~2400 lines.
- `README.md`, this file.

When option 2 lands, this file remains in-repo as the reference implementation; option 2 lives in a separate directory with its build setup.
