---
'@atrib/mcp': patch
---

Add exported local substrate coordinator contract helpers for P042. The new
surface validates coordinator requests, health reports, and fixture packets,
and computes canonical unsigned record-body hashes so startup-spawn wrappers,
long-lived agents, and watcher WAL pipelines can share the same adapter
boundary without changing signed record bytes.
