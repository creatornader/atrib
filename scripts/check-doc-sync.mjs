#!/usr/bin/env node
// Validate internal consistency of canonical docs.
//
// The CLAUDE.md sync-trigger table is enforcement-by-discipline: when an edge
// type is added, multiple files must be updated by hand. Real drift has shipped
// to main multiple times because that discipline broke down. This script
// mechanically catches the specific staleness shape — number-word count claims
// drifting out of sync with the underlying enumeration that determines them.
//
// Each check:
//   1. Derives the ground-truth count from a canonical enumeration (the place
//      that lists the items themselves).
//   2. Searches target files for "<number-word> <topic>" claims.
//   3. Flags claims whose number-word does not match ground truth.
//
// Exit 0 if all checks pass, 1 if any check fails.
// Usage: node scripts/check-doc-sync.mjs [--json]

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Minimal pnpm-workspace.yaml reader — extracts the quoted glob strings under
// the `packages:` key. Avoids pulling a yaml dep into the script.
function readWorkspaceGlobs() {
  const text = read('pnpm-workspace.yaml')
  const out = []
  let inPackages = false
  for (const line of text.split('\n')) {
    if (/^packages:\s*$/.test(line)) { inPackages = true; continue }
    if (inPackages) {
      const m = line.match(/^\s*-\s*['"]?([^'"\s]+)['"]?\s*$/)
      if (m) out.push(m[1])
      else if (/^\S/.test(line)) inPackages = false
    }
  }
  return out
}

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const JSON_MODE = process.argv.slice(2).includes('--json')

const NUMBER_WORDS = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight',
  'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen',
  'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty',
]

const findings = []

function record(level, check, message, detail) {
  findings.push({ level, check, message, detail })
}
const fail = (check, message, detail) => record('fail', check, message, detail)
const ok = (check, message) => record('ok', check, message)

function read(rel) {
  return readFileSync(join(ROOT, rel), 'utf8')
}

function lines(text) {
  return text.split('\n')
}

// Returns one entry per regex match per line; preserves capture groups
// (which String.match swallows when the regex carries the /g flag).
function findLineMatches(filePath, pattern) {
  const text = read(filePath)
  const out = []
  lines(text).forEach((line, i) => {
    for (const m of line.matchAll(pattern)) {
      out.push({ filePath, lineNo: i + 1, line, match: m })
    }
  })
  return out
}

// ─── Check 1: edge type count consistency ──────────────────────────────────
//
// Ground truth: the enumeration in CLAUDE.md's "Key technical decisions"
// section. The line begins "**<Word> edge types, deterministic derivation.**"
// and is followed by a comma-separated list of UPPER_SNAKE identifiers.
//
// Targets: README.md, ARCHITECTURE.md. Any "<word> edge type" claim must use
// the same number-word.

function checkEdgeTypeCount() {
  const check = 'edge-type-count'
  const claude = read('CLAUDE.md')
  const m = claude.match(
    /\*\*([A-Z][a-z]+) edge types,[^*]*\*\*\s*([\s\S]*?)Two implementations/
  )
  if (!m) {
    fail(check, 'CLAUDE.md "Key technical decisions" edge type enumeration not found')
    return
  }
  const claimedWord = m[1].toLowerCase()
  const enumeration = m[2]
  // Capture all-caps identifiers (length >= 4) that aren't ADR codes (D041, D058)
  // or doc filename roots (DECISIONS).
  const NON_EDGE_NOISE = new Set(['DECISIONS', 'ARCHITECTURE', 'CLAUDE'])
  const tokens = [...enumeration.matchAll(/\b([A-Z][A-Z0-9_]*[A-Z0-9])\b/g)]
    .map(x => x[1])
    .filter(t => t.length >= 4 && !/^D\d/.test(t) && !NON_EDGE_NOISE.has(t))
  const distinctEdges = [...new Set(tokens)]
  const actualCount = distinctEdges.length
  const expectedWord = NUMBER_WORDS[actualCount]

  if (claimedWord !== expectedWord) {
    fail(check,
      `CLAUDE.md self-inconsistent: claims "${claimedWord} edge types" but enumeration has ${actualCount} distinct identifiers`,
      { claimedWord, actualCount, distinctEdges })
    return
  }

  // Now scan README + ARCHITECTURE for any "<word> edge type" that disagrees.
  const targets = ['README.md', 'ARCHITECTURE.md']
  const numberWordPattern = NUMBER_WORDS.slice(1, 16).join('|') // exclude 'zero'
  const re = new RegExp(`\\b(${numberWordPattern})(\\s+|-)edge[ -]types?\\b`, 'gi')
  let mismatchCount = 0
  for (const t of targets) {
    const matches = findLineMatches(t, re)
    for (const m of matches) {
      const found = m.match[1].toLowerCase()
      if (found !== expectedWord) {
        fail(check,
          `${t}:${m.lineNo} says "${m.match[0]}", expected "${expectedWord} edge types" (CLAUDE.md ground truth)`,
          { file: t, line: m.lineNo, found, expected: expectedWord, snippet: m.line.trim().slice(0, 200) })
        mismatchCount += 1
      }
    }
  }
  if (mismatchCount === 0) {
    ok(check, `${actualCount} edge types, all canonical docs agree`)
  }
}

// ─── Check 2: node type count consistency ──────────────────────────────────
//
// Ground truth: ARCHITECTURE.md's authoritative line — "directed property
// multigraph with <word> node types (`tool_call`, `transaction`, ...)".
// Count the backtick-quoted identifiers; cross-check against the number-word.
//
// Then scan README + ARCHITECTURE + CLAUDE for "<word> node type" claims.

function checkNodeTypeCount() {
  const check = 'node-type-count'
  const arch = read('ARCHITECTURE.md')
  const m = arch.match(
    /directed property multigraph with ([a-z]+) node types\s*\(([^)]+)\)/
  )
  if (!m) {
    fail(check, 'ARCHITECTURE.md authoritative node-type enumeration not found')
    return
  }
  const claimedWord = m[1].toLowerCase()
  const nodeIds = [...m[2].matchAll(/`([a-z_][a-z0-9_]*)`/g)].map(x => x[1])
  const actualCount = nodeIds.length
  const expectedWord = NUMBER_WORDS[actualCount]

  if (claimedWord !== expectedWord) {
    fail(check,
      `ARCHITECTURE.md self-inconsistent: claims "${claimedWord} node types" but enumeration has ${actualCount} identifiers`,
      { claimedWord, actualCount, nodeIds })
    return
  }

  const targets = ['README.md', 'ARCHITECTURE.md', 'CLAUDE.md']
  const numberWordPattern = NUMBER_WORDS.slice(1, 16).join('|')
  const re = new RegExp(`\\b(${numberWordPattern})(\\s+|-)node[ -]types?\\b`, 'gi')
  let mismatchCount = 0
  for (const t of targets) {
    const matches = findLineMatches(t, re)
    for (const m of matches) {
      const found = m.match[1].toLowerCase()
      if (found !== expectedWord) {
        fail(check,
          `${t}:${m.lineNo} says "${m.match[0]}", expected "${expectedWord} node types"`,
          { file: t, line: m.lineNo, found, expected: expectedWord, snippet: m.line.trim().slice(0, 200) })
        mismatchCount += 1
      }
    }
  }
  if (mismatchCount === 0) {
    ok(check, `${actualCount} node types, all canonical docs agree`)
  }
}

// ─── Check 3: dashboard view count consistency ─────────────────────────────
//
// Ground truth: route handlers in apps/dashboard/index.html. The router
// branches with `if (hash.startsWith('/x/'))` or `if (hash === '/x')`. Count
// distinct top-level data views (everything except `/about`, which is meta:
// it explains the views, it isn't itself a view of substrate data).
//
// Targets: README.md, apps/dashboard/README.md, the about page heading
// inside index.html itself.

function checkDashboardViewCount() {
  const check = 'dashboard-view-count'
  const html = read('apps/dashboard/index.html')
  const routePattern = /if \(hash(?:\.startsWith\('\/(\w+)\/?'?\)|\s*===\s*'\/(\w+)')/g
  const routes = new Set()
  // The default `/` overview route is matched separately by the
  // empty/`/`/`/overview` branch.
  if (/hash === '\/overview'|hash === '\/'/.test(html)) routes.add('overview')
  for (const m of html.matchAll(routePattern)) {
    const r = m[1] || m[2]
    if (r && r !== 'about') routes.add(r)
  }
  const actualCount = routes.size
  const expectedWord = NUMBER_WORDS[actualCount]

  // Check the about-page H2 heading.
  const aboutMatch = html.match(/el\('h2',\s*\{\},\s*'([A-Z][a-z]+)\s+views'\)/)
  if (aboutMatch) {
    const claimedWord = aboutMatch[1].toLowerCase()
    if (claimedWord !== expectedWord) {
      const lineNo = html.slice(0, html.indexOf(aboutMatch[0])).split('\n').length
      fail(check,
        `apps/dashboard/index.html:${lineNo} about-page heading says "${aboutMatch[1]} views", expected "${capitalize(expectedWord)} views"`,
        { file: 'apps/dashboard/index.html', line: lineNo, found: claimedWord, expected: expectedWord })
    }
  }

  // Check the README claims.
  const targets = ['README.md', 'apps/dashboard/README.md']
  const numberWordPattern = NUMBER_WORDS.slice(1, 16).join('|')
  const re = new RegExp(`\\b(${numberWordPattern})(\\s+|-)views?\\b`, 'gi')
  let mismatchCount = 0
  for (const t of targets) {
    const matches = findLineMatches(t, re)
    for (const m of matches) {
      const found = m.match[1].toLowerCase()
      if (found !== expectedWord) {
        fail(check,
          `${t}:${m.lineNo} says "${m.match[0]}", expected "${expectedWord} views"`,
          { file: t, line: m.lineNo, found, expected: expectedWord, snippet: m.line.trim().slice(0, 200) })
        mismatchCount += 1
      }
    }
  }
  if (mismatchCount === 0 && (!aboutMatch || aboutMatch[1].toLowerCase() === expectedWord)) {
    ok(check, `${actualCount} dashboard views, all docs agree`)
  }
}

// ─── Check 4: workspace package list ──────────────────────────────────────
//
// Ground truth: pnpm-workspace.yaml globs expanded against the filesystem,
// each yielding a name+private flag from its package.json.
//
// Targets: CLAUDE.md "Repository structure" tree must list each public
// package directory. The "Monorepo" paragraph's enumeration of public +
// private + cognitive-primitive packages must agree with the count claim
// in the same paragraph.

function checkWorkspacePackages() {
  const check = 'workspace-packages'
  const wsGlobs = readWorkspaceGlobs()
  const expanded = []
  for (const pattern of wsGlobs) {
    if (pattern.endsWith('/*')) {
      const dir = pattern.slice(0, -2)
      const entries = readdirSync(join(ROOT, dir), { withFileTypes: true })
      for (const e of entries) {
        if (!e.isDirectory()) continue
        try {
          const pkg = JSON.parse(read(`${dir}/${e.name}/package.json`))
          expanded.push({ dir: `${dir}/${e.name}`, name: pkg.name, private: !!pkg.private })
        } catch (_) { /* not a package */ }
      }
    } else {
      try {
        const pkg = JSON.parse(read(`${pattern}/package.json`))
        expanded.push({ dir: pattern, name: pkg.name, private: !!pkg.private })
      } catch (_) {}
    }
  }

  const claude = read('CLAUDE.md')
  const treeBlockMatch = claude.match(/^```\natrib\/[\s\S]*?\n```/m)
  if (!treeBlockMatch) {
    fail(check, 'CLAUDE.md repository-structure tree block not found')
    return
  }
  const tree = treeBlockMatch[0]
  let missing = []
  for (const p of expanded) {
    const dirBase = p.dir.split('/').pop()
    // Tree uses `<dirBase>/` lines under packages/ or services/
    if (!new RegExp(`\\b${dirBase}/`).test(tree)) {
      missing.push(p)
    }
  }
  if (missing.length > 0) {
    fail(check,
      `${missing.length} workspace package(s) missing from CLAUDE.md repository-structure tree`,
      { missing: missing.map(p => p.dir) })
  } else {
    ok(check, `all ${expanded.length} workspace packages present in CLAUDE.md tree`)
  }

  // Cross-check the "<word> workspace packages" claim near the Monorepo paragraph.
  // CLAUDE.md's framing groups bullets explicitly: count those bullets and
  // verify the number-word claim matches.
  const monorepoMatch = claude.match(
    /monorepo with \*\*([a-z]+) workspace packages\*\*:\s*\n([\s\S]*?)\n\n/
  )
  if (monorepoMatch) {
    const claimedWord = monorepoMatch[1].toLowerCase()
    const bulletBlock = monorepoMatch[2]
    // Count `@atrib/<name>` references in the bullet block (each is one package).
    const enumerated = [...bulletBlock.matchAll(/`@atrib\/[a-z-]+`/g)].length
    const expectedWord = NUMBER_WORDS[enumerated]
    if (claimedWord !== expectedWord) {
      fail(check,
        `CLAUDE.md "Monorepo" paragraph claims "${claimedWord} workspace packages" but enumerates ${enumerated} packages in its own bullets`,
        { claimedWord, expected: expectedWord, enumerated })
    }
  }
}

// ─── Check 5: published-package count consistency ─────────────────────────
//
// Ground truth: count of workspace packages with `private` falsy.
//
// Target: README.md "<word> designed-public packages" claim.

function checkPublishedPackageCount() {
  const check = 'published-package-count'
  const wsGlobs = readWorkspaceGlobs()
  const allPkgs = []
  for (const pattern of wsGlobs) {
    if (pattern.endsWith('/*')) {
      const dir = pattern.slice(0, -2)
      const entries = readdirSync(join(ROOT, dir), { withFileTypes: true })
      for (const e of entries) {
        if (!e.isDirectory()) continue
        try {
          const pkg = JSON.parse(read(`${dir}/${e.name}/package.json`))
          allPkgs.push({ name: pkg.name, private: !!pkg.private })
        } catch (_) {}
      }
    } else {
      try {
        const pkg = JSON.parse(read(`${pattern}/package.json`))
        allPkgs.push({ name: pkg.name, private: !!pkg.private })
      } catch (_) {}
    }
  }
  const publicCount = allPkgs.filter(p => !p.private).length
  const expectedWord = NUMBER_WORDS[publicCount]

  const readme = read('README.md')
  const m = readme.match(/\b([A-Z][a-z]+)\s+designed-public packages\b/i)
  if (!m) {
    // Optional check; older README phrasing may differ. Don't fail on missing.
    return
  }
  const claimedWord = m[1].toLowerCase()
  if (claimedWord !== expectedWord) {
    fail(check,
      `README.md says "${m[0]}", expected "${capitalize(expectedWord)} designed-public packages" (count from package.json private flags)`,
      { found: claimedWord, expected: expectedWord, publicCount })
  } else {
    ok(check, `${publicCount} public packages, README agrees`)
  }
}

// ─── helpers ───────────────────────────────────────────────────────────────

function capitalize(word) {
  return word.charAt(0).toUpperCase() + word.slice(1)
}

// ─── run all checks ───────────────────────────────────────────────────────

const checks = [
  checkEdgeTypeCount,
  checkNodeTypeCount,
  checkDashboardViewCount,
  checkWorkspacePackages,
  checkPublishedPackageCount,
]

for (const c of checks) {
  try {
    c()
  } catch (e) {
    fail(c.name, `check threw: ${e.message}`, { stack: e.stack })
  }
}

const fails = findings.filter(f => f.level === 'fail')
const passes = findings.filter(f => f.level === 'ok')

if (JSON_MODE) {
  console.log(JSON.stringify({
    summary: { passed: passes.length, failed: fails.length },
    findings,
  }, null, 2))
} else {
  for (const p of passes) {
    console.log(`  ok  ${p.check}: ${p.message}`)
  }
  for (const f of fails) {
    console.log(`  FAIL  ${f.check}: ${f.message}`)
    if (f.detail?.snippet) console.log(`        ${f.detail.snippet}`)
  }
  console.log()
  if (fails.length === 0) {
    console.log(`doc-sync: ${passes.length} check(s) passed`)
  } else {
    console.log(`doc-sync: ${fails.length} failure(s), ${passes.length} pass(es)`)
    console.log()
    console.log('To fix: see CLAUDE.md "Sync triggers" table for which docs each kind of change requires.')
  }
}

process.exit(fails.length === 0 ? 0 : 1)
