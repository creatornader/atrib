# attest/recall rename conformance corpus

Test vectors for the attest/recall verb rename: the collapse of the seven
cognitive-primitive tool surface to two verbs (`attest` writes, `recall`
reads) with the fifteen legacy tool names kept as permanent aliases over the
same handlers.

Six case families:

| Family | Pins |
|---|---|
| `byte-identity/` | The same statement signed through a legacy write name and through `attest` produces byte-identical canonical records and signatures (fixed key, frozen clock, fixed chain inputs). Includes one pre-rename historical record that MUST verify unchanged forever. |
| `ref-mapping/` | The exhaustive `ref` -> record mapping: unknown kinds, malformed or missing targets, a missing revises reason, and content/ref contradictions are typed errors that sign nothing; composition with `informed_by` and genesis-only `provenance_token` rules survive intact. |
| `read-equivalence/` | Every legacy read tool and the `recall` verb shape that maps onto it return JSON-identical results against a fixed mirror fixture, verification accept/reject vectors, the typed `verifier_unavailable` degradation, and `record_hash` presence on compact results. |
| `alias-window/` | The seventeen-tool default union with a bounded tools/list `ttlMs` (W2), `Mcp-Name` header/body consistency across both vocabularies (W3), and `@atrib/mcp-wrap` pass-through consistency. |
| `persisted-labels/` | Mixed `_local.producer` labels (legacy and attest families) and a mixed [D084](../../../DECISIONS.md#d084-read-primitive-instrumentation-for-empirical-loop-closure-measurement) `calls.jsonl` fixture that readers and analyzers MUST accept; history is never rewritten. |
| `frozen-constants/` | `mcp://atrib-emit` as the permanent synthetic server URL, the six normative event-type URIs and bytes, and the derived content_id per emit-family event kind. |

Regeneration: see `manifest.json` for the generator scripts and the
reference tests that consume each family.
