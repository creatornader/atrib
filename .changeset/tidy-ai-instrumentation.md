---
'@atrib/openinference': patch
---

Preserve opt-in LLM-to-tool links when AI SDK 7 ends the tool span before its model step. Bound deferred tools and emit unmatched spans on overflow or flush without inventing links. Validate the OpenInference and OpenTelemetry dependency versions already on main.
