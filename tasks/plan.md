# Implementation Plan: Changesets v3 release migration

## Overview

Move the repository from `@changesets/cli` v2 to v3 and update
`changesets/action` to the v2 input contract. The release workflow must keep its
GitHub App token, GitHub API commit and tag signing, per-package GitHub
releases, npm provenance, and snapshot publishing behavior.

## Architecture decisions

- Keep `@changesets/cli` v3 as a development and release-tool dependency. It is
  not part of published package runtime dependencies.
- Use `changesets/action` v2's `publish-script` and `version-script` inputs.
  Remove the v1-only input names and replace `createGithubReleases` with
  `create-github-releases`.
- Keep GitHub API pushes by leaving `push-with-git-cli: false`. This preserves
  the existing App-token signing path that replaced `commitMode: github-api`.
- Keep the snapshot job on the Changesets CLI commands, then verify it against
  the v3 CLI without publishing.
- Remove the temporary Dependabot ignore for `@changesets/cli >=3.0.0` only
  after the migration passes its dry-run and workflow checks.

## Task list

### Release outage checkpoint

- [x] Merge the compatible action pin from PR #662 and the v2 token fix from
      PR #664.
- [x] Verify post-merge Release runs reach Changesets without CLI or token
      compatibility errors.

### CLI and workflow migration

- [x] Update `@changesets/cli` to the current v3 release and regenerate the
      lockfile.
- [x] Update the release action inputs and comments to the v2 contract.
- [x] Remove the temporary Dependabot v3 ignore.
- [x] Remove the obsolete read-yaml-file patch.
- [x] Add a small release-tool contract test that checks the CLI version and
      required workflow input names remain aligned.

### Checkpoint: local release behavior

- [x] Run the v3 status/version probe and a temporary snapshot version dry-run
      with the custom changelog formatter. The empty repository correctly has
      no unreleased changesets.
- [x] Run the snapshot version/build path without publishing or creating tags.
- [x] Run the full workspace build, typecheck, lint, tests, and doc-sync.

### Remote release verification

- [x] Open migration PR #663 and token follow-up PR #664 with normal CI gates.
- [x] Merge only after CI passes.
- [x] Verify post-merge Release run 32786530297 completes with Changesets v3.
- [x] Confirm no package was published accidentally during the migration.

## Risks and mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Changesets v3 changes custom changelog APIs | Release PR generation can fail | Run version preview with the checked-in formatter before merge |
| Action input rename changes commit/tag behavior | Release metadata or signatures can drift | Keep App token and `push-with-git-cli: false`; verify action logs |
| Snapshot publishing behavior changes | Preview releases can break | Run snapshot version/build locally with publishing disabled |
| Dependabot recreates the incompatible update | Queue noise returns | Remove the ignore only after v3 is installed and CI proves it |

## Acceptance criteria

- `@changesets/cli` v3 is installed from the lockfile.
- The release workflow contains no v1-only action inputs.
- Local release previews and snapshot preparation pass without network publish.
- The first post-merge Release run reaches Changesets and does not emit the
  CLI compatibility error.
- No new code-scanning, Dependabot, or release workflow failures appear.
