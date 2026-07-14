// SPDX-License-Identifier: Apache-2.0

// @atrib/emit is the legacy home of the write primitive. The implementation
// lives in @atrib/attest (the write verb, per the attest/recall rename);
// this package re-exports the full surface so existing imports keep
// working. Records signed through either package are byte-identical in
// canonical form: both route through the same handleEmit funnel.
export * from '@atrib/attest'
