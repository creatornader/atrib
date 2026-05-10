// SPDX-License-Identifier: Apache-2.0

// @atrib/openinference-processor. Public API.

// Primary export: the SpanProcessor.
export { AtribSpanProcessor } from './atrib-span-processor.js'
export type {
  AtribSpanProcessorOptions,
  AtribSubmission,
  AtribSpanSidecar,
} from './atrib-span-processor.js'

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
} from './span-to-record.js'
export type { SpanToRecordContext, SpanMappingResult } from './span-to-record.js'
