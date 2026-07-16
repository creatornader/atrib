// SPDX-License-Identifier: Apache-2.0

// @atrib/annotate is the legacy home of the atrib-annotate write primitive
// (cognitive primitive #2 of D079). The implementation lives in
// @atrib/attest: annotation folds into the write verb as
// attest ref.kind='annotates', and the atrib-annotate tool name stays
// mounted as a permanent alias over the same handler. Records signed
// through either surface are byte-identical in canonical form.
export {
  AnnotateInput,
  Importance,
  createAtribAnnotateServer,
  registerAnnotateTool,
} from '@atrib/attest'
export type { AtribAnnotateServer, CreateAtribAnnotateServerOptions } from '@atrib/attest'
