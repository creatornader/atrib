---
'@atrib/action-gate': minor
'@atrib/agent': minor
'@atrib/annotate': major
'@atrib/attest': minor
'@atrib/cli': minor
'@atrib/daemon': minor
'@atrib/directory': minor
'@atrib/emit': major
'@atrib/mcp': minor
'@atrib/mcp-wrap': minor
'@atrib/memory-tool': minor
'@atrib/openinference': minor
'@atrib/recall': major
'@atrib/revise': major
'@atrib/runtime-log': minor
'@atrib/sdk': major
'@atrib/summarize': minor
'@atrib/trace': major
'@atrib/verify': minor
'@atrib/verify-mcp': major
---

Upgrade canonicalize to 5.1 and require Node.js 22 or newer. JSON values retain their canonical bytes, signatures, hashes, and tokens. JavaScript-only inputs change: function properties and toJSON() results of undefined are omitted from objects and become null in arrays; boxed primitives serialize as their values, and sparse array holes become null. Stored commitments over these JavaScript-only inputs can differ. Pass JSON data when committing tool arguments, results, or content.
