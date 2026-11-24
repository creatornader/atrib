---
'@atrib/mcp': patch
---

The default record reference resolver persists its local mirror hash set to `.atrib-record-hash-index-v1.json` in each mirror directory. A fresh process, such as one `atrib-emit-cli` spawn per record, now reads that index and scans only bytes appended since it was written instead of rehashing the whole mirror. Each entry is keyed by file size, mtime, ctime and inode and checked against a digest of the bytes before the indexed size. Truncation, replacement, in-place rewrites and a corrupt index fall back to a full scan of the affected file. Scans also stop at the size they stat'd, so a row being written concurrently cannot enter the cache half-read.
