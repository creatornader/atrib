// SPDX-License-Identifier: Apache-2.0
// Contract model only. This is not installed middleware or an app executor.
export async function exerciseRetentionFixture(protectedPath: boolean, failRetention: boolean) {
  let handlerCalls = 0
  let gap = false
  const retain = async () => {
    if (failRetention) throw new Error('fixture storage failure')
  }
  try {
    await retain()
  } catch {
    gap = true
    if (protectedPath) return { refused: true, gap, handler_calls: handlerCalls }
  }
  handlerCalls++
  return { refused: false, gap, handler_calls: handlerCalls }
}
