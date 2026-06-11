# @atrib/agent

## 0.2.20

### Patch Changes

- Updated dependencies [61c1ec7]
  - @atrib/mcp@0.17.5
  - @atrib/verify@0.7.7

## 0.2.19

### Patch Changes

- Updated dependencies [95cd2ca]
- Updated dependencies [95cd2ca]
- Updated dependencies [95cd2ca]
- Updated dependencies [c738147]
  - @atrib/mcp@0.17.4
  - @atrib/verify@0.7.6

## 0.2.18

### Patch Changes

- Updated dependencies [3de7d59]
  - @atrib/mcp@0.17.3
  - @atrib/verify@0.7.5

## 0.2.17

### Patch Changes

- Updated dependencies [ed766a4]
  - @atrib/mcp@0.17.2
  - @atrib/verify@0.7.4

## 0.2.16

### Patch Changes

- Updated dependencies [5ee04c5]
  - @atrib/mcp@0.17.1
  - @atrib/verify@0.7.3

## 0.2.15

### Patch Changes

- Updated dependencies [80310e7]
  - @atrib/mcp@0.17.0
  - @atrib/verify@0.7.2

## 0.2.14

### Patch Changes

- Updated dependencies [f790fa0]
  - @atrib/mcp@0.16.1
  - @atrib/verify@0.7.1

## 0.2.13

### Patch Changes

- Updated dependencies [114248a]
  - @atrib/mcp@0.16.0
  - @atrib/verify@0.7.0

## 0.2.12

### Patch Changes

- Updated dependencies [4bec234]
  - @atrib/verify@0.6.0

## 0.2.11

### Patch Changes

- Updated dependencies [c2ea30d]
  - @atrib/mcp@0.15.1
  - @atrib/verify@0.5.2

## 0.2.10

### Patch Changes

- Updated dependencies [8ad7158]
  - @atrib/mcp@0.15.0
  - @atrib/verify@0.5.1

## 0.2.9

### Patch Changes

- Updated dependencies [d19cb28]
- Updated dependencies [cd149be]
- Updated dependencies [24e8160]
  - @atrib/mcp@0.14.0
  - @atrib/verify@0.5.0

## 0.2.8

### Patch Changes

- 24c4331: Add `signTransactionRecord()` for [D052](../DECISIONS.md#d052-cross-attestation-requirement-for-transaction-records) transaction cross-attestation bytes and use it for agent-side Path 2 transaction records.

  Path 2 records now carry an agent `signers[]` entry over the atrib transaction record bytes. AP2 receipt JWT signatures remain verifier evidence and are not counted as transaction signers unless a counterparty signs the same atrib canonical bytes.

- Updated dependencies [24c4331]
- Updated dependencies [9ae04bf]
- Updated dependencies [ad3c179]
  - @atrib/mcp@0.13.0
  - @atrib/verify@0.4.0

## 0.2.7

### Patch Changes

- 0f42a05: Fix Cloudflare Agent MCP server URL resolution so `attributeCloudflareAgentMcp` can use stored server rows and server-name overrides for generated connection ids.
- Updated dependencies [01c91cd]
- Updated dependencies [ee37209]
  - @atrib/verify@0.3.7
  - @atrib/mcp@0.12.0

## 0.2.6

### Patch Changes

- Updated dependencies [7658b17]
  - @atrib/mcp@0.11.1
  - @atrib/verify@0.3.6

## 0.2.5

### Patch Changes

- Updated dependencies [b263d91]
  - @atrib/mcp@0.11.0
  - @atrib/verify@0.3.5

## 0.2.4

### Patch Changes

- Updated dependencies [847852f]
  - @atrib/mcp@0.10.0
  - @atrib/verify@0.3.4

## 0.2.3

### Patch Changes

- Updated dependencies [64f3c86]
  - @atrib/mcp@0.9.1
  - @atrib/verify@0.3.3

## 0.2.2

### Patch Changes

- Updated dependencies [df7b3d3]
  - @atrib/mcp@0.9.0
  - @atrib/verify@0.3.2

## 0.2.1

### Patch Changes

- Updated dependencies [ec688d0]
  - @atrib/mcp@0.8.0
  - @atrib/verify@0.3.1

## 0.2.0

### Minor Changes

- b89d7b8: Upgrade major versions of four core deps: `@noble/ed25519` 2 → 3,
  `@noble/hashes` 1 → 2 (where applicable), `canonicalize` 2 → 3, and
  `@opentelemetry/sdk-trace-base` 1 → 2 (peer dep on `@atrib/openinference`).

  Atrib's own public APIs are unchanged, and signing-output, hash-output, and
  JCS-canonicalization-output remain byte-identical — verified by the signing
  corpus (spec [§1.4](../atrib-spec.md#14-signing-and-verification)) and the Wycheproof Ed25519 test vectors.

  The single user-visible break is `@atrib/openinference`'s peer dep: consumers
  of that package must now use `@opentelemetry/sdk-trace-base@^2.7.1` (instead
  of `^1.27.0`). The OTel SDK v2 also replaced `provider.addSpanProcessor(p)`
  with the `new BasicTracerProvider({ spanProcessors: [p] })` constructor form;
  the adapter and its tests have been migrated accordingly.

  The other deps' major-version changes were API-shape internal:
  `@noble/ed25519` v3 moved sha512 wiring from `etc.sha512Sync` to
  `hashes.sha512` and renamed `utils.randomPrivateKey` to `utils.randomSecretKey`;
  `@noble/hashes` v2 is ESM-only and requires `.js` extensions on import paths;
  `canonicalize` v3 is ESM-only (atrib was already ESM-only). None of these
  shifts touch atrib's exported surface.

### Patch Changes

- Updated dependencies [b89d7b8]
  - @atrib/mcp@0.7.0
  - @atrib/verify@0.3.0

## 0.1.9

### Patch Changes

- Updated dependencies [e1f336c]
  - @atrib/mcp@0.6.2
  - @atrib/verify@0.2.6

## 0.1.8

### Patch Changes

- Updated dependencies [b16d08b]
- Updated dependencies [b16d08b]
  - @atrib/mcp@0.6.1
  - @atrib/verify@0.2.5

## 0.1.7

### Patch Changes

- Updated dependencies [eb46d66]
  - @atrib/mcp@0.6.0
  - @atrib/verify@0.2.4

## 0.1.6

### Patch Changes

- Updated dependencies [b06c720]
  - @atrib/mcp@0.5.0
  - @atrib/verify@0.2.3

## 0.1.5

### Patch Changes

- Updated dependencies [b22913a]
  - @atrib/mcp@0.4.0
  - @atrib/verify@0.2.2

## 0.1.4

### Patch Changes

- Updated dependencies [03fe031]
  - @atrib/mcp@0.3.0
  - @atrib/verify@0.2.1

## 0.1.3

### Patch Changes

- Updated dependencies [79199ee]
- Updated dependencies [98c6ff9]
- Updated dependencies [8abcb67]
- Updated dependencies [3161e59]
- Updated dependencies [a3d24f9]
- Updated dependencies [d7c806c]
  - @atrib/mcp@0.2.0
  - @atrib/verify@0.2.0

## 0.1.2

### Patch Changes

- Updated dependencies [edf710f]
  - @atrib/verify@0.1.2

## 0.1.1

### Patch Changes

- 5809fc2: Refresh package descriptions and READMEs for npm consistency.
  - All 6 descriptions now follow the consistent shape `<noun> for atrib. <specific value>.`
  - Removed em dashes per the writing rules
  - `@atrib/mcp-wrap` description no longer mentions an arbitrary "~30 MCPs" cap (it works for any MCP)
  - Lowercased "Atrib" to "atrib" across author + description fields per the brand convention
  - Wrote READMEs for `@atrib/cli` and `@atrib/directory` (previously had none)
  - Rewrote 115 broken relative links across mcp/agent/verify READMEs to absolute github URLs that auto-heal at public-flip
  - Stripped temporary `repository` field from package.jsons (404s while repo is private; restored at public-flip)

- Updated dependencies [5809fc2]
  - @atrib/mcp@0.1.2
  - @atrib/verify@0.1.1
