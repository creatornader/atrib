# Browser workflow receipt example

This example targets browser and computer-use style workflows. It signs the
visible action sequence around a deterministic local page model:

1. observe the page;
2. click an approval button;
3. fill an approval note;
4. submit the form.

The proof keeps the public atrib records hash-only while local sidecars retain
the page snapshot, selector, form value, and result material.

## Run It

```bash
pnpm --filter @atrib/integration browser-workflow-receipt-smoke
```

## What It Proves

- A browser/workflow agent action sequence can be represented as signed atrib
  `tool_call` records.
- The four action records chain in one `context_id`.
- Public records include `tool_name`, `args_hash`, and `result_hash`, but not
  raw page or form content.
- Local sidecars keep the inspectable action details needed for debugging,
  review, and replay.
- The primary action path still returns the normal workflow result.

## What It Does Not Prove Yet

This is a browser-shaped local receipt harness, not live Playwright,
Browserbase, Browser Use, Computer Use, OpenHands, or Operator automation. The
next proof should run the same receipt shape against a real browser automation
host and pair the record hashes with screenshots, DOM excerpts, or action
replay artifacts.
