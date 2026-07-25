// Public exports for testing / programmatic embedding.

export { bindDirectoryServer } from './server.js'
export type { DirectoryServerConfig, DirectoryServerHandle } from './server.js'
export {
  buildDirectoryAnchor,
  emitDirectoryAnchor,
  hashDirectoryAnchor,
  submitDirectoryAnchor,
  verifyDirectoryAnchorSignature,
} from './anchor.js'
export type { AnchorEmissionInput, AnchorEmissionResult, AnchorRecord } from './anchor.js'
