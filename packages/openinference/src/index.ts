// SPDX-License-Identifier: Apache-2.0

// @atrib/openinference. Public API.

// Primary export: the SpanProcessor.
export { AtribSpanProcessor } from './atrib-span-processor.js'
export type {
  AtribSpanProcessorOptions,
  AtribSubmission,
} from './atrib-span-processor.js'
export {
  buildAtribSpanSidecar,
} from './sidecar.js'
export type {
  AtribSpanSidecar,
  OpenInferenceSidecarContent,
} from './sidecar.js'

// Batch variant for production pipelines (mirrors OpenInferenceBatchSpanProcessor).
export { AtribBatchSpanProcessor } from './atrib-batch-span-processor.js'
export type {
  AtribBatchSpanProcessorOptions,
  AtribBatchSubmission,
  AtribBatchEntry,
  AtribBatchBufferConfig,
} from './atrib-batch-span-processor.js'

// Filter (mirrors @arizeai/openinference-vercel ergonomics).
export {
  isOpenInferenceSpan,
  getOpenInferenceSpanKind,
  OPENINFERENCE_SPAN_KIND_ATTR,
} from './openinference-filter.js'
export type { OpenInferenceSpanKind } from './openinference-filter.js'

// Mapping primitives (for callers that want to build their own
// SpanProcessor or post-hoc batch translator).
export {
  spanToUnsignedRecord,
  readAgentName,
  readIoValues,
  readLlmOutputToolCallId,
  readToolCallId,
} from './span-to-record.js'
export type { SpanToRecordContext, SpanMappingResult } from './span-to-record.js'

// Preflight verification (recommended at app startup).
export {
  verifyOpenTelemetryContextPropagation,
  ContextPropagationError,
} from './preflight.js'

// informed_by tracker (shared across simple + batch processors when both wired).
export { InformedByTracker } from './informed-by-tracker.js'
export type { InformedByTrackerOptions } from './informed-by-tracker.js'

// Args/result hash extraction per spec §8.3.
export { deriveArgsResultHashFields } from './args-result-hash.js'
export type {
  ArgsResultHashPosture,
  ArgsResultHashFields,
} from './args-result-hash.js'
