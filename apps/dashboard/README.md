# atrib explorer (option 1)

Public read-only inspection surface over [`log.atrib.dev`](https://log.atrib.dev/v1), [`graph.atrib.dev`](https://graph.atrib.dev/v1), and [`directory.atrib.dev`](https://directory.atrib.dev/v6). Composes data from the three services into six views: overview, identity (by `creator_key`), session (by `context_id`), action (by `record_hash`), trace (provenance ancestry by `record_hash`), anchoring.

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
- **Not real-time.** Pull-on-load. Refresh to update. Real-time updates come in option 3.

## Six views

| Path | Anchor | Composes |
|---|---|---|
| `#/` | (default) | `/v1/stats` + `/v1/checkpoint` from log; search bar |
| `#/identity/<creator_key>` | base64url 43-char Ed25519 pubkey | directory `/v6/lookup` + `/v6/history` |
| `#/session/<context_id>` | 32-hex context_id | graph `/v1/graph/<id>` |
| `#/action/<record_hash>` | `sha256:<64-hex>` or just `<64-hex>` | log `/v1/lookup/<hex>` |
| `#/trace/<record_hash>` | `sha256:<64-hex>` or just `<64-hex>` | graph `/v1/trace/<hex>` rendered as a provenance-ancestry DAG |
| `#/anchoring` | (none) | log `/v1/stats` + `/v1/checkpoint` + directory `/v6/anchor` |
| `#/about` | (none) | static text |

## Graph viz dependencies (lazy-loaded)

The trace view renders an interactive DAG via three CDN-loaded libraries: [graphology](https://graphology.github.io/) (~74KB) for the data structure, [dagre](https://github.com/dagrejs/dagre) (~284KB) for hierarchical layout, and [Sigma.js](https://www.sigmajs.org/) (~186KB) for canvas/WebGL rendering. They load only when a graph view is first rendered; overview / identity / action / anchoring / about pages never pay the bytes. Versions pinned in `index.html` under `GRAPH_LIB_URLS`. Subresource-integrity (SRI) hashes are not currently set; this is tracked alongside the broader hardening of public-facing assets.

## Files

- `index.html` — the entire explorer in one file (CSS + JS embedded). ~2400 lines.
- `README.md` — this file.

When option 2 lands, this file remains in-repo as the reference implementation; option 2 lives in a separate directory with its build setup.
