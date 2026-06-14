# Runtime-Log Verifier UX

This example renders static proof packets for `log_window_manifest` outputs.
It uses existing runtime-log proofs as inputs, then writes local HTML files that
a reviewer can inspect without reading raw runtime-log bodies.

Run it:

```bash
pnpm --filter @atrib/integration runtime-log-verifier-ux-smoke
```

The smoke renders packets for:

- ActiveGraph approval-window proof;
- reference JSONL main, fork, and compaction windows;
- dogfood Agent Bridge window;
- LangGraph checkpoint main and fork windows;
- OpenInference trace projection.

It also renders one intentionally invalid ActiveGraph packet so reviewers can
see named verifier issue codes in the HTML output. The command prints the temp
output directory, packet paths, valid flags, issue codes, and source/projection
counts.

The HTML is file-backed and local-only. It labels source links by privacy
posture, shows manifest hashes, source identity, window bounds, event roots,
projection roots, receipt roots, fork and compaction bindings, redaction fields,
signed record refs when supplied, and verifier issue codes.
