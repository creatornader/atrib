---
'@atrib/mcp': patch
---

`recordHashExistsInMirror()` and the resolver's explicit `localMirrorPaths` lookups now use the persisted record hash index instead of rehashing the mirror on every call. A long-lived host such as `@atrib/mcp-wrap` hashes its mirror once and then reads only appended bytes, and concurrent lookups share one scan. The index keeps hashes a row only declares apart from rows that parse as the signed record, so explicit-file lookups stay as strict as before. Index files written by the first version of the cache are rebuilt on first use. Advisory index writes also sweep temp files left behind by a writer that was killed before its rename.
