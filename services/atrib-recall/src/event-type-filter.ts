// SPDX-License-Identifier: Apache-2.0

// Leaf module: the event_type filter schema shared by index.ts and
// recall-verb.ts. Lives outside index.ts so the recall-verb module can
// evaluate its own top-level zod schemas during the index <-> recall-verb
// import cycle (function-level cycles are safe; const usage at module
// init is not).

import { z } from 'zod'
import { EVENT_TYPE_SHORT_NAMES, isValidEventTypeUri } from '@atrib/mcp'

export const EventTypeFilterSchema = z.union([
  z.enum(EVENT_TYPE_SHORT_NAMES),
  z.string().refine((value) => isValidEventTypeUri(value), {
    message: 'event_type must be an atrib shorthand alias or a syntactically valid absolute URI',
  }),
])
