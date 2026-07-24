// SPDX-License-Identifier: Apache-2.0

export type RevisionRelation = 'duplicate' | 'next' | 'gap' | 'out_of_order'

export function revisionRelation(current: number, incoming: number): RevisionRelation {
  if (incoming === current) return 'duplicate'
  if (incoming < current) return 'out_of_order'
  if (incoming === current + 1) return 'next'
  return 'gap'
}
