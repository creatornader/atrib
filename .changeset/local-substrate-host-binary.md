---
'@atrib/emit': patch
---

Add `atrib-local-substrate`, an opt-in loopback HTTP host for the P042 local-substrate coordinator. The binary reuses `@atrib/emit` key resolution, serves startup-spawn, long-lived-agent, and watcher-WAL coordinator requests, reports health, and drains on shutdown.
