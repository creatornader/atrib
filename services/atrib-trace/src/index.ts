// SPDX-License-Identifier: Apache-2.0

// @atrib/trace is the legacy home of the trace read primitive. The
// implementation lives in @atrib/recall per the attest/recall rename:
// trace and trace_forward fold into the `recall` verb as shape='walk'
// with a direction, and both legacy tool names stay mounted as permanent
// aliases over the same runner. This package re-exports the surface so
// existing imports keep working.
export {
  compactVisited,
  createAtribTraceServer,
  extractRecordHashFieldsFromMcpResult,
  registerTraceTools,
  runTraceWalk,
  summarizeSidecar,
  TraceInput,
} from '@atrib/recall'
export type { AtribTraceServer, TraceInputT } from '@atrib/recall'
