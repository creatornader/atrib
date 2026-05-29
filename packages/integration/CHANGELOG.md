# @atrib/integration

## Unreleased

### Patch Changes

- Add a local AP2 participant artifact generator that writes AP2 result evidence, AP2 / VI verifier evidence, and a two-party atrib transaction record over the production AP2 receipt identity.
- Add AP2 plus Verifiable Intent reference artifacts generated from the official AP2 Python SDK and the public Verifiable Intent Python reference implementation, then test them through the live interop harness with counterparty transaction attestation.
- Add AP2 reference receipt artifacts generated from the official AP2 Python SDK and test them through the live interop harness with counterparty transaction attestation.
- Extend the AP2 live interop harness to verify optional atrib transaction-record artifacts, including AP2 receipt-derived `content_id` matching and counterparty cross-attestation.

## 0.0.18

### Patch Changes

- 9ae04bf: Add typed AP2 / Verifiable Intent mandate constraint evaluation to verifier evidence results.
- ad3c179: Add async AP2 / Verifiable Intent SD-JWT conformance checks to `@atrib/verify`.

  `verifyAp2ViEvidenceAsync()` now verifies VI credentials with OpenWallet `sd-jwt-js`, reports per-credential `sdJwtConformance`, and supports require, best-effort, and off policies. The AP2 integration test now exercises the async verifier path across package exports.

- Updated dependencies [24c4331]
- Updated dependencies [9ae04bf]
- Updated dependencies [ad3c179]
  - @atrib/mcp@0.13.0
  - @atrib/agent@0.2.8
  - @atrib/verify@0.4.0
  - @atrib/log-dev@0.1.18
  - @atrib/graph-node@0.1.18
  - @atrib/log-node@0.1.18

## 0.0.17

### Patch Changes

- Updated dependencies [0f42a05]
- Updated dependencies [01c91cd]
- Updated dependencies [ee37209]
  - @atrib/agent@0.2.7
  - @atrib/verify@0.3.7
  - @atrib/mcp@0.12.0
  - @atrib/graph-node@0.1.17
  - @atrib/log-dev@0.1.17
  - @atrib/log-node@0.1.17

## 0.0.16

### Patch Changes

- Updated dependencies [7658b17]
  - @atrib/mcp@0.11.1
  - @atrib/agent@0.2.6
  - @atrib/log-dev@0.1.16
  - @atrib/verify@0.3.6
  - @atrib/graph-node@0.1.16
  - @atrib/log-node@0.1.16

## 0.0.15

### Patch Changes

- Updated dependencies [b263d91]
  - @atrib/mcp@0.11.0
  - @atrib/agent@0.2.5
  - @atrib/log-dev@0.1.15
  - @atrib/verify@0.3.5
  - @atrib/graph-node@0.1.15
  - @atrib/log-node@0.1.15

## 0.0.14

### Patch Changes

- Updated dependencies [847852f]
  - @atrib/mcp@0.10.0
  - @atrib/agent@0.2.4
  - @atrib/log-dev@0.1.14
  - @atrib/verify@0.3.4
  - @atrib/graph-node@0.1.14
  - @atrib/log-node@0.1.14

## 0.0.13

### Patch Changes

- Updated dependencies [64f3c86]
  - @atrib/mcp@0.9.1
  - @atrib/agent@0.2.3
  - @atrib/log-dev@0.1.13
  - @atrib/verify@0.3.3
  - @atrib/graph-node@0.1.13
  - @atrib/log-node@0.1.13

## 0.0.12

### Patch Changes

- Updated dependencies [df7b3d3]
  - @atrib/mcp@0.9.0
  - @atrib/agent@0.2.2
  - @atrib/log-dev@0.1.12
  - @atrib/verify@0.3.2
  - @atrib/graph-node@0.1.12
  - @atrib/log-node@0.1.12

## 0.0.11

### Patch Changes

- Updated dependencies [ec688d0]
  - @atrib/mcp@0.8.0
  - @atrib/agent@0.2.1
  - @atrib/log-dev@0.1.11
  - @atrib/verify@0.3.1
  - @atrib/graph-node@0.1.11
  - @atrib/log-node@0.1.11

## 0.0.10

### Patch Changes

- Updated dependencies [b89d7b8]
  - @atrib/mcp@0.7.0
  - @atrib/agent@0.2.0
  - @atrib/verify@0.3.0
  - @atrib/directory@0.2.0
  - @atrib/log-dev@0.1.10
  - @atrib/graph-node@0.1.10
  - @atrib/log-node@0.1.10

## 0.0.9

### Patch Changes

- Updated dependencies [e1f336c]
  - @atrib/mcp@0.6.2
  - @atrib/agent@0.1.9
  - @atrib/log-dev@0.1.9
  - @atrib/verify@0.2.6
  - @atrib/graph-node@0.1.9
  - @atrib/log-node@0.1.9

## 0.0.8

### Patch Changes

- Updated dependencies [b16d08b]
- Updated dependencies [b16d08b]
  - @atrib/mcp@0.6.1
  - @atrib/agent@0.1.8
  - @atrib/log-dev@0.1.8
  - @atrib/verify@0.2.5
  - @atrib/graph-node@0.1.8
  - @atrib/log-node@0.1.8

## 0.0.7

### Patch Changes

- Updated dependencies [eb46d66]
  - @atrib/mcp@0.6.0
  - @atrib/agent@0.1.7
  - @atrib/log-dev@0.1.7
  - @atrib/verify@0.2.4
  - @atrib/graph-node@0.1.7
  - @atrib/log-node@0.1.7

## 0.0.6

### Patch Changes

- Updated dependencies [b06c720]
  - @atrib/mcp@0.5.0
  - @atrib/agent@0.1.6
  - @atrib/log-dev@0.1.6
  - @atrib/verify@0.2.3
  - @atrib/graph-node@0.1.6
  - @atrib/log-node@0.1.6

## 0.0.5

### Patch Changes

- Updated dependencies [b22913a]
  - @atrib/mcp@0.4.0
  - @atrib/agent@0.1.5
  - @atrib/log-dev@0.1.5
  - @atrib/verify@0.2.2
  - @atrib/graph-node@0.1.5
  - @atrib/log-node@0.1.5

## 0.0.4

### Patch Changes

- Updated dependencies [03fe031]
  - @atrib/mcp@0.3.0
  - @atrib/agent@0.1.4
  - @atrib/log-dev@0.1.4
  - @atrib/verify@0.2.1
  - @atrib/graph-node@0.1.4
  - @atrib/log-node@0.1.4

## 0.0.3

### Patch Changes

- Updated dependencies [79199ee]
- Updated dependencies [98c6ff9]
- Updated dependencies [8abcb67]
- Updated dependencies [3161e59]
- Updated dependencies [a3d24f9]
- Updated dependencies [d7c806c]
  - @atrib/mcp@0.2.0
  - @atrib/verify@0.2.0
  - @atrib/log-dev@0.1.3
  - @atrib/agent@0.1.3
  - @atrib/graph-node@0.1.3
  - @atrib/log-node@0.1.3

## 0.0.2

### Patch Changes

- Updated dependencies [edf710f]
  - @atrib/verify@0.1.2
  - @atrib/log-dev@0.1.2
  - @atrib/log-node@0.1.2
  - @atrib/agent@0.1.2
  - @atrib/graph-node@0.1.2

## 0.0.1

### Patch Changes

- Updated dependencies [5809fc2]
  - @atrib/mcp@0.1.2
  - @atrib/agent@0.1.1
  - @atrib/verify@0.1.1
  - @atrib/log-dev@0.1.1
  - @atrib/graph-node@0.1.1
  - @atrib/log-node@0.1.1
