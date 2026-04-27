// SPDX-License-Identifier: Apache-2.0

/**
 * Public package entry for @atrib/graph-node.
 *
 * Re-exports the buildGraph derivation function so cross-implementation
 * conformance tests can compare it against alternative §3.2.4 implementations
 * without reaching into internal source paths. The HTTP server wiring lives
 * in server.ts and is loaded lazily when bindGraphServer is called.
 */

export { buildGraph } from './graph-builder.js'
export type { GapNode } from './graph-builder.js'
export { createRecordStore } from './store.js'
export type { RecordStore, SessionSummary } from './store.js'
export { bindGraphServer } from './server.js'
export type { GraphServerHandle } from './server.js'
