// SPDX-License-Identifier: Apache-2.0

// @atrib/cli. Public API (library exports for programmatic use).

export { keygen, printKeypair } from './keygen.js'
export {
  IDENTITY_PROFILE_SCHEMA,
  createIdentityProfile,
  identityProfileDirectory,
  identityProfileErrors,
  identityProfileExists,
  identityProfilePath,
  identityActiveRun,
  identityDelegationCertificates,
  identityRevokedKeys,
  identityRevocationEvidence,
  issueIdentityRun,
  loadIdentityProfile,
  rotateIdentityRun,
  saveIdentityProfile,
  validateProfileName,
  withIdentityProfileLock,
} from './identity.js'
export type {
  CreateIdentityProfileOptions,
  IdentityActiveRun,
  IdentityKeySource,
  IdentityProfile,
  IdentityRun,
  IdentityRunRevocation,
  IdentityRunRevocationRecord,
  IdentityRunRotation,
  NamedIdentity,
  PrincipalKind,
} from './identity.js'
