---
'@atrib/mcp': patch
---

Export shared event type alias helpers and bounded record-reference lookup options.

`EVENT_TYPE_SHORT_NAMES`, `EVENT_TYPE_SHORT_TO_URI`, and `normalizeEventType`
now live next to the canonical event type URI constants. Producer and consumer
packages can use one shared mapping instead of each package carrying its own
short-name table.

`defaultRecordReferenceResolver()` now also accepts `localLookupTimeoutMs` and
`logLookupTimeoutMs`. Local mirror scanning streams JSONL files instead of
reading whole mirrors into memory. If the local scan times out and log lookup
does not find the record, the resolver returns `unknown` rather than
misreporting a definite miss.
