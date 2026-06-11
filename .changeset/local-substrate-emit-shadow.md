---
"@atrib/emit": patch
"@atrib/annotate": patch
"@atrib/revise": patch
---

Add opt-in local-substrate shadow probes to the emit signing path. The direct emit path remains authoritative while `handleEmit`, `emitInProcess`, `atrib-emit-cli`, annotate, and revise can send the exact unsigned record body to a P042 coordinator for non-blocking hash comparison.
