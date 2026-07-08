# @atrib/cli

## 0.1.33

### Patch Changes

- Updated dependencies [3c8e63d]
  - @atrib/mcp@0.19.0

## 0.1.32

### Patch Changes

- Updated dependencies [44bc84d]
  - @atrib/mcp@0.18.1

## 0.1.31

### Patch Changes

- Updated dependencies [e700e1a]
  - @atrib/mcp@0.18.0

## 0.1.30

### Patch Changes

- Updated dependencies [7ffd086]
  - @atrib/mcp@0.17.6

## 0.1.29

### Patch Changes

- Updated dependencies [61c1ec7]
  - @atrib/mcp@0.17.5

## 0.1.28

### Patch Changes

- Updated dependencies [95cd2ca]
- Updated dependencies [95cd2ca]
- Updated dependencies [95cd2ca]
- Updated dependencies [c738147]
  - @atrib/mcp@0.17.4

## 0.1.27

### Patch Changes

- Updated dependencies [3de7d59]
  - @atrib/mcp@0.17.3

## 0.1.26

### Patch Changes

- Updated dependencies [ed766a4]
  - @atrib/mcp@0.17.2

## 0.1.25

### Patch Changes

- Updated dependencies [5ee04c5]
  - @atrib/mcp@0.17.1

## 0.1.24

### Patch Changes

- Updated dependencies [80310e7]
  - @atrib/mcp@0.17.0

## 0.1.23

### Patch Changes

- Updated dependencies [f790fa0]
  - @atrib/mcp@0.16.1

## 0.1.22

### Patch Changes

- Updated dependencies [114248a]
  - @atrib/mcp@0.16.0

## 0.1.21

### Patch Changes

- Updated dependencies [c2ea30d]
  - @atrib/mcp@0.15.1

## 0.1.20

### Patch Changes

- Updated dependencies [8ad7158]
  - @atrib/mcp@0.15.0

## 0.1.19

### Patch Changes

- Updated dependencies [d19cb28]
- Updated dependencies [cd149be]
  - @atrib/mcp@0.14.0

## 0.1.18

### Patch Changes

- Updated dependencies [24c4331]
  - @atrib/mcp@0.13.0

## 0.1.17

### Patch Changes

- Updated dependencies [ee37209]
  - @atrib/mcp@0.12.0

## 0.1.16

### Patch Changes

- Updated dependencies [7658b17]
  - @atrib/mcp@0.11.1

## 0.1.15

### Patch Changes

- Updated dependencies [b263d91]
  - @atrib/mcp@0.11.0

## 0.1.14

### Patch Changes

- Updated dependencies [847852f]
  - @atrib/mcp@0.10.0

## 0.1.13

### Patch Changes

- Updated dependencies [64f3c86]
  - @atrib/mcp@0.9.1

## 0.1.12

### Patch Changes

- Updated dependencies [df7b3d3]
  - @atrib/mcp@0.9.0

## 0.1.11

### Patch Changes

- Updated dependencies [ec688d0]
  - @atrib/mcp@0.8.0

## 0.1.10

### Patch Changes

- Updated dependencies [b89d7b8]
  - @atrib/mcp@0.7.0
  - @atrib/directory@0.2.0

## 0.1.9

### Patch Changes

- Updated dependencies [e1f336c]
  - @atrib/mcp@0.6.2

## 0.1.8

### Patch Changes

- Updated dependencies [b16d08b]
- Updated dependencies [b16d08b]
  - @atrib/mcp@0.6.1

## 0.1.7

### Patch Changes

- Updated dependencies [eb46d66]
  - @atrib/mcp@0.6.0

## 0.1.6

### Patch Changes

- Updated dependencies [b06c720]
  - @atrib/mcp@0.5.0

## 0.1.5

### Patch Changes

- Updated dependencies [b22913a]
  - @atrib/mcp@0.4.0

## 0.1.4

### Patch Changes

- Updated dependencies [03fe031]
  - @atrib/mcp@0.3.0

## 0.1.3

### Patch Changes

- Updated dependencies [79199ee]
- Updated dependencies [8abcb67]
- Updated dependencies [3161e59]
- Updated dependencies [a3d24f9]
- Updated dependencies [d7c806c]
  - @atrib/mcp@0.2.0

## 0.1.2

### Patch Changes

- edf710f: Refine package descriptions for accuracy and consistency.
  - `@atrib/cli`: previous description listed macOS Keychain as if required (it's an optional backend; CLI works on any platform via `--key-file`) and singled out "publish identity claims" as the headline (one of several capabilities). New description: "Key management, identity-claim publishing, and revocation."
  - `@atrib/directory`: dropped "AKD-backed" (implementation detail) from the headline; replaced with "with cryptographic proofs" which captures the value proposition without leaking the implementation choice into the package summary. Also disambiguated "spec [§6](../../atrib-spec.md#6-key-directory)" to "atrib spec [§6](../../atrib-spec.md#6-key-directory)" since the npm package page strips surrounding context.
  - `@atrib/verify`: removed awkward double-"re-" stutter ("re-derivation" + "re-calculation"); replaced with "Independent" which carries the verifier semantic without the verb-stacking. Also disambiguated "[§4.6](../../atrib-spec.md#46-the-calculation-algorithm)" to "atrib spec [§4.6](../../atrib-spec.md#46-the-calculation-algorithm)".

- Updated dependencies [edf710f]
  - @atrib/directory@0.1.2

## 0.1.1

### Patch Changes

- 5809fc2: Refresh package descriptions and READMEs for npm consistency.
  - All 6 descriptions now follow the consistent shape `<noun> for atrib. <specific value>.`
  - Removed em dashes per the writing rules
  - `@atrib/mcp-wrap` description no longer mentions an arbitrary "~30 MCPs" cap (it works for any MCP)
  - Lowercased "atrib" to "atrib" across author + description fields per the brand convention
  - Wrote READMEs for `@atrib/cli` and `@atrib/directory` (previously had none)
  - Rewrote 115 broken relative links across mcp/agent/verify READMEs to absolute github URLs that auto-heal at public-flip
  - Stripped temporary `repository` field from package.jsons (404s while repo is private; restored at public-flip)

- Updated dependencies [5809fc2]
  - @atrib/mcp@0.1.2
  - @atrib/directory@0.1.1
