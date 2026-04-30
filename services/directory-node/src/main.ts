// directory-node main: bind the HTTP server, read config from env.

import { bindDirectoryServer } from './server.js'

async function main(): Promise<void> {
  const port = Number(process.env.PORT ?? 3300)
  const host = process.env.HOST ?? '0.0.0.0'
  const origin = process.env.ATRIB_DIRECTORY_ORIGIN ?? 'directory.atrib.dev/v6'
  const logEndpoint = process.env.ATRIB_LOG_ENDPOINT ?? 'https://log.atrib.dev/v1'
  const seedB64 = process.env.ATRIB_DIRECTORY_KEY

  if (!seedB64) {
    console.error('ATRIB_DIRECTORY_KEY (base64url Ed25519 32-byte seed) is required')
    process.exit(1)
  }
  const operatorPrivateKey = Buffer.from(seedB64.padEnd(seedB64.length + ((4 - (seedB64.length % 4)) % 4), '='), 'base64url')
  if (operatorPrivateKey.length !== 32) {
    console.error(`ATRIB_DIRECTORY_KEY must decode to 32 bytes, got ${operatorPrivateKey.length}`)
    process.exit(1)
  }

  const persistencePath = process.env.ATRIB_DIRECTORY_PERSIST

  const handle = await bindDirectoryServer(port, host, {
    operatorPrivateKey,
    origin,
    logEndpoint,
    ...(persistencePath ? { persistencePath } : {}),
  })
  console.log(`atrib directory-node listening on ${handle.url}`)
  console.log(`  origin:  ${origin}`)
  console.log(`  log:     ${logEndpoint}`)
  console.log(`  persist: ${persistencePath ?? '(in-memory only, set ATRIB_DIRECTORY_PERSIST)'}`)

  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, () => {
      console.log(`received ${sig}, shutting down`)
      void handle.close().then(() => process.exit(0))
    })
  }
}

main().catch((e) => {
  console.error('fatal:', e)
  process.exit(1)
})
