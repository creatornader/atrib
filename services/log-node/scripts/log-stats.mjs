#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0

/**
 * log-stats.mjs, print a one-page summary of the deployed log's state.
 *
 * Usage:
 *   LOG_ENDPOINT=https://log.atrib.dev/v1 node scripts/log-stats.mjs
 *   (default: https://log.atrib.dev/v1)
 *
 * Calls GET /v1/stats and renders the response with colored output and
 * percentage breakdowns. Designed for ad-hoc operator visibility, no
 * dependencies beyond node fetch.
 *
 * Exit code 0 on success, 1 if the endpoint is unreachable or returns
 * non-JSON.
 */

const LOG_ENDPOINT = (process.env.LOG_ENDPOINT ?? 'https://log.atrib.dev/v1').replace(/\/$/, '')

const cyan = (s) => `\x1b[36m${s}\x1b[0m`
const green = (s) => `\x1b[32m${s}\x1b[0m`
const yellow = (s) => `\x1b[33m${s}\x1b[0m`
const magenta = (s) => `\x1b[35m${s}\x1b[0m`
const bold = (s) => `\x1b[1m${s}\x1b[0m`
const dim = (s) => `\x1b[2m${s}\x1b[0m`

function fmtTimestamp(ms) {
  if (ms === null || ms === undefined) return dim('(none)')
  const d = new Date(ms)
  return `${d.toISOString()} ${dim('(' + ms + ')')}`
}

function fmtPct(part, total) {
  if (total === 0) return '0.0%'
  return ((part / total) * 100).toFixed(1) + '%'
}

async function main() {
  const url = `${LOG_ENDPOINT}/stats`
  let res
  try {
    res = await fetch(url)
  } catch (err) {
    console.error(`error: failed to reach ${url}: ${err.message}`)
    process.exit(1)
  }
  if (!res.ok) {
    console.error(`error: ${url} returned HTTP ${res.status}`)
    const body = await res.text()
    if (body) console.error(body)
    process.exit(1)
  }

  let stats
  try {
    stats = await res.json()
  } catch (err) {
    console.error(`error: ${url} returned non-JSON: ${err.message}`)
    process.exit(1)
  }

  const total = stats.tree_size
  const ev = stats.entries_by_event_type

  console.log()
  console.log(bold('atrib log status'))
  console.log(dim('─'.repeat(60)))
  console.log(`  endpoint:           ${cyan(LOG_ENDPOINT)}`)
  console.log(`  tree size:          ${bold(String(total))} entries`)
  console.log(`  distinct signers:   ${bold(String(stats.distinct_signers))} ${dim('creator_keys')}`)
  console.log(`  oldest entry:       ${fmtTimestamp(stats.oldest_timestamp_ms)}`)
  console.log(`  newest entry:       ${fmtTimestamp(stats.newest_timestamp_ms)}`)
  console.log()
  console.log(bold('  entries by event_type'))
  console.log(`    ${green('tool_call')}    ${String(ev.tool_call).padStart(6)}  ${dim('(' + fmtPct(ev.tool_call, total) + ')')}`)
  console.log(`    ${magenta('transaction')}  ${String(ev.transaction).padStart(6)}  ${dim('(' + fmtPct(ev.transaction, total) + ')')}`)
  console.log(`    ${cyan('observation')}  ${String(ev.observation).padStart(6)}  ${dim('(' + fmtPct(ev.observation, total) + ')')}`)
  console.log(`    ${yellow('extension')}    ${String(ev.extension).padStart(6)}  ${dim('(' + fmtPct(ev.extension, total) + ')')}`)
  if (ev.reserved > 0) {
    console.log(`    ${yellow('reserved')}     ${String(ev.reserved).padStart(6)}  ${dim('(' + fmtPct(ev.reserved, total) + ')')} ${yellow('(unexpected; investigate)')}`)
  }
  console.log()
}

main().catch((err) => {
  console.error('unexpected error:', err)
  process.exit(1)
})
