---
'@atrib/mcp': patch
---

Add opt-in local substrate coordinator client and health-probe helpers for P042. The new APIs validate requests and responses, classify unavailable coordinators without blocking primary work, provide an explicit HTTP transport helper, and build rollout-gate health reports without adding a required daemon.
