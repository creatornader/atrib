# x401 open credential proof artifact

This proof signs an x401 protected-route flow with an open local credential verifier.

## Action path

`GET /open-x401/protected -> 401 PROOF-REQUEST -> stale nonce rejection -> valid PROOF-RESPONSE -> 200 PROOF-RESULT`

## What ran

- Upstream surface: `@proof.com/x401-node@0.3.0` current-spec wire SDK.
- Credential verifier: local JWT VC issuer plus signed VP token verifier.
- atrib path: signed attempted action plus signed successful action linked through `informed_by`.
- Record policy: public packet keeps hashes, verifier outcomes, package versions, and key thumbprints.
- Publish policy: `offline-local-sanitized`.

## Public record refs

These records are local proof records. They were not submitted to `log.atrib.dev`.

| Tool                               | Record hash                                                             | Public log index |
| ---------------------------------- | ----------------------------------------------------------------------- | ---------------- |
| open_x401_credential_fetch_attempt | sha256:0ec1d91882fabd731352f13d29a8922f16818911cd375ce95c3a2e9852e984ef | none             |
| open_x401_credential_fetch_success | sha256:ac1ef0b343e7d052777028b1b03e2e69bda90fb72a91d442f91e34c7ffe35d05 | none             |

## Evidence hashes

| Evidence       | Hash                                                                    |
| -------------- | ----------------------------------------------------------------------- |
| PROOF-REQUEST  | sha256:9b6b1fb8e1a8290a3a48185e23bd5e3d9d72f59ce6c42f6d7d077ac90916abe9 |
| PROOF-RESPONSE | sha256:cb63359f74fe0777a73582c48a4e5f73dbacbf80dcd7f17940717e72c8c02615 |
| PROOF-RESULT   | sha256:cd5fb0c71228b8898b327b69e109d65e5a01224299a00207715c2f228dfa7d35 |

## Redaction line

The verifier saw local credential material: issuer private key, holder private key, JWT VC, signed VP token, and the raw `PROOF-RESPONSE` carrying the VP token. The public artifact stores only hashes, key thumbprints, and verifier outcomes. See `redaction-manifest.json`.

## Proof-hosted credential boundary

This packet closes public x401 protocol E2E without a Proof platform account. A live Proof-hosted credential path is separate provider interop. It is useful when we need to show that a Proof-issued credential can feed caller-owned x401 `resultVerified` evidence, but it is not required to prove the x401 challenge, response, result, credential-verifier, and signed-action chain.

## Proof web and demo boundary

`proof-vc-web` is a browser UX reference for credential collection. `verifier-vcp-demo` is a product-flow reference that still classifies as legacy x401 wire in the live guard. Neither is a core atrib runtime dependency or a normative x401 wire source today.

## Regenerate

```bash
pnpm --filter @atrib/integration open-x401-credential-packet
```

Use `ATRIB_PACKET_OUT_DIR=/tmp/x401-packet` to write a temporary packet instead of replacing this checked-in snapshot.
