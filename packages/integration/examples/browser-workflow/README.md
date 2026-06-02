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
pnpm --filter @atrib/integration browser-use-workflow-receipt-smoke
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
- The `browser-use-workflow-receipt-smoke` command runs the same receipt shape
  through a real `browser-use` `BrowserSession`, using browser-use navigation,
  state capture, coordinate clicks, and keyboard input on a local page.

## What It Does Not Prove Yet

The deterministic smoke is still a browser-shaped local receipt harness, not
live Playwright, Browserbase, Browser Use, Computer Use, OpenHands, or Operator
automation.

The browser-use smoke closes the real browser-use host gap for a direct
`BrowserSession`, but it is not an autonomous LLM-driven `Agent` run, a Browser
Use cloud task, Browserbase, Stagehand, OpenHands, OpenAI Computer Use,
Anthropic computer use, or Operator automation. A later proof can pair the same
record hashes with screenshots, DOM excerpts, or action replay artifacts.
