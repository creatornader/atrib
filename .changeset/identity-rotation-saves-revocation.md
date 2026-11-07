---
'@atrib/cli': patch
---

`atrib identity init` saves the profile as soon as the log accepts the predecessor's revocation, before the optional directory publish. A failed publish no longer leaves a revoked run marked active, and the rerun no longer revokes it a second time under a different successor.
