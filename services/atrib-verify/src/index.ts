// SPDX-License-Identifier: Apache-2.0

// @atrib/verify-mcp is the legacy home of the atrib-verify read primitive
// (cognitive primitive #7 of D079/D106). The implementation lives in
// @atrib/recall per the attest/recall rename: handoff verification folds
// into the `recall` verb's `verification` parameter, and the atrib-verify
// tool name stays mounted as a permanent alias over the same handler. This
// package re-exports the surface so existing imports keep working, and its
// hard dependency on @atrib/verify guarantees the verifier peer resolves
// for every consumer of this package (@atrib/recall alone treats it as an
// optional peer).
export {
  createAtribVerifyServer,
  handleAtribVerify,
  registerVerifyTool,
  tryHandleAtribVerify,
  VerifyInput,
} from '@atrib/recall'
export type {
  AtribVerifyInput,
  AtribVerifyOutput,
  AtribVerifyServer,
  RecallVerificationBlock,
} from '@atrib/recall'
