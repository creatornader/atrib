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
gh pr diff <release-pr-number> --stat
```

Merge only after checks pass and the first-publish plan is ready. If the release
PR lands before first publish, the normal release job can fail with npm `E404`.
That means the package does not exist yet. Do not rerun the job until the first
publish and trusted-publisher setup are complete.

## First publish

Preferred path: publish the first version from GitHub Actions with `NPM_TOKEN`
and `npm publish --access public --provenance`. This creates the package while
still attaching npm provenance from the public GitHub workflow. Use a one-time
manual dispatch job for the named package. Do not route normal releases through
`NPM_TOKEN`.

The `NPM_TOKEN` secret must be a granular npm token that can publish packages:

- packages and scopes permission: read-write.
- package selection: all packages, or a scope/package selection that allows new
  packages under `@atrib`.
- Bypass 2FA: enabled.

Granting organization access to a granular token is not enough for package
publishing. npm documents organization token access as settings/team access, not
package publish access.

Reference: npm documents provenance generation for GitHub Actions at
<https://docs.npmjs.com/generating-provenance-statements>.

If the workflow reaches `npm publish`, prints a Sigstore transparency-log URL,
and then fails with npm `E404` on `PUT`, the token is present but cannot create
the new scoped package. Replace the `NPM_TOKEN` secret with a token or owner path
that can create public packages under `@atrib`, then rerun the same manual
dispatch. Do not merge a follow-up release until that run succeeds.

If the same workflow fails with npm `EOTP`, the token can reach package creation
but does not bypass publish-time 2FA. Create a replacement token with Bypass 2FA
enabled, update the GitHub secret, and rerun the same manual dispatch. npm
expects `--expires` as a number of days, not a calendar date:

```bash
npm config set auth-type legacy
npm whoami || npm login --auth-type=legacy

# Run this in an interactive terminal. npm prompts for the account password even
# when `npm whoami` succeeds. Pass the OTP on the command so npm does not send
# you through its browser auth URL.
read -rp "npm otp: " NPM_OTP
npm token create \
  --name atrib-ci-initial-package-YYYY-MM-DD \
  --token-description "Temporary atrib initial package publish token" \
  --expires 2 \
  --packages-all \
  --packages-and-scopes-permission read-write \
  --bypass-2fa \
  --otp "$NPM_OTP"
unset NPM_OTP

read -rsp "npm token: " NPM_TOKEN
printf "\n"
if [ -z "$NPM_TOKEN" ] || [ "${NPM_TOKEN#npm_}" = "$NPM_TOKEN" ]; then
  echo "NPM token is empty or does not start with npm_; not updating GitHub secret"
  unset NPM_TOKEN
  exit 1
fi
printf "%s" "$NPM_TOKEN" | gh secret set NPM_TOKEN --repo creatornader/atrib
unset NPM_TOKEN

gh workflow run release.yml \
  --repo creatornader/atrib \
  --ref <branch> \
  -f mode=initial-package \
  -f package_name=<package-name> \
  -f package_path=<package-path>
```

If `npm token create` prints a browser auth URL, stop that attempt and rerun the
command with a fresh `--otp` value. The browser URL can end on a 404 page after
2FA and still leave the CLI without a token to print. Do not paste an empty value
into `NPM_TOKEN`.

If `npm token create` returns `E401`, the local npm session is stale or missing.
Run `npm login --auth-type=legacy` again, complete the terminal username,
password, and 2FA prompts, then rerun the token command.

Revoke the temporary token after the package exists and trusted publishing is
configured.

Fallback path: publish locally with an authenticated npm owner:

```bash
cd <package-directory>
npm publish --access public
```

Only use the fallback when you accept that the first version will not have the
same GitHub Actions provenance as normal releases. Record that exception in the
PR or tracker.

## Trusted publisher setup

After the package exists, configure npm trusted publishing for the package:

```bash
npm trust github <package-name> \
  --repo creatornader/atrib \
  --file release.yml \
  -y
```

This requires an authenticated npm owner account with 2FA. npm's own CLI docs
state that `npm trust` requires the package to already exist and does not support
granular access tokens with bypass 2FA for this configuration step:
<https://docs.npmjs.com/cli/v11/commands/npm-trust/#prerequisites>.

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
- Update private outreach trackers from local-artifact status to published npm
  artifact status.
- Rerun the local preflight checks.
- If a failed release run exists from the first-publish gap, rerun it after the
  package exists and trusted publishing is configured.
- Send or queue the outreach packet only after the public install command works
  from npm.
