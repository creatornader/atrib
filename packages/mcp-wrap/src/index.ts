// Public surface for @atrib/mcp-wrap. Importable by in-tree consumers
// that want the operational layer (key resolution, file logging,
// signed-record mirror, autoChain seed loading, per-tool gating) without
// re-implementing it around createAtribProxy.

export {
  parseConfig,
  WrapConfigSchema,
  ToolOverrideSchema,
  DisclosureSchema,
  LocalSubstrateSchema,
} from './config.js'
export type {
  WrapConfig,
  ToolOverride,
  DisclosureConfig,
  LocalSubstrateConfig,
} from './config.js'
export {
  wrap,
  buildPreCallTransform,
  buildInformedBy,
  buildRecordReferenceResolver,
} from './wrap.js'
export type { WrapDeps, LogFn } from './wrap.js'
export { resolveKey } from './keys.js'
export type { ResolvedKey } from './keys.js'
export { loadAutoChainSeed, persistRecord } from './mirror.js'
export { ensureSecureDir, secureAppend } from './paths.js'
export { installWrapperLifecycle } from './lifecycle.js'
export type {
  InstalledWrapperLifecycle,
  WrapperLifecycleLog,
  WrapperLifecycleOptions,
  WrapperShutdownDetails,
  WrapperShutdownReason,
} from './lifecycle.js'
