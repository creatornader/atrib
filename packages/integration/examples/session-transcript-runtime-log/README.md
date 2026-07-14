# Session transcript runtime-log proof

This example converts a Claude Code style session transcript JSONL file into
bounded `log_window_manifest` proofs. It reads the JSONL shape harnesses write
for local session transcripts, the same shape public agent-transcript datasets
reuse. Raw messages stay in the host-owned transcript file.

## Run it

```bash
pnpm --filter @atrib/integration session-transcript-runtime-log-smoke
```

Pass a transcript path to manifest its full window without creating records.

```bash
pnpm --filter @atrib/integration session-transcript-runtime-log-smoke -- path/to/session.jsonl
```

## What it proves

- Each valid JSON object line becomes a runtime-log event reference.
- Assistant `tool_use` entries create a projection and offline signed atrib
  tool-call receipt refs.
- A subagent transcript binds to the main window that created it.
- A continuation window binds to the compacted main window and summary event.

## What stays local

The transcript JSONL files and their message bodies stay local. The manifests
contain hashes, event refs, signed record hashes, and illustrative archive refs.
The proof does not publish to a public log or fetch the durable-body URI.

## What a verifier checks

- Event roots and session-definition digests match supplied local evidence.
- The tool-use projection and receipt roots match the manifest.
- Fork and compaction links point to the supplied parent manifests.
- No manifest embeds fields declared withheld by the hash-only policy.
