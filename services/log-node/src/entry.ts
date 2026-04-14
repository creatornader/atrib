// SPDX-License-Identifier: Apache-2.0

/**
 * Re-export from @atrib/mcp. the 90-byte entry format is spec-defined
 * (§2.3.1) and shared between log-dev and log-node.
 */
export {
  serializeEntry,
  ENTRY_VERSION,
  ENTRY_SIZE,
  EVENT_TYPE_TOOL_CALL,
  EVENT_TYPE_TRANSACTION,
} from '@atrib/mcp'
export type { EntryInput } from '@atrib/mcp'
