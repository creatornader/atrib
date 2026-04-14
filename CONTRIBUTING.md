# Contributing to Atrib

Thank you for your interest in contributing to Atrib.

## Development Setup

```bash
# Prerequisites
node --version  # >= 20
corepack enable  # enables pnpm

# Clone and install
git clone https://github.com/atrib-dev/atrib.git
cd atrib
pnpm install

# Build all packages
pnpm -r build

# Run all tests (expect ~480 passing)
pnpm -r test

# Typecheck
pnpm -r typecheck
```

## How to Contribute

### Bug Reports

Open a [GitHub Issue](https://github.com/atrib-dev/atrib/issues/new?template=bug_report.md) with:

- Which package is affected (`@atrib/mcp`, `@atrib/agent`, `@atrib/verify`)
- Steps to reproduce
- Expected vs actual behavior
- Node.js version and OS

### Feature Requests

Open a [GitHub Issue](https://github.com/atrib-dev/atrib/issues/new?template=feature_request.md) with your use case. Features that change the protocol must reference the spec (`atrib-spec.md`).

### Pull Requests

1. Fork the repo and create a branch from `main`
2. Write tests first, every normative MUST in the spec needs a corresponding test
3. Run `pnpm -r build && pnpm -r typecheck && pnpm -r test` before submitting
4. Reference the spec section your change relates to (e.g., "per §2.6.1 Step 4")

### Adding a Framework Adapter

New MCP framework adapters follow an established pattern (see `CLAUDE.md` for the full checklist):

1. **Source-read the host framework first**, don't guess from the dependency graph
2. Create `packages/agent/src/adapters/<framework>.ts`
3. Create `packages/agent/test/<framework>.test.ts` covering: passthrough, `_meta` injection, no caller mutation, response flow, idempotency, §5.8 degradation
4. Create a runnable example at `packages/integration/examples/<framework>/`
5. Add entry to the adapter table in `packages/agent/README.md`
6. Add a decision entry in `DECISIONS.md`
7. Export from `packages/agent/src/index.ts`

## Code Style

- TypeScript strict mode, no `any` types
- Error handling per the spec's degradation contract (§5.8): catch everything, log with `atrib:` prefix, never throw to caller
- Tests use vitest
- Follow existing patterns in the codebase

## Critical Invariants

These are non-negotiable. Do not submit PRs that violate them:

1. **Atrib failures must never affect the primary tool call or agent response** (§5.8)
2. **The graph records structure, not causality** (§3.1)
3. **The calculation algorithm is a pure function** (§4.6)
4. **Transaction records are non-blocking** (§5.3.5)
5. **`session_token` is optional and omitted (not null) when absent** (§1.3)
6. **Fact/policy separation is absolute** (§3.6)
7. **The protocol has no thumb on the scale** (§4.1)

## Security Vulnerabilities

Do NOT open public issues for security vulnerabilities. See [SECURITY.md](SECURITY.md).

## License

By contributing, you agree that your contributions will be licensed under the Apache License, Version 2.0.
