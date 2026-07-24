// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import {
  base64urlEncode,
  getPublicKey,
  signRecord,
  verifyRecord,
  type AtribRecord,
} from '@atrib/mcp'
import {
  buildCoverageAttestationContent,
  createCoverageManifest,
  createLogWindowManifest,
  hashCanonical,
  hashCoverageAttestationContent,
  hashRuntimeLogEvent,
  hashSessionDefinition,
  verifyCoverageManifest,
  type CoverageActionRef,
  type CoverageManifest,
  type CoverageSurface,
  type ExpectedCoverageAction,
} from '../src/index.js'

const surfaces: CoverageSurface[] = [
  {
    id: 'mcp',
    boundary: 'mcp-server-dispatch',
    owner: '@atrib/mcp-wrap',
    required: true,
    action_kinds: ['tools/call'],
  },
  {
    id: 'telemetry',
    boundary: 'openinference-span-export',
    owner: 'host',
    required: false,
  },
]

const expectedActions: ExpectedCoverageAction[] = [
  {
    action_id: 'runtime-event-2',
    surface_id: 'mcp',
    action_hash: hashRuntimeLogEvent({ type: 'tools/call', tool: 'weather.lookup' }),
  },
  {
    action_id: 'runtime-event-3',
    surface_id: 'telemetry',
    action_hash: hashRuntimeLogEvent({ type: 'span', name: 'weather.lookup' }),
  },
]

const capturedRecord = hashCanonical({ record: 'weather.lookup' })

function runtimeManifest() {
  const events = [
    {
      event_id: 'runtime-event-1',
      position: 1,
      event_hash: hashRuntimeLogEvent({ type: 'plan' }),
    },
    {
      event_id: 'runtime-event-2',
      position: 2,
      event_hash: expectedActions[0]?.action_hash as `sha256:${string}`,
    },
    {
      event_id: 'runtime-event-3',
      position: 3,
      event_hash: expectedActions[1]?.action_hash as `sha256:${string}`,
    },
  ]
  return createLogWindowManifest({
    source: { id: 'fixture.runtime-log', kind: 'jsonl', version: '1' },
    runtime: { name: 'fixture-runtime', version: '1.0.0' },
    session: {
      id: 'coverage-session',
      digest: hashSessionDefinition({ id: 'coverage-session' }),
    },
    window: { start: 1, end: 3 },
    events,
    privacy_posture: 'host-owned',
    verifier_policy: { require_event_root: true },
  })
}

function capturedActions(): CoverageActionRef[] {
  return [
    {
      ...expectedActions[0],
      state: 'captured',
      record_hash: capturedRecord,
    },
    {
      ...expectedActions[1],
      state: 'skipped',
      reason_code: 'optional-export-disabled',
    },
  ]
}

describe('coverage manifests', () => {
  it('is committed by a valid signed atrib record through args_hash', async () => {
    const manifest = createCoverageManifest({
      log_window_manifest: runtimeManifest(),
      surfaces,
      actions: capturedActions(),
    })
    const seed = new Uint8Array(32).fill(71)
    const record = await signRecord(
      {
        spec_version: 'atrib/1.0',
        content_id: hashCoverageAttestationContent(manifest),
        creator_key: base64urlEncode(await getPublicKey(seed)),
        chain_root: hashCanonical({ genesis: 'coverage-session' }),
        event_type: 'https://atrib.dev/v1/types/observation',
        context_id: '71000000000000000000000000000000',
        timestamp: Date.now(),
        args_hash: hashCoverageAttestationContent(manifest),
        signature: '',
      } as AtribRecord,
      seed,
    )

    expect(await verifyRecord(record)).toBe(true)
    expect(
      verifyCoverageManifest(
        manifest,
        { attestation_args_hash: record.args_hash },
        { require_attestation: true },
      ),
    ).toMatchObject({ valid: true })
  })

  it('binds expected surfaces and action state to a signed attestation commitment', () => {
    const logWindow = runtimeManifest()
    const manifest = createCoverageManifest({
      log_window_manifest: logWindow,
      surfaces,
      actions: capturedActions(),
    })
    const content = buildCoverageAttestationContent(manifest)
    const result = verifyCoverageManifest(
      manifest,
      {
        attestation_args_hash: hashCoverageAttestationContent(manifest),
        log_window_manifest: logWindow,
        expected_actions: expectedActions,
        record_hashes: [capturedRecord],
      },
      {
        require_attestation: true,
        require_log_window_manifest: true,
        require_expected_action_evidence: true,
        require_record_evidence: true,
      },
    )

    expect(content.coverage_manifest_hash).toBe(hashCanonical(manifest))
    expect(manifest.summary).toEqual({
      expected: 2,
      captured: 1,
      skipped: 1,
      degraded: 0,
    })
    expect(result).toMatchObject({
      valid: true,
      basis: 'runtime-compared',
      issues: [],
    })
  })

  it('detects an action omitted relative to runtime-owned evidence', () => {
    const manifest = createCoverageManifest({
      log_window_manifest: runtimeManifest(),
      surfaces,
      actions: [capturedActions()[0] as CoverageActionRef],
    })
    const result = verifyCoverageManifest(manifest, {
      expected_actions: expectedActions,
    })

    expect(result.valid).toBe(false)
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: 'expected_action_omitted',
        action_id: 'runtime-event-3',
      }),
    )
  })

  it('fails closed when a required surface is skipped or degraded', () => {
    for (const state of ['skipped', 'degraded'] as const) {
      const manifest = createCoverageManifest({
        log_window_manifest: runtimeManifest(),
        surfaces,
        actions: [
          {
            ...expectedActions[0],
            state,
            reason_code: `${state}-fixture`,
          },
        ],
      })
      const result = verifyCoverageManifest(manifest)
      expect(result.valid).toBe(false)
      expect(result.issues).toContainEqual(
        expect.objectContaining({ code: `required_action_${state}` }),
      )
    }
  })

  it('rejects tampered roots and an unrelated attestation', () => {
    const manifest = createCoverageManifest({
      log_window_manifest: runtimeManifest(),
      surfaces,
      actions: capturedActions(),
    })
    const tampered = {
      ...manifest,
      actions: [
        {
          ...(manifest.actions[0] as CoverageActionRef),
          action_hash: hashCanonical({ tampered: true }),
        },
        manifest.actions[1] as CoverageActionRef,
      ],
    } as CoverageManifest
    const result = verifyCoverageManifest(
      tampered,
      { attestation_args_hash: hashCoverageAttestationContent(manifest) },
      { require_attestation: true },
    )

    expect(result.valid).toBe(false)
    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['action_root_mismatch', 'attestation_mismatch']),
    )
  })

  it('rejects copied identity fields that differ from the bound runtime window', () => {
    const logWindow = runtimeManifest()
    const manifest = createCoverageManifest({
      log_window_manifest: logWindow,
      surfaces,
      actions: capturedActions(),
    })
    const tampered = {
      ...manifest,
      session: { ...manifest.session, id: 'other-session' },
    } as CoverageManifest

    expect(verifyCoverageManifest(tampered, { log_window_manifest: logWindow })).toMatchObject({
      valid: false,
      issues: [expect.objectContaining({ code: 'log_window_manifest_mismatch' })],
    })
  })

  it('rejects duplicate expected-action evidence', () => {
    const manifest = createCoverageManifest({
      log_window_manifest: runtimeManifest(),
      surfaces,
      actions: capturedActions(),
    })
    const result = verifyCoverageManifest(manifest, {
      expected_actions: [...expectedActions, expectedActions[0] as ExpectedCoverageAction],
    })

    expect(result.valid).toBe(false)
    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: 'expected_action_evidence_duplicate' }),
    )
  })

  it('rejects duplicate surface and action identifiers at creation', () => {
    expect(() =>
      createCoverageManifest({
        log_window_manifest: runtimeManifest(),
        surfaces: [...surfaces, surfaces[0] as CoverageSurface],
        actions: capturedActions(),
      }),
    ).toThrow('duplicate coverage surface')
    expect(() =>
      createCoverageManifest({
        log_window_manifest: runtimeManifest(),
        surfaces,
        actions: [...capturedActions(), capturedActions()[0] as CoverageActionRef],
      }),
    ).toThrow('duplicate coverage action')
  })
})
