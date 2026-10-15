// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from 'node:fs'
import { evaluateEvidenceFixture, type FixtureInput } from './source-bound-reference.js'
import { exerciseRetentionFixture } from './source-bound-executor-reference.js'
const fixture = JSON.parse(readFileSync(process.argv[2]!, 'utf8')) as {
  input: FixtureInput & { mode?: string; protected?: boolean; fail_retention?: boolean }
}
const result =
  fixture.input.mode === 'executor'
    ? await exerciseRetentionFixture(!!fixture.input.protected, !!fixture.input.fail_retention)
    : await evaluateEvidenceFixture(fixture.input)
process.stdout.write(`${JSON.stringify(result)}\n`)
