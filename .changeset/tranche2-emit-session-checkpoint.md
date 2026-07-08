---
'@atrib/emit': minor
---

Add `emitSessionCheckpoint` per [D139](https://github.com/creatornader/atrib/blob/main/DECISIONS.md#d139-session_checkpoint-event-type-the-session-stream-formalized): sign a session-checkpoint record committing to the context's RFC 6962 session root through the existing emit pipeline, silent-failure per the [§5.8](https://github.com/creatornader/atrib/blob/main/atrib-spec.md#58-degradation-contract) degradation contract.
