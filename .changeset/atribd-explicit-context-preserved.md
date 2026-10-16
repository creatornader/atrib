---
'@atrib/daemon': patch
---

The HTTP context policy no longer replaces a present but malformed `context_id` argument with a carrier context; the primitive's schema refuses it. A valid bare `traceparent` now satisfies strict mode, so a client that attaches one gets its trace-id as the context instead of a refusal.
