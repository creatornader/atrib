// SPDX-License-Identifier: Apache-2.0

import {
  createHostSignerProxy,
  createSandboxSignerClient,
} from '../../src/signer-proxy-example.js'

const hostPrivateKey = new Uint8Array(32).fill(14)
const signer = createHostSignerProxy({ privateKey: hostPrivateKey })
const capabilities = await signer.capabilities()
const sandbox = createSandboxSignerClient({
  contextId: '11111111111111111111111111111111',
  serverUrl: 'https://sandbox.example/mcp',
  signer,
})

const response = await sandbox.signToolCall({
  args: { path: 'README.md' },
  result: { ok: true },
  toolName: 'read_file',
})

if (!response.ok) {
  throw new Error(response.error)
}

console.log(`[signer-proxy] advertised_creator_key=${capabilities.creator_key}`)
console.log(`[signer-proxy] record_creator_key=${response.creator_key}`)
console.log(`[signer-proxy] record_hash=${response.record_hash}`)
