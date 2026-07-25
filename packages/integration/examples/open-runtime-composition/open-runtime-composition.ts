// SPDX-License-Identifier: Apache-2.0

import { runOpenRuntimeComposition } from '../../src/open-runtime-composition.js'

const result = await runOpenRuntimeComposition()
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
