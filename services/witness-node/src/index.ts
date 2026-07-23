// SPDX-License-Identifier: Apache-2.0

export { startWitnessServer } from './server.js'
export type { WitnessServerConfig, WitnessServerHandle } from './server.js'
export { WitnessStore } from './store.js'
export type { StoredWitnessState } from './store.js'
export { encodeTileIndex, witnessOnce } from './witness.js'
export type {
  WitnessIdentity,
  WitnessGossipSource,
  WitnessLogConfig,
  WitnessOnceOptions,
  WitnessOnceResult,
} from './witness.js'
