---
'@atrib/daemon': patch
---

The stdio-to-HTTP proxy now resolves the calling session's context in its own child process and forwards it as an explicit `context_id` on write calls that carry none, so a strict daemon accepts them without `--ambient-context`.
