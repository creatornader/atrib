# Publishing a new PyPI package

Use this runsheet when adding a new public Python distribution to this repo
(today: `atrib` in [`python/`](../python/README.md)). It is the PyPI sibling
of [`publishing-new-npm-package.md`](publishing-new-npm-package.md): the same
philosophy — first publish is manual and creates the project, later releases
run through CI trusted publishing — with the PyPI-specific mechanics spelled
out.

Nothing in this runsheet has been executed yet: `atrib` is intentionally
unpublished (verified unclaimed on PyPI 2026-07-06, along with the `atrib-sdk`
fallback name). Per the SDK session brief, do not publish until the
conformance suites, the cross-implementation determinism harness, and this
runsheet's preflight all pass.

## Required distribution shape

Every new public distribution must have, in `pyproject.toml`:

- `name`, `version`, `description`, `readme`, `license`, `authors`,
  `requires-python`, and `classifiers` (including `Typing :: Typed`).
- `project.urls` with `Homepage = https://atrib.dev` and
  `Repository = https://github.com/creatornader/atrib`.
- A src layout (`src/<package>/`) with a `py.typed` marker so type checkers
  consume the inline annotations.
- Pinned-minimum dependencies only for what the record layer genuinely needs
  (`cryptography`, `rfc8785`, `typing_extensions`) — no framework
  dependencies, mirroring the npm rule that `@atrib/agent` peers stay out of
  core packages.
- A README with install, quick start, the byte-identity guarantee, the
  degradation contract notes, and the local verification commands.
- `mypy` strict configuration and a pytest suite that consumes the
  `spec/conformance/` corpora unmodified.

Version numbers track the package's own semver; they do NOT need to match any
`@atrib/*` npm version. Cross-implementation compatibility is asserted by the
conformance corpora, not by version-lockstep.

## Local preflight

```bash
python3 -m venv .venv && . .venv/bin/activate
pip install -e "python/[dev]"
python -m pytest python/tests -q
(cd python && python -m mypy)
pnpm doc-sync
```

The cross-implementation determinism harness
(`python/tests/cross_impl/`) requires the TypeScript SDK to be built first:

```bash
pnpm --filter @atrib/sdk build
```

Inspect the artifacts PyPI will receive:

```bash
pip install build twine
python -m build python/            # produces dist/*.whl and dist/*.tar.gz
python -m twine check python/dist/*
tar -tzf python/dist/atrib-*.tar.gz
unzip -l python/dist/atrib-*.whl   # confirm py.typed and no test/ leakage
```

Install the wheel in a fresh venv and import the public API:

```bash
python3 -m venv /tmp/atrib-wheel-check && . /tmp/atrib-wheel-check/bin/activate
pip install python/dist/atrib-*.whl
python -c "import atrib; print(atrib.__version__, atrib.genesis_chain_root('a'*32))"
```

## First publish (manual, creates the project)

PyPI trusted publishing can be pre-configured for a project that does not
exist yet ("pending publisher"), which is the preferred path:

1. On PyPI, add a **pending publisher** for the project name under the
   publishing account: repository `creatornader/atrib`, workflow
   `release-pypi.yml`, environment `pypi`.
2. If a pending publisher is not used, do a one-time manual upload instead:
   `python -m twine upload python/dist/*` with a project-scoped API token,
   then immediately configure the trusted publisher and revoke the token.
3. Verify the project page renders the README, the license is correct, and
   `pip install atrib` resolves in a clean venv.

## Later releases (CI, trusted publishing)

Later releases go through a GitHub Actions workflow using
`pypa/gh-action-pypi-publish` with OIDC (no long-lived tokens), gated on the
same preflight (pytest + mypy + cross-impl harness + doc-sync). The workflow
does not exist yet; create it alongside the first publish and mirror
`release.yml`'s posture (build once, publish the exact artifacts that were
tested). Changesets does not manage Python versions — bump
`project.version` and `atrib.__version__` together in the release commit.

## Naming

`atrib` is the canonical distribution name; `atrib-sdk` is the documented
fallback if the canonical name is ever unavailable. The import package is
always `atrib` either way.

## Doc-sync duties

A new Python distribution touches: `CLAUDE.md` (repository structure tree +
the Monorepo section's non-workspace note), `README.md` (packages table
mention), and this runsheet's assumptions. Run `pnpm doc-sync` and fix
whatever fires in the same commit.
