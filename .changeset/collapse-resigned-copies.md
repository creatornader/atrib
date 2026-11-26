---
'@atrib/recall': minor
'@atrib/sdk': patch
---

History and content reads fold re-signed copies of one statement into the
earliest copy.

A producer that retried after a timeout could sign the same statement many
times. Those copies now appear once, with `duplicate_count` and
`duplicate_latest_timestamp` on the kept record and `collapsed_duplicates` on
the response. The group is ordered by its latest copy, and an annotation or
revision aimed at any copy counts for the statement. Copies must match in every
signed field except `timestamp`, `chain_root` and `signature`, and
`tool_call` and `transaction` records are never folded. Pass
`collapse_duplicates: false` to see every signed copy.

`@atrib/sdk` adds `collapse_duplicates` to the history and content query
types.
