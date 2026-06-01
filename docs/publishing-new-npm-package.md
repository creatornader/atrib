# Publishing a new npm package

Use this runsheet when adding a new public `@atrib/*` package. Existing
packages follow the normal changesets path. A brand-new package has one extra
step: npm cannot configure trusted publishing for a package that does not exist
yet, so the first version must create the package before `release.yml` can own
later publishes.

## Required package shape

Every new public package must have:

- `name`, `version`, `description`, `author`, `license`, and `homepage`.
- `repository.url = git+https://github.com/creatornader/atrib.git`.
- `repository.directory` pointing at the package directory.
- `main` and `files: ["dist"]`.
- `types` and `exports` for libraries. CLI-only packages may omit `types` when
  they do not expose an import surface.
- `bin` for command packages.
- `publishConfig.access = "public"` unless there is a documented reason to rely
  only on the workspace changesets config.
- A README with install, quick start, behavior, privacy/degradation notes, and
  the local verification command.
- A focused test suite and, when the package wraps a real external surface, a
  smoke script that exercises that surface.

Descriptions should match the existing public package voice:

```text
<Package role> for atrib. <Specific action the package performs>.
```

## Local preflight

Run these before opening the implementation PR:

```bash
pnpm --filter <package-name> typecheck
pnpm --filter <package-name> test
pnpm --filter <package-name> build
pnpm --filter <package-name> <smoke-script>
pnpm doc-sync
git diff --check
```

Inspect the tarball that npm will receive:

```bash
cd <package-directory>
pnpm pack --pack-destination /tmp --json
tar -tzf /tmp/<tarball-name>.tgz
tar -xOf /tmp/<tarball-name>.tgz package/package.json
```

Install the tarball in a fresh temp project and import the public API:

```bash
tmpdir=$(mktemp -d)
cd "$tmpdir"
npm init -y
npm install /tmp/<tarball-name>.tgz <peer-deps>
node --input-type=module -e "import('<package-name>').then((m) => console.log(Object.keys(m)))"
```

The package name should be absent before first publish:

```bash
npm view <package-name> version --json
```

Expected result for a new package: `E404`.

## Repo docs

Update these in the same PR:

- `README.md`: package table and published-package count. Use "publish-target"
  wording until npm confirms the package exists.
- `ARCHITECTURE.md`: published-package count and package-family summary if the
  new package changes the public package surface.
- Package README: if it includes an npm install command, label it as the
  post-publication command until first publish completes. Include a workspace or
  packed-tarball path for pre-publication testing.
- `CLAUDE.md`: repository tree, public package count, and any ADR index text.
- `DECISIONS.md`: an ADR for the package boundary, rejected alternatives, and
  degradation behavior.
- `DOC-SYNC-TRIGGERS.md`: if this runsheet changes the new-package checklist.
- This runsheet if the first-publish process changes.

Add a changeset for the new package and any changed existing package. Do not
claim the package is published until `npm view` proves it.

## Release PR path

After the implementation PR lands, `release.yml` opens a Version Packages PR.
That PR creates the package `CHANGELOG.md` and updates `package.json` versions.
Review it like any other PR:

```bash
gh pr checks <release-pr-number>
gh pr diff <release-pr-number> --name-only
gh pr diff <release-pr-number> --patch
```

Merge only after checks pass and the first-publish plan is ready. If the release
PR lands before first publish, the normal release job can fail with npm `E404`.
That means the package does not exist yet. Do not rerun the job until the first
publish and trusted-publisher setup are complete.

## First publish

First publish is manual. This matches the `@atrib/verify-mcp` rollout: the
normal release workflow failed with npm `E404` for a package that did not exist,
the first version was published locally by an npm owner, and the next
changesets-managed version published from GitHub Actions after trusted publishing
was configured.

npm documents the direct scoped-package path as publish with `--access public`.
In this pnpm workspace, use `pnpm publish`, not raw `npm publish`. `pnpm publish`
rewrites `workspace:*` dependencies in the packed manifest; raw `npm publish`
does not, and can upload an install-broken tarball.

Run this in zsh from the repo root:

```bash
npm config set auth-type legacy
npm whoami || npm login --auth-type=legacy
pnpm --filter <package-name>... build
pnpm --filter <package-name> test
pnpm --filter <package-name> <smoke-script>
cd <package-directory>
read "NPM_OTP?npm otp: "
pnpm publish --access public --otp "$NPM_OTP"
unset NPM_OTP
```

If the package has no smoke script, skip that line. If the publish fails with
`EOTP`, rerun the publish with a fresh OTP. If it fails with `E404`, confirm the
npm account has write access under the `@atrib` scope and that the package uses
`publishConfig.access = "public"`.

The `@atrib/memory-tool` first publish proved why raw `npm publish` is forbidden:
version `0.2.0` reached npm with `@atrib/mcp: "workspace:*"` in the registry
manifest, so fresh consumer installs failed with `EUNSUPPORTEDPROTOCOL`.
Version `0.2.1` repaired the package through the normal trusted-publishing
release path, and version `0.2.0` was deprecated with a registry warning that
points consumers to `0.2.1` or later.

If a broken first version reaches npm, publish the fixed version, then deprecate
the broken version once an npm owner has a fresh OTP:

```bash
npm deprecate <package-name>@<bad-version> \
  "Broken initial publish. Use <package-name>@<fixed-version> or later." \
  --otp "$NPM_OTP"
```

Do not create or store an `NPM_TOKEN` secret for this step. The normal release
workflow uses OIDC trusted publishing, not long-lived npm tokens.

After publish, verify:

```bash
pnpm pack --pack-destination /tmp --json
tar -xOf /tmp/<tarball-name>.tgz package/package.json | grep -qv 'workspace:'
npm view <package-name>@<version> \
  name version repository dist-tags dist.integrity dist.attestations dist.signatures --json
```

Expect no `workspace:` dependency in the packed manifest. Expect
`dist.integrity` and `dist.signatures[]` from npm. Do not expect
`dist.attestations` on the manual first version.

## Trusted publisher setup

After the package exists, configure npm trusted publishing for the package:

```bash
npm trust github <package-name> \
  --repo creatornader/atrib \
  --file release.yml \
  --allow-publish \
  -y
```

This requires an authenticated npm owner account with 2FA. Current npm CLI docs
state that `npm trust` requires the package to already exist and does not support
granular access tokens with bypass 2FA for this configuration step. As of npm
11.12.1 on this machine, `npm trust github --help` rejects `--allow-publish`.
If that still happens, omit `--allow-publish` and run the same command with
`-y`.

Verify the trust relationship:

```bash
npm trust list <package-name> --json
```

The expected relationship is:

- provider: GitHub Actions.
- repository: `creatornader/atrib`.
- workflow filename: `release.yml`.

## Post-publish verification

Confirm registry parity:

```bash
npm view <package-name>@<version> \
  name version description license homepage repository dist-tags dist.integrity dist.attestations dist.signatures --json
```

The package should have:

- `dist-tags.latest` equal to the published version.
- `repository.directory` matching the repo path.
- `dist.integrity`.
- `dist.attestations.provenance.predicateType = "https://slsa.dev/provenance/v1"`
  when published from GitHub Actions with provenance.
- `dist.signatures[]`.

Install from npm in a clean temp project and import the public API:

```bash
tmpdir=$(mktemp -d)
cd "$tmpdir"
npm init -y
npm install <package-name>@<version> <peer-deps>
node --input-type=module -e "import('<package-name>').then((m) => console.log(Object.keys(m)))"
```

Check GitHub release/tag state:

```bash
git ls-remote --tags origin '<package-name>@<version>'
gh release view '<package-name>@<version>'
```

If the first publish created no GitHub Release, note it and let the next
changesets-managed release create the normal release artifact. Do not fabricate a
release note manually unless the package page, changelog, and tag all agree.

## Close-out

After npm and GitHub agree:

- Change README wording from "publish-target" to "published" and update the
  package count.
- If any broken first-publish version reached npm, confirm it is deprecated or
  record the npm-owner OTP gate before claiming the rollout is closed.
- Search for stale prior-count wording and update every hit:

  ```bash
  rg -n -i "\b(<old-count>|<old-count-word>)\b.{0,80}(packages|npm|public|published)|(packages|npm|public|published).{0,80}\b(<old-count>|<old-count-word>)\b" \
    README.md ARCHITECTURE.md CLAUDE.md DOC-SYNC-TRIGGERS.md docs packages services
  ```

- Update private outreach trackers from local-artifact status to published npm
  artifact status.
- Rerun the local preflight checks.
- If a failed release run exists from the first-publish gap, rerun it after the
  package exists and trusted publishing is configured.
- Send or queue the outreach packet only after the public install command works
  from npm.
