// SPDX-License-Identifier: Apache-2.0

export const CURRENT_X401_HEADER_NAMES = [
  'PROOF-REQUEST',
  'PROOF-RESPONSE',
  'PROOF-RESULT',
] as const

export const LEGACY_X401_HEADER_NAMES = ['PROOF-REQUIRED', 'PROOF-PRESENTATION'] as const

export const CURRENT_X401_PAYLOAD_MARKERS = [
  'credential_requirements',
  'credential_result',
  'credential_result_uri',
  'result_artifact',
] as const

export const LEGACY_X401_PAYLOAD_MARKERS = [
  'presentation_requirements',
  'VP Artifact',
  'vp_artifact',
  'presentation_uri',
] as const

export const PROOF_REPO_SURFACE_NAMES = [
  'proof/x401',
  'proof/x401-node',
  'proof/proof-vc-common',
  'proof/proof-vc-web',
  'proof/verifier-vcp-demo',
] as const

export type ProofRepoSurfaceName = (typeof PROOF_REPO_SURFACE_NAMES)[number]

export type ProofRepoInteropStatus =
  | 'spec_source'
  | 'current_spec_sdk_ready'
  | 'legacy_x401_wire'
  | 'credential_verifier_helper'
  | 'browser_credential_ui_reference'
  | 'demo_current_spec_reference'
  | 'demo_legacy_x401'
  | 'not_checked'
  | 'unknown'

export interface ProofRepoSurfaceInput {
  repo: ProofRepoSurfaceName | string
  packageName?: string
  version?: string
  readme?: string
  packageJson?: string | Record<string, unknown>
  sourceText?: string
}

export interface ProofRepoSurfaceReport {
  repo: string
  package_name: string | null
  version: string | null
  role: string
  interop_status: ProofRepoInteropStatus
  current_spec_wire_ready: boolean
  runtime_dependency_allowed: boolean
  safe_in_atrib_core: boolean
  evidence: {
    found_current_headers: string[]
    missing_current_headers: string[]
    found_legacy_headers: string[]
    found_current_payload_markers: string[]
    missing_current_payload_markers: string[]
    found_legacy_payload_markers: string[]
    found_helper_markers: string[]
    package_dependencies: string[]
  }
  required_next_step: string
  recommendation: string
}

export interface ProofX401SdkCompatInput {
  packageName: string
  version: string
  readme: string
}

export interface ProofX401SdkCompatReport {
  package_name: string
  version: string
  compatible_with_current_spec: boolean
  found_current_headers: string[]
  missing_current_headers: string[]
  found_legacy_headers: string[]
  found_current_payload_markers: string[]
  missing_current_payload_markers: string[]
  found_legacy_payload_markers: string[]
  recommendation: string
}

function presentMarkers(readme: string, markers: readonly string[]): string[] {
  return markers.filter((marker) => readme.includes(marker))
}

function missingMarkers(readme: string, markers: readonly string[]): string[] {
  return markers.filter((marker) => !readme.includes(marker))
}

function normalizeRepoName(repo: string): string {
  if (repo.startsWith('proof/')) return repo
  return `proof/${repo}`
}

function parsePackageJson(
  value: string | Record<string, unknown> | undefined,
): Record<string, unknown> | null {
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null
    } catch {
      return null
    }
  }
  if (value !== undefined && value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return value
  }
  return null
}

function stringMember(record: Record<string, unknown> | null, key: string): string | null {
  const value = record?.[key]
  return typeof value === 'string' ? value : null
}

function dependencyNames(packageJson: Record<string, unknown> | null): string[] {
  const sections = ['dependencies', 'devDependencies', 'peerDependencies']
  const names = new Set<string>()
  for (const section of sections) {
    const value = packageJson?.[section]
    if (value === null || typeof value !== 'object' || Array.isArray(value)) continue
    for (const name of Object.keys(value)) names.add(name)
  }
  return Array.from(names).sort()
}

function reportEvidence(text: string, packageJson: Record<string, unknown> | null) {
  const helperMarkers = [
    'verifyVPToken',
    'getDCAPIAuthorizationRequest',
    'ProofCredentialV1',
    'proof-verify-id',
    'ProofVerifyId',
    '@sd-jwt/sd-jwt-vc',
    '@owf/identity-common',
    '@proof.com/x401-node',
  ]
  const dependencies = dependencyNames(packageJson)
  const dependencyText = dependencies.join('\n')
  const combinedText = `${text}\n${dependencyText}`

  return {
    found_current_headers: presentMarkers(combinedText, CURRENT_X401_HEADER_NAMES),
    missing_current_headers: missingMarkers(combinedText, CURRENT_X401_HEADER_NAMES),
    found_legacy_headers: presentMarkers(combinedText, LEGACY_X401_HEADER_NAMES),
    found_current_payload_markers: presentMarkers(combinedText, CURRENT_X401_PAYLOAD_MARKERS),
    missing_current_payload_markers: missingMarkers(combinedText, CURRENT_X401_PAYLOAD_MARKERS),
    found_legacy_payload_markers: presentMarkers(combinedText, LEGACY_X401_PAYLOAD_MARKERS),
    found_helper_markers: presentMarkers(combinedText, helperMarkers),
    package_dependencies: dependencies,
  }
}

function buildReport(input: {
  repo: string
  packageName: string | null
  version: string | null
  role: string
  interopStatus: ProofRepoInteropStatus
  currentSpecWireReady: boolean
  runtimeDependencyAllowed: boolean
  safeInAtribCore: boolean
  evidence: ProofRepoSurfaceReport['evidence']
  requiredNextStep: string
  recommendation: string
}): ProofRepoSurfaceReport {
  return {
    repo: input.repo,
    package_name: input.packageName,
    version: input.version,
    role: input.role,
    interop_status: input.interopStatus,
    current_spec_wire_ready: input.currentSpecWireReady,
    runtime_dependency_allowed: input.runtimeDependencyAllowed,
    safe_in_atrib_core: input.safeInAtribCore,
    evidence: input.evidence,
    required_next_step: input.requiredNextStep,
    recommendation: input.recommendation,
  }
}

export function classifyProofX401NodeReadme(
  input: ProofX401SdkCompatInput,
): ProofX401SdkCompatReport {
  const foundCurrentHeaders = presentMarkers(input.readme, CURRENT_X401_HEADER_NAMES)
  const missingCurrentHeaders = missingMarkers(input.readme, CURRENT_X401_HEADER_NAMES)
  const foundLegacyHeaders = presentMarkers(input.readme, LEGACY_X401_HEADER_NAMES)
  const foundCurrentPayloadMarkers = presentMarkers(input.readme, CURRENT_X401_PAYLOAD_MARKERS)
  const missingCurrentPayloadMarkers = missingMarkers(input.readme, CURRENT_X401_PAYLOAD_MARKERS)
  const foundLegacyPayloadMarkers = presentMarkers(input.readme, LEGACY_X401_PAYLOAD_MARKERS)

  const compatible =
    missingCurrentHeaders.length === 0 &&
    foundLegacyHeaders.length === 0 &&
    foundCurrentPayloadMarkers.length >= 2 &&
    foundLegacyPayloadMarkers.length === 0

  return {
    package_name: input.packageName,
    version: input.version,
    compatible_with_current_spec: compatible,
    found_current_headers: foundCurrentHeaders,
    missing_current_headers: missingCurrentHeaders,
    found_legacy_headers: foundLegacyHeaders,
    found_current_payload_markers: foundCurrentPayloadMarkers,
    missing_current_payload_markers: missingCurrentPayloadMarkers,
    found_legacy_payload_markers: foundLegacyPayloadMarkers,
    recommendation: compatible
      ? 'Proof x401 Node SDK appears aligned with current x401 header and payload names.'
      : 'Do not claim Proof SDK interop. Keep atrib on current-spec local x401 E2E until the SDK exposes current header and payload names.',
  }
}

export function classifyMissingProofRepoSurface(
  repo: ProofRepoSurfaceName | string,
): ProofRepoSurfaceReport {
  return buildReport({
    repo: normalizeRepoName(repo),
    packageName: null,
    version: null,
    role: 'not checked',
    interopStatus: 'not_checked',
    currentSpecWireReady: false,
    runtimeDependencyAllowed: false,
    safeInAtribCore: false,
    evidence: {
      found_current_headers: [],
      missing_current_headers: [...CURRENT_X401_HEADER_NAMES],
      found_legacy_headers: [],
      found_current_payload_markers: [],
      missing_current_payload_markers: [...CURRENT_X401_PAYLOAD_MARKERS],
      found_legacy_payload_markers: [],
      found_helper_markers: [],
      package_dependencies: [],
    },
    requiredNextStep: 'Clone or fetch this Proof repository before making an interop claim.',
    recommendation: 'Do not make a Proof interop claim from an unchecked repository surface.',
  })
}

export function classifyProofRepoSurface(input: ProofRepoSurfaceInput): ProofRepoSurfaceReport {
  const repo = normalizeRepoName(input.repo)
  const packageJson = parsePackageJson(input.packageJson)
  const packageName = input.packageName ?? stringMember(packageJson, 'name')
  const version = input.version ?? stringMember(packageJson, 'version')
  const text = [input.readme ?? '', input.sourceText ?? '', input.packageJson ?? '']
    .map((part) => (typeof part === 'string' ? part : JSON.stringify(part)))
    .join('\n')
  const evidence = reportEvidence(text, packageJson)

  if (repo === 'proof/x401-node') {
    const sdk = classifyProofX401NodeReadme({
      packageName: packageName ?? '@proof.com/x401-node',
      version: version ?? 'unknown',
      readme: text,
    })

    return buildReport({
      repo,
      packageName,
      version,
      role: 'x401 wire SDK',
      interopStatus: sdk.compatible_with_current_spec
        ? 'current_spec_sdk_ready'
        : 'legacy_x401_wire',
      currentSpecWireReady: sdk.compatible_with_current_spec,
      runtimeDependencyAllowed: sdk.compatible_with_current_spec,
      safeInAtribCore: sdk.compatible_with_current_spec,
      evidence,
      requiredNextStep: sdk.compatible_with_current_spec
        ? 'Pin a Proof SDK fixture and run the local proof-gate harness against it.'
        : 'Do not depend on this SDK yet. Sync constants, payload types, examples, and tests to current x401 header names first.',
      recommendation: sdk.recommendation,
    })
  }

  if (repo === 'proof/x401') {
    const currentSpecWireReady =
      evidence.missing_current_headers.length === 0 &&
      evidence.found_current_payload_markers.includes('credential_requirements')

    return buildReport({
      repo,
      packageName,
      version,
      role: 'x401 spec source',
      interopStatus: 'spec_source',
      currentSpecWireReady,
      runtimeDependencyAllowed: false,
      safeInAtribCore: false,
      evidence,
      requiredNextStep:
        'Track this repo for wire semantics, but depend on a released SDK or pinned fixture for runtime interop.',
      recommendation:
        'Use this as the source of truth for header and payload semantics. Do not treat a spec repo as a runtime dependency.',
    })
  }

  if (repo === 'proof/proof-vc-common') {
    return buildReport({
      repo,
      packageName,
      version,
      role: 'credential verifier helper',
      interopStatus: 'credential_verifier_helper',
      currentSpecWireReady: false,
      runtimeDependencyAllowed: false,
      safeInAtribCore: false,
      evidence,
      requiredNextStep:
        'Add an opt-in verifier fixture that turns Proof credential verification output into caller-owned x401 resultVerified evidence.',
      recommendation:
        'Use as a future credential-verifier fixture helper. Do not treat it as the x401 wire implementation.',
    })
  }

  if (repo === 'proof/proof-vc-web') {
    return buildReport({
      repo,
      packageName,
      version,
      role: 'browser credential UI reference',
      interopStatus: 'browser_credential_ui_reference',
      currentSpecWireReady: false,
      runtimeDependencyAllowed: false,
      safeInAtribCore: false,
      evidence,
      requiredNextStep:
        'Keep this in browser-demo scope only. Use it for Credential Manager UX fixtures after the wire SDK is current.',
      recommendation:
        'Reference browser UX patterns from this repo. Keep atrib core independent of the web component.',
    })
  }

  if (repo === 'proof/verifier-vcp-demo') {
    const currentSpecWireReady =
      evidence.missing_current_headers.length === 0 &&
      evidence.found_legacy_headers.length === 0 &&
      evidence.found_current_payload_markers.includes('credential_requirements')

    return buildReport({
      repo,
      packageName,
      version,
      role: 'Proof verifier demo',
      interopStatus: currentSpecWireReady ? 'demo_current_spec_reference' : 'demo_legacy_x401',
      currentSpecWireReady,
      runtimeDependencyAllowed: false,
      safeInAtribCore: false,
      evidence,
      requiredNextStep: currentSpecWireReady
        ? 'Turn the route into an opt-in external fixture, with raw credential payloads kept local.'
        : 'Wait for or propose a demo update from legacy x401 headers to current proof headers before using it as an interop fixture.',
      recommendation:
        'Use this as a reference demo only. It can become an opt-in fixture after it stops depending on legacy x401 wire names.',
    })
  }

  return buildReport({
    repo,
    packageName,
    version,
    role: 'unknown Proof surface',
    interopStatus: 'unknown',
    currentSpecWireReady: false,
    runtimeDependencyAllowed: false,
    safeInAtribCore: false,
    evidence,
    requiredNextStep: 'Classify this repository by role before using it in the x401 integration.',
    recommendation:
      'Do not add an unknown Proof repository as an atrib runtime dependency or interop fixture.',
  })
}

export function classifyProofRepoSurfaces(
  inputs: readonly ProofRepoSurfaceInput[],
): ProofRepoSurfaceReport[] {
  return inputs.map((input) => classifyProofRepoSurface(input))
}
