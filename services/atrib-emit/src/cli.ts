#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0

// atrib-emit-cli forwarding shim. The implementation lives in
// @atrib/attest's cli module; it derives its diagnostic identity and the
// default `_local.producer` label from the invoked basename, so records
// signed through this bin keep the historical 'atrib-emit-cli' label
// (persisted-label rule L1) unless the envelope overrides `producer`.

import { main } from '@atrib/attest/dist/cli.js'

void main(process.argv.slice(2)).then((code) => {
  process.exit(code)
})
