---
"@atrib/mcp": minor
---

Add `disclosure.result` to the middleware opt-in dial (D061 / §8.3 result-side commitment).

`AtribOptions.disclosure.result: 'omit' | 'plain-sha256' | 'salted-sha256'` populates `result_hash` (and optionally `result_salt`) on the signed record. The result is hashed BEFORE atrib mutates `result._meta` with its own propagation token, so the commitment covers exactly what the upstream handler returned. Same scheme as the existing `args` disclosure.

```ts
atrib(server, {
  creatorKey,
  serverUrl,
  disclosure: {
    args: 'salted-sha256',
    result: 'salted-sha256',
  },
})
```

**Compatibility note**: `disclosure.result` requires the post-call signing path and is INCOMPATIBLE with `preCallTransform` (which signs pre-call when no result is available). When both are set, `result` disclosure is silently inactive on the pre-call path and an init-time warning fires so the conflict is visible at config time rather than as silently-missing fields.

4 new middleware tests added; mcp package now at 388 passing tests.

Closes the §8.3 commitment-form middleware surface end-to-end. The verifier's `args_commitment_form` and `result_commitment_form` posture annotations now have real-data inputs.
