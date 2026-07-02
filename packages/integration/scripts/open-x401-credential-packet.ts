// SPDX-License-Identifier: Apache-2.0

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runOpenX401CredentialE2E } from '../src/open-x401-credential-e2e.js'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptDir, '../../..')
const packageJson = JSON.parse(await readFile(resolve(scriptDir, '../package.json'), 'utf8')) as {
  devDependencies?: Record<string, string>
}

const outDir =
  process.env.ATRIB_PACKET_OUT_DIR ?? resolve(repoRoot, 'proof-packets/x401-open-credential-e2e')

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`
}

function packetReadme(input: {
  attemptedHash: string
  successfulHash: string
  proofRequestHash: string | null
  proofResponseHash: string | null
  proofResultHash: string | null
}): string {
  return `# x401 open credential proof artifact

This proof signs an x401 protected-route flow with an open local credential verifier.

## Action path

\`GET /open-x401/protected -> 401 PROOF-REQUEST -> stale nonce rejection -> valid PROOF-RESPONSE -> 200 PROOF-RESULT\`

## What ran

- Upstream surface: \`@proof.com/x401-node@0.3.0\` current-spec wire SDK.
- Credential verifier: local JWT VC issuer plus signed VP token verifier.
- atrib path: signed attempted action plus signed successful action linked through \`informed_by\`.
- Record policy: public packet keeps hashes, verifier outcomes, package versions, and key thumbprints.
- Publish policy: \`offline-local-sanitized\`.

## Public record refs

These records are local proof records. They were not submitted to \`log.atrib.dev\`.

| Tool | Record hash | Public log index |
| ---- | ----------- | ---------------- |
| open_x401_credential_fetch_attempt | ${input.attemptedHash} | none |
| open_x401_credential_fetch_success | ${input.successfulHash} | none |

## Evidence hashes

| Evidence | Hash |
| -------- | ---- |
| PROOF-REQUEST | ${input.proofRequestHash ?? 'missing'} |
| PROOF-RESPONSE | ${input.proofResponseHash ?? 'missing'} |
| PROOF-RESULT | ${input.proofResultHash ?? 'missing'} |

## Redaction line

The verifier saw local credential material: issuer private key, holder private key, JWT VC, signed VP token, and the raw \`PROOF-RESPONSE\` carrying the VP token. The public artifact stores only hashes, key thumbprints, and verifier outcomes. See \`redaction-manifest.json\`.

## Proof-hosted credential boundary

This packet closes public x401 protocol E2E without a Proof platform account. A live Proof-hosted credential path is separate provider interop. It is useful when we need to show that a Proof-issued credential can feed caller-owned x401 \`resultVerified\` evidence, but it is not required to prove the x401 challenge, response, result, credential-verifier, and signed-action chain.

## Proof web and demo boundary

\`proof-vc-web\` is a browser UX reference for credential collection. \`verifier-vcp-demo\` is a product-flow reference that still classifies as legacy x401 wire in the live guard. Neither is a core atrib runtime dependency or a normative x401 wire source today.

## Regenerate

\`\`\`bash
pnpm --filter @atrib/integration open-x401-credential-packet
\`\`\`

Use \`ATRIB_PACKET_OUT_DIR=/tmp/x401-packet\` to write a temporary packet instead of replacing this checked-in snapshot.
`
}

const result = await runOpenX401CredentialE2E()
const x401Evidence = result.public_evidence.find((block) => block.protocol === 'x401')

const verifierOutput = {
  schema: 'atrib.proof_packet.verifier_output.v1',
  packet: 'x401-open-credential-e2e',
  mode: 'offline-local',
  live_upstream: false,
  upstream_shape:
    '@proof.com/x401-node@0.3.0 current-spec x401 wire SDK with local JWT VC / signed VP verifier',
  operations: ['protected_fetch_attempt', 'stale_nonce_retry', 'protected_fetch_success'],
  attempts: result.attempts,
  records: [
    {
      tool_name: 'open_x401_credential_fetch_attempt',
      record_hash: result.record_hashes.attempted_action,
      log_index: null,
    },
    {
      tool_name: 'open_x401_credential_fetch_success',
      record_hash: result.record_hashes.successful_action,
      log_index: null,
      informed_by: [result.record_hashes.attempted_action],
    },
  ],
  verifier: {
    record_valid: result.verification.valid,
    warnings: result.verification.warnings,
    x401_evidence_valid: x401Evidence?.valid ?? null,
    informed_by_resolved: result.verification.informed_by_resolution?.resolved ?? [],
  },
  credential_verification: result.credential_verification,
  public_packet: result.public_packet,
  privacy: {
    raw_credential_material_stored: result.public_packet.raw_credential_material_stored,
    public_packet_contains_raw_presentation_token_field: JSON.stringify(
      result.public_packet,
    ).includes('vp_token'),
    public_packet_contains_verifiable_credential_field: JSON.stringify(
      result.public_packet,
    ).includes('verifiableCredential'),
    public_evidence_contains_raw_presentation_token_field: JSON.stringify(
      result.public_evidence,
    ).includes('vp_token'),
  },
}

const redactionManifest = {
  schema: 'atrib.proof_packet.redaction_manifest.v1',
  packet: 'x401-open-credential-e2e',
  private_fields: [
    {
      field: 'issuer_private_key',
      disclosure: 'omitted-local-only',
    },
    {
      field: 'holder_private_key',
      disclosure: 'omitted-local-only',
    },
    {
      field: 'jwt_vc',
      disclosure: 'omitted-local-only',
    },
    {
      field: 'signed_vp_token',
      disclosure: 'omitted-local-only',
    },
    {
      field: 'proof_response_header',
      disclosure: 'hash-only',
      hash: result.public_packet.proof_response_hash,
    },
    {
      field: 'proof_request_header',
      disclosure: 'hash-only',
      hash: result.public_packet.proof_request_hash,
    },
    {
      field: 'proof_result_header',
      disclosure: 'hash-only',
      hash: result.public_packet.proof_result_hash,
    },
    {
      field: 'private_authorization_evidence',
      disclosure: 'omitted-public-evidence-only',
    },
  ],
}

const provenance = {
  schema: 'atrib.proof_packet.provenance.v1',
  packet: 'x401-open-credential-e2e',
  generated_at: new Date().toISOString(),
  source_command: 'pnpm --filter @atrib/integration open-x401-credential-packet',
  source_files: [
    'packages/integration/src/open-x401-credential-e2e.ts',
    'packages/integration/scripts/open-x401-credential-packet.ts',
    'packages/integration/test/x401-evidence-e2e.test.ts',
  ],
  dependencies: {
    '@proof.com/x401-node': packageJson.devDependencies?.['@proof.com/x401-node'] ?? null,
    jose: packageJson.devDependencies?.jose ?? null,
  },
  verification_commands: [
    'pnpm --filter @atrib/integration open-x401-credential-e2e',
    'pnpm --filter @atrib/integration test -- test/x401-evidence-e2e.test.ts',
  ],
  public_log_submission: false,
  public_log_reason:
    'The packet proves the x401 credential gate and signed action chain while keeping raw credential material local.',
}

await mkdir(outDir, { recursive: true })
await writeFile(
  resolve(outDir, 'README.md'),
  packetReadme({
    attemptedHash: result.record_hashes.attempted_action,
    successfulHash: result.record_hashes.successful_action,
    proofRequestHash: result.public_packet.proof_request_hash,
    proofResponseHash: result.public_packet.proof_response_hash,
    proofResultHash: result.public_packet.proof_result_hash,
  }),
)
await writeFile(resolve(outDir, 'verifier-output.json'), json(verifierOutput))
await writeFile(resolve(outDir, 'redaction-manifest.json'), json(redactionManifest))
await writeFile(resolve(outDir, 'provenance.json'), json(provenance))

console.log(
  json({
    ok: true,
    packet: 'x401-open-credential-e2e',
    artifact_dir: outDir,
    record_hashes: result.record_hashes,
    proof_request_hash: result.public_packet.proof_request_hash,
    proof_response_hash: result.public_packet.proof_response_hash,
    proof_result_hash: result.public_packet.proof_result_hash,
    raw_credential_material_stored: false,
  }),
)
