import { spawnSync } from 'node:child_process'

// Fails a pull request whose branch carries more than one independent concern,
// so a squash merge cannot fold unrelated work (a fix plus a feature plus
// unrelated docs and tests) into a single commit that erases per-commit blame.
//
// Self-contained on purpose: this runs in public CI with no external
// dependencies. The lead-vs-support type rule is documented inline below.

const LEAD_TYPES = new Set(['feat', 'fix', 'refactor', 'perf', 'revert'])
const SUPPORT_TYPES = new Set(['docs', 'test', 'chore', 'style', 'ci', 'build'])
const KNOWN_TYPES = new Set([...LEAD_TYPES, ...SUPPORT_TYPES])
const CONVENTIONAL_RE = /^([a-z]+)(\([^)]*\))?(!)?:\s+/i

const options = parseArgs(process.argv.slice(2))
const allTypes = options.allTypes || isTruthy(process.env.CONCERN_ALL_TYPES)

if (options.title && /\[allow-mixed\]/i.test(options.title)) {
  console.log('concern check skipped: PR title carries [allow-mixed]')
  process.exit(0)
}

if (!options.base || !options.head) {
  console.error('check-pr-concerns: --base and --head are required')
  process.exit(2)
}

const commits = listRangeCommits(options.base, options.head)
if (commits.length === 0) {
  console.log(`no commits in ${options.base}..${options.head}; nothing to check`)
  process.exit(0)
}

const classification = classifyCommits(commits)
const breakdown = summarize(classification)
const mixed = allTypes ? classification.types.length >= 2 : classification.leadTypes.length >= 2

console.log(`range: ${options.base}..${options.head}`)
console.log(`commits: ${classification.concernCount} concern, ${classification.mergeNoiseCount} merge`)
console.log(`types: ${breakdown}`)
console.log(`rule: ${allTypes ? 'all-types' : 'lead-types'}`)

if (!mixed) {
  console.log('verdict: single-concern')
  process.exit(0)
}

console.log('verdict: multi-concern')
for (const type of classification.types) {
  for (const subject of classification.byType[type]) {
    console.log(`  ${type}: ${subject}`)
  }
}
console.error(
  '\nThis branch mixes multiple concerns. A squash merge would fold them into one ' +
    'commit and break per-commit blame. Split the unrelated changes into separate ' +
    'one-concern PRs, or add [allow-mixed] to the PR title for a deliberate exception.',
)
process.exit(1)

function parseArgs(argv) {
  const out = { base: null, head: 'HEAD', title: '', allTypes: false }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--base') out.base = argv[++i]
    else if (arg === '--head') out.head = argv[++i]
    else if (arg === '--title') out.title = argv[++i] || ''
    else if (arg === '--all-types') out.allTypes = true
    else {
      console.error(`check-pr-concerns: unknown argument ${arg}`)
      process.exit(2)
    }
  }
  return out
}

function isTruthy(value) {
  return /^(1|true|all|strict|yes)$/i.test(String(value || ''))
}

function listRangeCommits(base, head) {
  const result = spawnSync('git', ['log', '--format=%H%x1f%P%x1f%s', `${base}..${head}`], {
    encoding: 'utf8',
  })
  if (result.status !== 0) {
    console.error(`check-pr-concerns: git log failed: ${(result.stderr || '').trim()}`)
    process.exit(2)
  }
  return (result.stdout || '')
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const fields = line.split('\x1f')
      const parents = (fields[1] || '').trim()
      return { subject: fields[2] || '', parents: parents ? parents.split(/\s+/).length : 0 }
    })
}

function parseSubject(subject) {
  const text = String(subject || '').trim()
  if (!text) return { subject: text, type: null, mergeNoise: false }
  const isPlainMerge = /^merge\s/i.test(text)
  const isChoreMerge = /^chore(\([^)]*\))?!?:\s+merge\b/i.test(text)
  const match = text.match(CONVENTIONAL_RE)
  return {
    subject: text,
    type: match ? match[1].toLowerCase() : null,
    mergeNoise: isPlainMerge || isChoreMerge,
  }
}

function classifyCommits(rawCommits) {
  const byType = {}
  const untyped = []
  let mergeNoiseCount = 0
  let concernCount = 0

  for (const commit of rawCommits) {
    const info = parseSubject(commit.subject)
    const isMerge = info.mergeNoise || commit.parents > 1
    if (isMerge) {
      mergeNoiseCount += 1
      continue
    }
    concernCount += 1
    if (!info.type || !KNOWN_TYPES.has(info.type)) {
      untyped.push(info.subject)
      continue
    }
    ;(byType[info.type] ||= []).push(info.subject)
  }

  const types = Object.keys(byType).sort()
  return {
    byType,
    types,
    leadTypes: types.filter((type) => LEAD_TYPES.has(type)),
    supportTypes: types.filter((type) => SUPPORT_TYPES.has(type)),
    untyped,
    mergeNoiseCount,
    concernCount,
  }
}

function summarize(classification) {
  const parts = classification.types.map((type) => `${type}×${classification.byType[type].length}`)
  if (classification.untyped.length) parts.push(`untyped×${classification.untyped.length}`)
  if (classification.mergeNoiseCount) parts.push(`merge×${classification.mergeNoiseCount}`)
  return parts.join(', ') || 'no commits'
}
