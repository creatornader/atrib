# Changesets v3 migration checklist

- [ ] Merge PR #662 and verify Release recovery.
- [x] Upgrade `@changesets/cli` and lockfile.
- [x] Migrate `changesets/action` inputs.
- [x] Remove the temporary Dependabot ignore.
- [x] Remove the obsolete read-yaml-file patch.
- [x] Add release-tool contract coverage.
- [ ] Run version and snapshot dry-runs.
- [ ] Run full local validation.
- [ ] Open, merge, and verify the migration PR.
