---
"@atrib/mcp": minor
"@atrib/verify": minor
---

Add `args_commitment_form` and `result_commitment_form` posture detection (atrib spec §8.3 / D045).

`@atrib/mcp` `AtribRecord` type gains optional `args_salt` and `result_salt` fields. These were already MAY fields per spec §1.2.1 (lines 293-294 of `atrib-spec.md`) but had not been surfaced in the TypeScript type. JCS-canonical sort positions: `args_salt` between `annotates` and `chain_root` (a-n < a-r < c); `result_salt` between `provenance_token` and `revises` (p < r-e-s < r-e-v). Backward-compatible (absence preserves default posture).

`@atrib/verify` `PostureAnnotation` gains `args_commitment_form` and `result_commitment_form` fields (`'plain-sha256' | 'salted-sha256'`). Detection is structural per §8.3: presence of `args_salt` / `result_salt` ⇒ `salted-sha256`; absence ⇒ `plain-sha256`. The §8.3 `hmac-sha256` variant is signaled out-of-band and is not structurally detectable.

5 new tests added; verify package now at 247 passing.

Implements the args/result commitment-posture half of the §8.3 surface. The `tool_name_form` (§8.2) surface remains blocked on a §1.2.1 spec extension to add `tool_name` as a MAY field.
