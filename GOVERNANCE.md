# Governance

atrib is in early-stage development under a single maintainer. Until
the project crosses the threshold of having multiple regular external
contributors, governance is intentionally lightweight and described
here for transparency.

## Maintainership

The current maintainer has commit access to `main` and authority to:
- Merge pull requests
- Cut releases of `@atrib/*` packages
- Update protocol normative content (`atrib-spec.md`, `DECISIONS.md`)
- Decide on architectural direction

The maintainer's identity is the GitHub account [@creatornader](https://github.com/creatornader).

## Decision-making

For protocol-normative changes (anything affecting `atrib-spec.md`
sections marked normative, the byte format in [§2.3.1](atrib-spec.md#231-entry-serialization),
or the canonical record format in [§1](atrib-spec.md#1-attribution-record-format)):
- Open an issue describing the proposed change and the motivating use
  case
- Discussion happens in the issue thread
- The maintainer makes the final call and records the decision in
  `DECISIONS.md` with a `Dxxx` ADR entry

For non-normative changes (implementation, tests, examples, docs):
- A pull request is sufficient
- The maintainer reviews and merges

## Contribution flow

See [CONTRIBUTING.md](CONTRIBUTING.md) for the practical mechanics:
build setup, test expectations, commit-message conventions.

## Becoming a maintainer

When the project grows beyond a single maintainer's capacity to review
PRs in a reasonable timeframe, additional maintainers will be added.
The criteria, in priority order:
1. Sustained high-quality contributions over time (~6 months of
   regular PRs)
2. Demonstrated understanding of the protocol's normative invariants
   (the seven listed in CLAUDE.md, the privacy postures in [§8](atrib-spec.md#8-privacy-postures),
   the cross-attestation requirement in [§1.7.6](atrib-spec.md#176-cross-attestation-requirement-for-transaction-records))
3. Willingness to review others' PRs with the same standards

This document will be expanded with a formal nomination + acceptance
process when the first additional maintainer is added.

## Releases

`@atrib/*` packages on npm follow semver. The CHANGELOG (when added)
will track normative-vs-non-normative changes separately, since
breaking the wire format is much more disruptive than breaking an
implementation API.

## Code of conduct

All participation is governed by [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
Enforcement inquiries go to **conduct@atrib.dev**.

## Security

See [SECURITY.md](SECURITY.md) for vulnerability reporting. Security
issues never go through public GitHub issues, email **security@atrib.dev**.
