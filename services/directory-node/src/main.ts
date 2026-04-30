// directory-node main: bind the HTTP server, read config from env.

import * as ed from '@noble/ed25519'
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

  // Sanity log: derived public key. Lets operators map records back to this
  // service instance without re-deriving from the secret seed.
  const operatorPubKey = Buffer.from(await ed.getPublicKeyAsync(operatorPrivateKey)).toString('base64url')
  console.log(`  signing key (creator_key): ${operatorPubKey}`)

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

  // Self-claim: every record this service signs (directory_anchor extension
  // entries per §6.2.4) carries the operator key as creator_key. Without a
  // directory claim for that key, every anchor shows as "unclaimed" in the
  // public explorer. Publish a service-identity claim once at boot so the
  // operator key is always identified. Idempotent: skip if already published.
  await ensureSelfClaim(handle.url, operatorPubKey, operatorPrivateKey).catch((e: unknown) => {
    // Self-claim is best-effort. Failure must NOT prevent the service from
    // serving requests, operators can re-run manually if it doesn't land.
    console.error(`self-claim attempt failed (will retry on next boot): ${e instanceof Error ? e.message : String(e)}`)
  })

  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, () => {
      console.log(`received ${sig}, shutting down`)
      void handle.close().then(() => process.exit(0))
    })
  }
}

/**
 * Ensure the directory has published an identity claim for its own signing
 * key. Goes through the SAME public HTTP API that external clients use, so
 * the claim record + anchoring side-effects are identical (per-operation
 * anchoring per §6.2.4 emits a directory_anchor record to log-node).
 *
 * Idempotent: lookup first, only publish if absent.
 */
async function ensureSelfClaim(
  baseUrl: string,
  pubKey: string,
  privateKey: Buffer,
): Promise<void> {
  const lookup = await fetch(`${baseUrl}/v6/lookup/${encodeURIComponent(pubKey)}`).then((r) => r.json()).catch(() => null) as
    | { claim: unknown | null }
    | null
  if (lookup && lookup.claim) {
    console.log(`  self-claim already published for ${pubKey}`)
    return
  }

  // Build + sign a service-identity claim for this directory.
  const { signClaim } = await import('@atrib/directory')
  const signed = await signClaim(
    {
      creator_key: pubKey,
      claim_type: 'self_attested',
      claim_method: 'self',
      claim_subject: {
        display_name: `directory.atrib.dev (service identity)`,
        organization: 'atrib reference directory, signs §6.2.4 directory_anchor records',
      },
    },
    new Uint8Array(privateKey),
  )

  const res = await fetch(`${baseUrl}/v6/publish`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(signed),
  })
  if (!res.ok) {
    throw new Error(`self-claim publish returned ${res.status}: ${await res.text().catch(() => '')}`)
  }
  console.log(`  self-claim published for ${pubKey}`)
}

main().catch((e) => {
  console.error('fatal:', e)
  process.exit(1)
})
