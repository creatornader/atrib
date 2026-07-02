// SPDX-License-Identifier: Apache-2.0

import { runOpenX401CredentialE2E } from '../src/open-x401-credential-e2e.js'

const result = await runOpenX401CredentialE2E()
console.log(JSON.stringify(result.public_packet, null, 2))
