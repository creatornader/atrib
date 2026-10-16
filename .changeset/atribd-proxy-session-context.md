---
'@atrib/daemon': patch
---

The stdio-to-HTTP proxy now forwards the session named in its own environment (`ATRIB_CONTEXT_ID`, `CLAUDE_CODE_SESSION_ID` or `CODEX_THREAD_ID`) as an explicit `context_id` on write calls that carry none, so a strict daemon accepts them without `--ambient-context`. It never reads the active-session files.
