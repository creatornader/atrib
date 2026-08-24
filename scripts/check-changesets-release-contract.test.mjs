#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const packageJson = JSON.parse(await readFile('package.json', 'utf8'))
const releaseWorkflow = await readFile('.github/workflows/release.yml', 'utf8')

assert.match(packageJson.devDependencies['@changesets/cli'], /^\^3\./)
assert.match(releaseWorkflow, /changesets\/action@[0-9a-f]{40} # v2\./)
assert.match(releaseWorkflow, /github-token: \$\{\{ steps\.app-token\.outputs\.token \}\}/)
assert.match(releaseWorkflow, /publish-script: pnpm release/)
assert.match(releaseWorkflow, /version-script: pnpm version-packages/)
assert.match(releaseWorkflow, /create-github-releases: true/)
assert.match(releaseWorkflow, /push-with-git-cli: false/)
assert.doesNotMatch(releaseWorkflow, /^\s+publish: /m)
assert.doesNotMatch(releaseWorkflow, /^\s+version: pnpm version-packages/m)
assert.doesNotMatch(releaseWorkflow, /commitMode:/)
assert.doesNotMatch(releaseWorkflow, /createGithubReleases:/)
assert.doesNotMatch(releaseWorkflow, /GITHUB_TOKEN: \$\{\{ steps\.app-token\.outputs\.token \}\}/)
