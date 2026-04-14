// SPDX-License-Identifier: Apache-2.0

/**
 * Policy builder. helper for composing policy documents from templates.
 *
 * Combines a base policy with overrides for edge weights, modifiers,
 * and constraints. Fields from the override replace fields in the base;
 * modifiers are concatenated (base modifiers first, then override modifiers).
 */

import { DEFAULT_POLICY, isValidPolicy } from './calculate.js'
import type { PolicyDocument, Modifier, PolicyConstraints } from './types.js'

type EdgeWeightOverrides = Partial<Record<string, number>>

/**
 * Build a policy document by combining a base policy with overrides.
 *
 * - `edge_weights`: merged (override values replace base values per key)
 * - `modifiers`: concatenated (base first, then additions)
 * - `constraints`: merged (override values replace base values per key)
 * - `role`, `distribution`: override replaces base if provided
 *
 * Throws if the resulting policy fails validation.
 */
export function buildPolicy(
  base: PolicyDocument,
  overrides: {
    role?: PolicyDocument['role']
    edge_weights?: EdgeWeightOverrides
    modifiers?: Modifier[]
    constraints?: Partial<PolicyConstraints>
    distribution?: PolicyDocument['distribution']
  },
): PolicyDocument {
  const result: Record<string, unknown> = {
    spec_version: 'atrib/1.0',
    edge_weights: {
      ...base.edge_weights,
      ...overrides.edge_weights,
    },
    modifiers: [...(base.modifiers ?? []), ...(overrides.modifiers ?? [])],
    constraints: {
      ...base.constraints,
      ...overrides.constraints,
    },
  }
  if (overrides.role ?? base.role) result.role = overrides.role ?? base.role
  if (overrides.distribution ?? base.distribution) result.distribution = overrides.distribution ?? base.distribution

  if (!isValidPolicy(result)) {
    throw new Error('buildPolicy: resulting policy is invalid (check weights, constraints)')
  }

  return result as PolicyDocument
}

/**
 * Start from the default policy and apply overrides.
 * Shorthand for `buildPolicy(DEFAULT_POLICY, overrides)`.
 */
export function policyFrom(overrides: Parameters<typeof buildPolicy>[1]): PolicyDocument {
  return buildPolicy(DEFAULT_POLICY, overrides)
}
