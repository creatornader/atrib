# AAuth Evidence Packet

**Status:** Draft. No outreach sent.

**Purpose:** Source-backed route packet for deciding whether and how to engage AAuth maintainers around durable authorization evidence for signed agent actions.

## Source Snapshot

- AAuth IETF draft: [`draft-hardt-oauth-aauth-protocol-02`](https://datatracker.ietf.org/doc/draft-hardt-oauth-aauth-protocol/), last updated 2026-06-09.
- AAuth protocol repo: [`dickhardt/AAuth`](https://github.com/dickhardt/AAuth), reviewed at `feda56b04ef9d631abab71bdbb6bbb80b007872f`.
- AAuth TypeScript packages: [`aauth-dev/packages-js`](https://github.com/aauth-dev/packages-js), reviewed at `897ebc78185cd60610ba9ff75194498591891704`.
- AAuth .NET samples: [`aauth-dev/dotnet-samples`](https://github.com/aauth-dev/dotnet-samples), reviewed at `909404248131ba9cd6f6c86535623d8675051903`.
- Existing AAuth audit discussion: [`dickhardt/AAuth#3`](https://github.com/dickhardt/AAuth/issues/3).
- AAuth office-hours surface: [`lu.ma/aauth`](https://lu.ma/aauth).

## Strategic Read

AAuth and atrib are complementary at different layers:

- AAuth handles per-agent identity, authorization, request-time proof of possession, missions, access modes, and user/Person Server governance.
- atrib signs action history, commits records to a Merkle log, links actions through `informed_by`, and lets verifiers attach external evidence to a durable record.
- The clean integration point is `evidence[]` with `protocol: "aauth"`, alongside MCP/OAuth and AP2 / VI evidence.
- AAuth should not become a new atrib `event_type` or graph edge. The AAuth facts explain why a signed action was authorized. They are not the action itself.

The most useful shared problem is long-term audit. AAuth can prove a request was authorized when it happened. atrib can preserve which token, signature, mission, access mode, and verification facts were accepted after the AAuth token expires or key metadata rotates.

## Integration Points

### Verifier Evidence Adapter

`@atrib/verify` now accepts AAuth verifier evidence:

- Agent tokens, resource tokens, and auth tokens.
- `agent-token`, `aauth-access-token`, and `auth-token` access modes.
- Trusted JWKS verification or caller-verified claims.
- Scope, resource, issuer, audience, agent, subject, `parent_agent`, actor, mission, HTTP signature, `AAuth-Access`, `cnf.jwk`, `agent_jkt`, and R3 checks.
- No hidden network fetches. Metadata and trust roots remain host-owned.

### TypeScript Client Capture

The AAuth TypeScript client exposes a practical capture seam:

- `createAAuthFetch()` accepts `onEvent`.
- `createSignedFetch()` accepts `onSigned`.
- Done events carry request headers and bodies for signed request evidence.
- `@atrib/mcp` can map those events through `buildAAuthEvidenceFromEvent()` and store verifier-ready sidecar evidence.

### Server Verification Capture

The .NET sample has a typed verification-result seam:

- `AAuthVerificationResult` is available through `HttpContext.Features`.
- Fields include verification level, scheme, token type, issuer, agent, subject, scopes, actor subject, JWK thumbprint, and issuer verification status.
- That shape can map into the same `protocol: "aauth"` evidence object.

### Person Server Audit Capture

The AAuth audit path is also a natural bridge:

- Person Server audit records include mission, action, parameters, and result.
- The audit client signs the audit POST.
- A host-owned audit sink can preserve a hash or selected facts in atrib sidecar evidence, then archive selected evidence through the Record Body Archive Layer when disclosure policy allows it.

## Artifact In This Branch

- [`packages/verify/src/aauth-evidence.ts`](../../packages/verify/src/aauth-evidence.ts): AAuth evidence verifier.
- [`packages/mcp/src/aauth-evidence.ts`](../../packages/mcp/src/aauth-evidence.ts): producer-side capture helper.
- [`packages/verify/test/aauth-evidence-conformance.test.ts`](../../packages/verify/test/aauth-evidence-conformance.test.ts): offline conformance test.
- [`packages/mcp/test/aauth-evidence.test.ts`](../../packages/mcp/test/aauth-evidence.test.ts): capture helper test.
- [`spec/conformance/5.5.6/aauth/`](../../spec/conformance/5.5.6/aauth/): AAuth fixture corpus.
- [D119](../../DECISIONS.md#d119-aauth-evidence-stays-verifier-side): decision record.

## Recommended Route

1. Finish local checks and keep this branch as the reviewable artifact.
2. Open a GitHub issue or comment linked to AAuth's non-repudiation and audit discussion. Suggested title: `AAuth verification evidence receipts for durable audit after key rotation`.
3. Share the issue link in AAuth Slack or office hours only after the GitHub artifact exists.
4. Ask for feedback on the evidence receipt shape, not for endorsement.
5. Wait for maintainer signal before proposing a runnable interop example or a short draft note.

Avoid partnership framing until there is maintainer interest. The right first move is a small technical artifact and a concrete question.

## Draft GitHub Note

> We built a small atrib proof that treats AAuth verification results as `protocol: "aauth"` evidence blocks attached to signed agent-action records.
>
> The goal is durable audit after request-time AAuth proof has aged: tokens expire, keys rotate, and metadata can change, but an auditor may still need to know which AAuth token type, access mode, mission, HTTP signature facts, and key-binding facts were accepted for a specific agent action.
>
> The proof keeps AAuth as the authorization layer and atrib as the signed action-history layer. It does not mint tokens, fetch metadata, call a PS or AS, or store raw JWTs by default. The verifier accepts caller-supplied JWKS or caller-verified claims and emits a generic `evidence[]` block.
>
> Files:
>
> - `packages/verify/src/aauth-evidence.ts`
> - `packages/mcp/src/aauth-evidence.ts`
> - `spec/conformance/5.5.6/aauth/`
>
> Would an AAuth verification evidence receipt be useful as a small interop shape? If so, which producer seam should be canonical first: TypeScript `createAAuthFetch()` events, server middleware verification results, or Person Server audit records?

## Open Questions

- Which AAuth event should be the canonical first producer seam: TypeScript `onEvent`, server verification result, or Person Server audit sink?
- Should AAuth define a portable verification receipt JSON that can survive key rotation and token expiry?
- Which fields should be redacted by default before evidence reaches an archive endpoint?
- Should an interop fixture include an auth-token flow with `act.sub` and a mission, or start with an agent-token request for lower setup cost?
- Should R3 evidence be hash-only by default, or should selected R3 facts be projected into the evidence block?
