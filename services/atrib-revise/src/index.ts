// SPDX-License-Identifier: Apache-2.0

// @atrib/revise is the legacy home of the atrib-revise write primitive
// (cognitive primitive #3 of D079). The implementation lives in
// @atrib/attest: revision folds into the write verb as
// attest ref.kind='revises', and the atrib-revise tool name stays mounted
// as a permanent alias over the same handler. Records signed through
// either surface are byte-identical in canonical form.
export {
  ReviseInput,
  createAtribReviseServer,
  registerReviseTool,
} from '@atrib/attest'
export type { AtribReviseServer, CreateAtribReviseServerOptions } from '@atrib/attest'
