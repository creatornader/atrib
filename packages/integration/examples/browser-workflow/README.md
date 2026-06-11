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
pnpm --filter @atrib/integration stagehand-workflow-receipt-smoke
```

The Stagehand smoke is opt-in inside CI because local CDP startup can time out
on shared runners. Set `ATRIB_RUN_STAGEHAND_BROWSER_SMOKE=1` when a CI job is
meant to exercise that browser session directly.

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
- The `stagehand-workflow-receipt-smoke` command runs the same receipt shape
  through a real `@browserbasehq/stagehand` local session. It uses Stagehand's
  page snapshot and extraction surface, then executes pre-resolved Stagehand
  `act` actions for click, fill, and submit.

## What It Does Not Prove Yet

The deterministic smoke is still a browser-shaped local receipt harness, not
live Playwright, Browserbase, Browser Use, Stagehand, Computer Use, OpenHands,
or Operator automation.

The browser-use smoke closes the real browser-use host gap for a direct
`BrowserSession`, but it is not an autonomous LLM-driven `Agent` run, a Browser
Use cloud task, Browserbase, Stagehand, OpenHands, OpenAI Computer Use,
Anthropic computer use, or Operator automation.

The Stagehand smoke closes the local Stagehand session gap for pre-resolved
`act` actions. It is not a Browserbase cloud session, Browserbase session
replay, autonomous Stagehand agent, or LLM-planned Stagehand `observe` / `act`
run. A later proof can pair the same record hashes with screenshots, DOM
excerpts, action replay artifacts, or Browserbase session metadata.
