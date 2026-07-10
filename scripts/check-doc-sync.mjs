#!/usr/bin/env node
// Validate internal consistency of canonical docs.
//
// The sync-trigger table in CLAUDE.md defines a manual enforcement
// mechanism: when an edge type is added, multiple files must be updated
// manually. Inconsistent adherence can introduce drift. This script
// mechanically detects the specific staleness pattern, number-word count
// claims drifting out of sync with the underlying enumeration that
// determines them.
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
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Minimal pnpm-workspace.yaml reader, extracts the quoted glob strings under
// the `packages:` key. Avoids pulling a yaml dep into the script.
function readWorkspaceGlobs() {
  const text = read('pnpm-workspace.yaml')
  const out = []
  let inPackages = false
  for (const line of text.split('\n')) {
    if (/^packages:\s*$/.test(line)) {
      inPackages = true
      continue
    }
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
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
  'twenty',
  'twenty-one',
  'twenty-two',
  'twenty-three',
  'twenty-four',
  'twenty-five',
  'twenty-six',
  'twenty-seven',
  'twenty-eight',
  'twenty-nine',
  'thirty',
  'thirty-one',
  'thirty-two',
  'thirty-three',
  'thirty-four',
  'thirty-five',
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

function listMarkdownFiles() {
  const skipDirs = new Set([
    'node_modules',
    'dist',
    'build',
    '.git',
    '.next',
    '.turbo',
    'wasm',
    'pkg',
    'target',
    'coverage',
  ])

  function walkMd(rel) {
    const out = []
    const entries = readdirSync(join(ROOT, rel), { withFileTypes: true })
    for (const e of entries) {
      if (skipDirs.has(e.name)) continue
      if (e.name.startsWith('.') && e.name !== '.changeset') continue
      const sub = rel ? `${rel}/${e.name}` : e.name
      if (e.isDirectory()) {
        out.push(...walkMd(sub))
      } else if (e.isFile() && e.name.endsWith('.md')) {
        out.push(sub)
      }
    }
    return out
  }

  return walkMd('')
}

function listPublicBoundaryFiles() {
  const skipDirs = new Set([
    'node_modules',
    'dist',
    'build',
    '.git',
    '.next',
    '.turbo',
    'wasm',
    'pkg',
    'target',
    'coverage',
  ])
  const allowedExts = new Set([
    '.md',
    '.mdx',
    '.txt',
    '.ts',
    '.tsx',
    '.js',
    '.mjs',
    '.cjs',
    '.json',
    '.yaml',
    '.yml',
  ])
  const skipFiles = new Set(['pnpm-lock.yaml', 'scripts/check-doc-sync.mjs', 'textleaks.yaml'])

  function walk(rel) {
    const out = []
    const entries = readdirSync(join(ROOT, rel), { withFileTypes: true })
    for (const e of entries) {
      if (skipDirs.has(e.name)) continue
      if (e.name.startsWith('.') && e.name !== '.changeset') continue
      const sub = rel ? `${rel}/${e.name}` : e.name
      if (e.isDirectory()) {
        out.push(...walk(sub))
      } else if (e.isFile()) {
        if (skipFiles.has(sub)) continue
        const dot = e.name.lastIndexOf('.')
        const ext = dot === -1 ? '' : e.name.slice(dot)
        if (allowedExts.has(ext)) out.push(sub)
      }
    }
    return out
  }

  return walk('')
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
  const m = claude.match(/\*\*([A-Z][a-z]+) edge types,[^*]*\*\*\s*([\s\S]*?)Two implementations/)
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
    .map((x) => x[1])
    .filter((t) => t.length >= 4 && !/^D\d/.test(t) && !NON_EDGE_NOISE.has(t))
  const distinctEdges = [...new Set(tokens)]
  const actualCount = distinctEdges.length
  const expectedWord = NUMBER_WORDS[actualCount]

  if (claimedWord !== expectedWord) {
    fail(
      check,
      `CLAUDE.md self-inconsistent: claims "${claimedWord} edge types" but enumeration has ${actualCount} distinct identifiers`,
      { claimedWord, actualCount, distinctEdges },
    )
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
        fail(
          check,
          `${t}:${m.lineNo} says "${m.match[0]}", expected "${expectedWord} edge types" (CLAUDE.md ground truth)`,
          {
            file: t,
            line: m.lineNo,
            found,
            expected: expectedWord,
            snippet: m.line.trim().slice(0, 200),
          },
        )
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
// Ground truth: ARCHITECTURE.md's authoritative line, "directed property
// multigraph with <word> node types (`tool_call`, `transaction`, ...)".
// Count the backtick-quoted identifiers; cross-check against the number-word.
//
// Then scan README + ARCHITECTURE + CLAUDE for "<word> node type" claims.

function checkNodeTypeCount() {
  const check = 'node-type-count'
  const arch = read('ARCHITECTURE.md')
  const m = arch.match(/directed property multigraph with ([a-z]+) node types\s*\(([^)]+)\)/)
  if (!m) {
    fail(check, 'ARCHITECTURE.md authoritative node-type enumeration not found')
    return
  }
  const claimedWord = m[1].toLowerCase()
  const nodeIds = [...m[2].matchAll(/`([a-z_][a-z0-9_]*)`/g)].map((x) => x[1])
  const actualCount = nodeIds.length
  const expectedWord = NUMBER_WORDS[actualCount]

  if (claimedWord !== expectedWord) {
    fail(
      check,
      `ARCHITECTURE.md self-inconsistent: claims "${claimedWord} node types" but enumeration has ${actualCount} identifiers`,
      { claimedWord, actualCount, nodeIds },
    )
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
        fail(
          check,
          `${t}:${m.lineNo} says "${m.match[0]}", expected "${expectedWord} node types"`,
          {
            file: t,
            line: m.lineNo,
            found,
            expected: expectedWord,
            snippet: m.line.trim().slice(0, 200),
          },
        )
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
// branches with `if (routePath.startsWith('/x/'))` or `if (routePath === '/x')`. Count
// distinct top-level data views (everything except `/about`, which is meta:
// it explains the views, it isn't itself a view of substrate data).
//
// Targets: README.md, apps/dashboard/README.md, the about page heading
// inside index.html itself.

function checkDashboardViewCount() {
  const check = 'dashboard-view-count'
  const html = read('apps/dashboard/index.html')
  const routePattern =
    /if \((?:routePath|hash)(?:\.startsWith\('\/([A-Za-z0-9_-]+)\/?'?\)|\s*===\s*'\/([A-Za-z0-9_-]+)')/g
  const routes = new Set()
  // The default `/` overview route is matched separately by the
  // empty/`/`/`/overview` branch.
  if (/(?:routePath|hash) === '\/overview'|(?:routePath|hash) === '\/'/.test(html))
    routes.add('overview')
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
      fail(
        check,
        `apps/dashboard/index.html:${lineNo} about-page heading says "${aboutMatch[1]} views", expected "${capitalize(expectedWord)} views"`,
        {
          file: 'apps/dashboard/index.html',
          line: lineNo,
          found: claimedWord,
          expected: expectedWord,
        },
      )
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
        fail(check, `${t}:${m.lineNo} says "${m.match[0]}", expected "${expectedWord} views"`, {
          file: t,
          line: m.lineNo,
          found,
          expected: expectedWord,
          snippet: m.line.trim().slice(0, 200),
        })
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
        } catch (_) {
          /* not a package */
        }
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
    fail(
      check,
      `${missing.length} workspace package(s) missing from CLAUDE.md repository-structure tree`,
      { missing: missing.map((p) => p.dir) },
    )
  } else {
    ok(check, `all ${expanded.length} workspace packages present in CLAUDE.md tree`)
  }

  // Cross-check the "<word> workspace packages" claim near the Monorepo paragraph.
  // CLAUDE.md's framing groups bullets explicitly: count those bullets and
  // verify the number-word claim matches.
  const monorepoMatch = claude.match(
    /monorepo with \*\*([a-z-]+) workspace packages\*\*:\s*\n([\s\S]*?)\n\n/,
  )
  if (monorepoMatch) {
    const claimedWord = monorepoMatch[1].toLowerCase()
    const bulletBlock = monorepoMatch[2]
    // Count `@atrib/<name>` references in the bullet block (each is one package).
    const enumerated = [...bulletBlock.matchAll(/`@atrib\/[a-z-]+`/g)].length
    const expectedWord = NUMBER_WORDS[enumerated]
    if (claimedWord !== expectedWord) {
      fail(
        check,
        `CLAUDE.md "Monorepo" paragraph claims "${claimedWord} workspace packages" but enumerates ${enumerated} packages in its own bullets`,
        { claimedWord, expected: expectedWord, enumerated },
      )
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
  const publicCount = allPkgs.filter((p) => !p.private).length
  const expectedWord = NUMBER_WORDS[publicCount]

  const readme = read('README.md')
  const m = readme.match(/\b([A-Z][a-z]+)\s+designed-public packages\b/i)
  if (!m) {
    // Optional check; older README phrasing may differ. Don't fail on missing.
    return
  }
  const claimedWord = m[1].toLowerCase()
  if (claimedWord !== expectedWord) {
    fail(
      check,
      `README.md says "${m[0]}", expected "${capitalize(expectedWord)} designed-public packages" (count from package.json private flags)`,
      { found: claimedWord, expected: expectedWord, publicCount },
    )
  } else {
    ok(check, `${publicCount} public packages, README agrees`)
  }
}

// ─── conformance corpus consistency ────────────────────────────────────────
// Each corpus under spec/conformance/<section>/ has a manifest.json that
// enumerates `cases[]`. The on-disk cases/*.json count MUST equal the
// manifest's declared count, or downstream reference tests iterate over a
// stale list.
function checkConformanceCorpusConsistency() {
  const check = 'conformance-corpus-consistency'
  const corpusRoots = []

  function walk(dir) {
    const here = join(ROOT, 'spec/conformance', dir)
    let entries
    try {
      entries = readdirSync(here, { withFileTypes: true })
    } catch (_) {
      return
    }
    if (entries.some((e) => e.name === 'manifest.json')) {
      corpusRoots.push(dir)
    }
    for (const e of entries) {
      if (e.isDirectory()) walk(join(dir, e.name))
    }
  }
  walk('.')

  if (corpusRoots.length === 0) {
    return // no corpora to check
  }

  let mismatches = 0
  for (const root of corpusRoots) {
    const manifestPath = `spec/conformance/${root}/manifest.json`
    let manifest
    try {
      manifest = JSON.parse(read(manifestPath))
    } catch (e) {
      fail(check, `cannot read ${manifestPath}: ${e.message}`)
      mismatches++
      continue
    }
    const declared = Array.isArray(manifest.cases) ? manifest.cases.length : 0
    const declaredFiles = new Set((manifest.cases || []).map((c) => c.file).filter(Boolean))
    let actualCount = 0
    const actualFiles = new Set()
    try {
      const files = readdirSync(join(ROOT, 'spec/conformance', root, 'cases'))
      for (const f of files) {
        if (!f.endsWith('.json')) continue
        actualCount++
        actualFiles.add(`cases/${f}`)
      }
    } catch (_) {
      // No cases/ dir; manifest count of 0 is fine
    }
    if (declared !== actualCount) {
      fail(
        check,
        `${manifestPath}: manifest declares ${declared} cases, cases/ contains ${actualCount}`,
        { declared, actual: actualCount, root },
      )
      mismatches++
      continue
    }
    for (const file of declaredFiles) {
      if (!actualFiles.has(file)) {
        fail(check, `${manifestPath} references missing case file: ${file}`, { file, root })
        mismatches++
      }
    }
  }
  if (mismatches === 0) {
    ok(check, `${corpusRoots.length} conformance corpora consistent (cases/*.json ↔ manifest.json)`)
  }
}

// ─── public-boundary wording ───────────────────────────────────────────────
// Public repo text can describe external issues, release claims, proof
// artifacts, and developer-facing examples. It should not publish operator
// route planning, packet status, private review gates, relationship strategy,
// or startup-growth framing.
function checkPublicBoundaryWording() {
  const check = 'public-boundary-wording'
  const rules = [
    { label: 'go-to-market', pattern: /\bgo-to-market\b/i },
    { label: 'gtm', pattern: /\bgtm\b/i },
    { label: 'launch strategy', pattern: /\blaunch strategy\b/i },
    { label: 'startup growth', pattern: /\bstartup growth\b/i },
    { label: 'marketing landing page', pattern: /\bmarketing landing page\b/i },
    { label: 'marketing copy', pattern: /\bmarketing copy\b/i },
    { label: 'marketing site', pattern: /\bmarketing site\b/i },
    { label: 'marketing demo', pattern: /\bmarketing demo\b/i },
    { label: 'customer-facing', pattern: /\bcustomer-facing\b/i },
    { label: 'prospective customer', pattern: /\bprospective customer\b/i },
    { label: 'customer conversation', pattern: /\bcustomer conversations?\b/i },
    { label: 'customer walkthrough', pattern: /\bcustomer walkthroughs?\b/i },
    { label: 'hand a customer', pattern: /\bhand a customer\b/i },
    { label: 'real customer copy', pattern: /\breal customer\b.*\bcopy\b/i },
    { label: 'customers install', pattern: /\bcustomers?\b.*\bpnpm add\b/i },
    { label: 'shipping to customers', pattern: /\bshipping\b.*\bto customers\b/i },
    { label: 'outreach', pattern: /\boutreach\b/i },
    { label: 'outreach proof framing', pattern: /\boutreach proof framing\b/i },
    { label: 'route packet', pattern: /\broute packet\b/i },
    { label: 'route plan', pattern: /\broute plan\b/i },
    { label: 'route artifact', pattern: /\broute artifact\b/i },
    { label: 'source-backed route', pattern: /\bsource-backed route\b/i },
    { label: 'no outreach sent', pattern: /\bno outreach sent\b/i },
    { label: 'draft packet', pattern: /\bdraft packet\b/i },
    { label: 'operator-approved', pattern: /\boperator-approved\b/i },
    { label: 'operator approves', pattern: /\boperator approves?\b/i },
    { label: 'public packet body', pattern: /\bpublic packet body\b/i },
    { label: 'public writeup', pattern: /\bpublic writeup\b/i },
    { label: 'operator memory', pattern: /\btracked in operator memory\b/i },
    { label: 'operator hand-review', pattern: /\boperator hand-review\b/i },
    { label: 'partner pitch', pattern: /\b(?:partner|partnership) pitch\b/i },
    { label: 'partner gives artifacts', pattern: /\bcustomer or partner\b.*\bgives?\b/i },
    { label: 'conversation provenance', pattern: /\bproduced in conversation\b/i },
    { label: 'session trace', pattern: /\bsession trace\b/i },
    { label: 'drafted privately', pattern: /\bdrafted privately\b/i },
    { label: 'promoted to public', pattern: /\bpromoted to public\b/i },
    { label: 'same-day proof refresh', pattern: /\bsame-day proof refresh\b/i },
    { label: 'external review needs', pattern: /\bexternal review still needs\b/i },
    { label: 'non-operator adoption', pattern: /\bfirst non-operator adoption\b/i },
    { label: 'private repo tooling', pattern: /\batrib-internal\/tools\b/i },
    { label: 'maintainer engagement', pattern: /\bengag(?:e|ing)\b.*\bmaintainers?\b/i },
    { label: 'maintainer engagement', pattern: /\bmaintainers?\b.*\bengag(?:e|ing)\b/i },
    { label: 'maintainer interest', pattern: /\bmaintainer interest\b/i },
    { label: 'maintainer signal', pattern: /\bmaintainer signal\b/i },
    { label: 'maintainer review', pattern: /\bmaintainer review\b/i },
  ]

  const files = listPublicBoundaryFiles()
  let count = 0
  for (const file of files) {
    const rawLines = lines(read(file))
    for (let i = 0; i < rawLines.length; i += 1) {
      const line = rawLines[i]
      for (const rule of rules) {
        if (!rule.pattern.test(line)) continue
        count += 1
        fail(check, `${file}:${i + 1} contains public-boundary wording "${rule.label}"`, {
          file,
          line: i + 1,
          label: rule.label,
          snippet: line.trim().slice(0, 200),
        })
      }
    }
  }

  if (count === 0) {
    ok(check, `${files.length} text file(s) avoid route-planning wording`)
  }
}

// ─── private wordlist (operator-local) ─────────────────────────────────────
// Public files describe operator infrastructure in role terms only. The
// enforcing pattern list is operator-private and lives outside the repo:
// ATRIB_DOC_SYNC_PRIVATE_WORDLIST points at it, with a fallback at
// ~/.config/atrib/doc-sync-private-wordlist.txt. Each non-blank, non-#
// line is a case-insensitive regular expression. When no wordlist is
// present (CI, fresh clones), the check reports ok and skips.
function checkPrivateWordlist() {
  const check = 'private-wordlist'
  const candidate =
    process.env.ATRIB_DOC_SYNC_PRIVATE_WORDLIST ||
    join(homedir(), '.config', 'atrib', 'doc-sync-private-wordlist.txt')
  let raw
  try {
    raw = readFileSync(candidate, 'utf8')
  } catch (_) {
    ok(check, 'no private wordlist configured; skipped')
    return
  }
  const rules = []
  let badPatterns = 0
  for (const line of lines(raw)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    try {
      rules.push(new RegExp(trimmed, 'i'))
    } catch (e) {
      badPatterns += 1
      fail(check, `invalid pattern in private wordlist: ${e.message}`)
    }
  }
  if (rules.length === 0) {
    if (badPatterns === 0) ok(check, 'private wordlist empty; skipped')
    return
  }
  const files = listPublicBoundaryFiles()
  let count = 0
  for (const file of files) {
    const rawLines = lines(read(file))
    for (let i = 0; i < rawLines.length; i += 1) {
      for (let r = 0; r < rules.length; r += 1) {
        if (!rules[r].test(rawLines[i])) continue
        count += 1
        fail(check, `${file}:${i + 1} matches private wordlist pattern #${r + 1}`, {
          file,
          line: i + 1,
          pattern: r + 1,
          snippet: rawLines[i].trim().slice(0, 200),
        })
      }
    }
  }
  if (count === 0 && badPatterns === 0) {
    ok(check, `${files.length} text file(s) clear the private wordlist (${rules.length} pattern(s))`)
  }
}

// ─── inline-link discipline ────────────────────────────────────────────────
// Bare §X.Y and Dxxx references in markdown prose drift over time as readers
// can't navigate them. The going-forward fix lives in
// .changeset/changelog-atrib.cjs (auto-links during version generation); this
// check enforces the same rule across the full doc surface so authors keep
// hand-written prose linked too.
//
// Rules:
//   * Refs inside fenced code blocks (``` or ~~~) are allowed.
//   * Refs inside inline code spans (`...`) are allowed.
//   * Refs already inside markdown links [text](url) are allowed.
//   * The leading ref of a heading line ('## D001:', '## §1 Foo') is the
//     anchor source for that heading and is allowed bare.
//   * External RFC refs (preceded by 'RFC NNNN ') are allowed bare.
//
// A bare ref is FAIL if its target anchor exists (drift, could be linked but
// wasn't). A bare ref is OK-with-warning if no anchor exists (typo, stale
// reference, or speculative future section). The check fails only on drift.
function checkInlineLinks() {
  const check = 'inline-links'
  const sectionAnchors = mineSectionAnchors()
  const adrAnchors = mineAdrAnchors()
  const files = listMarkdownFiles()
  const drifted = []
  const unmapped = []
  for (const rel of files) {
    const text = read(rel)
    const findings = scanFileForBareRefs(text)
    for (const f of findings) {
      const slug = f.kind === 'section' ? sectionAnchors[f.key] : adrAnchors[f.key]
      if (slug) {
        drifted.push({ file: rel, ...f })
      } else {
        unmapped.push({ file: rel, ...f })
      }
    }
  }

  if (drifted.length > 0) {
    for (const d of drifted) {
      fail(
        check,
        `${d.file}:${d.line} bare ref "${d.text}", anchor exists, should be inline-linked`,
        { file: d.file, line: d.line, text: d.text, snippet: d.snippet },
      )
    }
    return
  }
  ok(
    check,
    `${files.length} markdown file(s) clean (${unmapped.length} unmapped, typo/speculative refs allowed)`,
  )
}

function mineSectionAnchors() {
  const text = read('atrib-spec.md')
  const out = {}
  let inFence = false
  for (const line of text.split('\n')) {
    const s = line.trimStart()
    if (s.startsWith('```') || s.startsWith('~~~')) {
      inFence = !inFence
      continue
    }
    if (inFence) continue
    const h = s.match(/^#{1,6}\s+(.+?)\s*$/)
    if (!h) continue
    const stripped = h[1].replace(/^§\s?/, '')
    const num = stripped.match(/^(\d+(?:\.\d+)*)\s+/)
    if (!num) continue
    out[num[1]] = slugifyForAnchor(h[1])
  }
  return out
}

function mineAdrAnchors() {
  const text = read('DECISIONS.md')
  const out = {}
  let inFence = false
  for (const line of text.split('\n')) {
    const s = line.trimStart()
    if (s.startsWith('```') || s.startsWith('~~~')) {
      inFence = !inFence
      continue
    }
    if (inFence) continue
    const h = s.match(/^#{1,6}\s+(D\d{3})\b.*$/)
    if (h) out[h[1].toUpperCase()] = slugifyForAnchor(s.replace(/^#{1,6}\s+/, ''))
  }
  return out
}

// Slug rule modeled after GitHub's heading slugification: strip markdown link
// syntax to display text, lowercase, drop punctuation outside [a-z0-9-_], map
// whitespace to hyphens.
function slugifyForAnchor(text) {
  return text
    .trim()
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .toLowerCase()
    .replace(/`/g, '')
    .replace(/\*/g, '')
    .replace(/[\[\]()]/g, '')
    .replace(/[^a-z0-9\-_ ]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
}

const REF_RE = /§\s?\d+(?:\.\d+)*|\bD\d{3}\b/g
const LEADING_REF_RE = /^(?:§\s?\d+(?:\.\d+)*|D\d{3}\b)/

function scanFileForBareRefs(text) {
  const out = []
  let inFence = false
  const rawLines = text.split('\n')
  for (let i = 0; i < rawLines.length; i += 1) {
    const original = rawLines[i]
    const trimmed = original.trimStart()
    if (trimmed.startsWith('```') || trimmed.startsWith('~~~')) {
      inFence = !inFence
      continue
    }
    if (inFence) continue
    if (!/§|D\d{3}/.test(original)) continue
    const linkMask = buildLinkMask(original)
    const codeMask = buildInlineCodeMask(original)
    const mask = linkMask.map((v, idx) => v || codeMask[idx])
    const headingMatch = original.match(/^(\s*#{1,6}\s+)/)
    if (headingMatch) {
      const titleStart = headingMatch[0].length
      const tail = original.slice(titleStart)
      const lead = tail.match(LEADING_REF_RE)
      if (lead) {
        for (let m = titleStart; m < titleStart + lead[0].length; m += 1) {
          mask[m] = 1
        }
      }
    }
    for (const m of original.matchAll(REF_RE)) {
      const start = m.index
      const end = start + m[0].length
      let masked = false
      for (let k = start; k < end; k += 1) {
        if (mask[k]) {
          masked = true
          break
        }
      }
      if (masked) continue
      if (m[0].startsWith('§')) {
        const before = original.slice(Math.max(0, start - 12), start)
        if (/RFC\s+\d{3,5}\s+$/.test(before)) continue
      }
      out.push({
        line: i + 1,
        col: start + 1,
        text: m[0],
        kind: m[0].startsWith('§') ? 'section' : 'adr',
        key: m[0].startsWith('§') ? m[0].replace(/§\s?/, '') : m[0].toUpperCase(),
        snippet: original.slice(Math.max(0, start - 30), end + 30).trim(),
      })
    }
  }
  return out
}

function buildLinkMask(line) {
  const mask = new Array(line.length).fill(0)
  let i = 0
  while (i < line.length) {
    if (line[i] === '[') {
      let depth = 1
      let j = i + 1
      while (j < line.length && depth > 0) {
        if (line[j] === '[') depth += 1
        else if (line[j] === ']') depth -= 1
        if (depth === 0) break
        j += 1
      }
      if (depth !== 0 || line[j + 1] !== '(') {
        i += 1
        continue
      }
      let k = j + 2
      let pdepth = 1
      while (k < line.length && pdepth > 0) {
        if (line[k] === '(') pdepth += 1
        else if (line[k] === ')') pdepth -= 1
        if (pdepth === 0) break
        k += 1
      }
      if (pdepth !== 0) {
        i += 1
        continue
      }
      for (let m = i; m <= k; m += 1) mask[m] = 1
      i = k + 1
    } else {
      i += 1
    }
  }
  return mask
}

function buildInlineCodeMask(line) {
  const mask = new Array(line.length).fill(0)
  let i = 0
  while (i < line.length) {
    if (line[i] === '`') {
      const close = line.indexOf('`', i + 1)
      if (close === -1) break
      for (let m = i; m <= close; m += 1) mask[m] = 1
      i = close + 1
    } else {
      i += 1
    }
  }
  return mask
}

// ─── Check: payment protocol count consistency ─────────────────────────────
//
// Ground truth: the payments-profile detection corpus manifest's `rails`
// array (spec/conformance/payments-profile/detection/manifest.json), which
// mirrors the canonical rail enumeration in docs/payments-profile.md §1
// (P048). Cross-check the profile document's own sentence, then scan the
// hub docs for "<word> payment protocols" / "<word> agent commerce
// protocols" / "<word> protocols" claims.

function checkPaymentProtocolCount() {
  const check = 'payment-protocol-count'
  let manifest
  try {
    manifest = JSON.parse(read('spec/conformance/payments-profile/detection/manifest.json'))
  } catch (e) {
    fail(check, `cannot read detection corpus manifest: ${e.message}`)
    return
  }
  const rails = Array.isArray(manifest.rails) ? manifest.rails : []
  const actualCount = rails.length
  const expectedWord = NUMBER_WORDS[actualCount]
  if (!expectedWord) {
    fail(check, `detection corpus manifest enumerates ${actualCount} rails, outside the number-word table`)
    return
  }

  let mismatchCount = 0

  // The profile's canonical sentence must agree with the manifest, both in
  // count word and in rail set.
  const profile = read('docs/payments-profile.md')
  const claim = profile.match(/This profile detects (\w+) payment protocols: ([^.]+)\./)
  if (!claim) {
    fail(check, 'docs/payments-profile.md canonical "This profile detects <word> payment protocols: ..." sentence not found')
    return
  }
  if (claim[1].toLowerCase() !== expectedWord) {
    fail(
      check,
      `docs/payments-profile.md claims "${claim[1]} payment protocols" but the detection corpus manifest enumerates ${actualCount} rails`,
      { claimed: claim[1], actualCount, rails },
    )
    mismatchCount += 1
  }
  const enumerated = claim[2]
    .split(/,|\band\b/)
    .map((s) => s.trim())
    .filter(Boolean)
  const railSet = new Set(rails.map((r) => String(r).toLowerCase()))
  const drift = enumerated.filter((e) => !railSet.has(e.toLowerCase()))
  if (drift.length > 0 || enumerated.length !== rails.length) {
    fail(
      check,
      `docs/payments-profile.md rail enumeration does not match the detection corpus manifest rails array`,
      { enumerated, rails, drift },
    )
    mismatchCount += 1
  }

  // Scan hub docs for count-word claims that disagree.
  const targets = ['CLAUDE.md', 'README.md', 'ARCHITECTURE.md', 'docs/payments-profile.md']
  const numberWordPattern = NUMBER_WORDS.slice(1, 16).join('|')
  const re = new RegExp(
    `\\b(${numberWordPattern})\\s+(?:payment protocols|agent commerce protocols|protocols)\\b`,
    'gi',
  )
  for (const t of targets) {
    const matches = findLineMatches(t, re)
    for (const m of matches) {
      const found = m.match[1].toLowerCase()
      if (found !== expectedWord) {
        fail(
          check,
          `${t}:${m.lineNo} says "${m.match[0]}", expected "${expectedWord}" (detection corpus manifest ground truth)`,
          { file: t, line: m.lineNo, found, expected: expectedWord, snippet: m.line.trim().slice(0, 200) },
        )
        mismatchCount += 1
      }
    }
  }
  if (mismatchCount === 0) {
    ok(check, `${actualCount} payment protocols, profile enumeration and hub docs agree`)
  }
}

// ─── Check: evidence profile count consistency ─────────────────────────────
//
// Ground truth: the evidence-envelope corpus manifest's
// atrib_profile_registry array. Every registered name must have a
// docs/evidence-profiles/<name>.md document and vice versa, and the
// CLAUDE.md "<word> atrib-maintained evidence-envelope profiles" claim
// must match the count.

function checkEvidenceProfileCount() {
  const check = 'evidence-profile-count'
  let registry
  try {
    registry = JSON.parse(read('spec/conformance/evidence-envelope/manifest.json')).atrib_profile_registry
  } catch (e) {
    fail(check, `cannot read evidence-envelope manifest: ${e.message}`)
    return
  }
  if (!Array.isArray(registry) || registry.length === 0) {
    fail(check, 'evidence-envelope manifest atrib_profile_registry missing or empty')
    return
  }
  let files
  try {
    files = readdirSync(join(ROOT, 'docs/evidence-profiles')).filter((f) => f.endsWith('.md'))
  } catch (e) {
    fail(check, `cannot list docs/evidence-profiles: ${e.message}`)
    return
  }
  let mismatchCount = 0
  const missingDocs = registry.filter((name) => !files.includes(`${name}.md`))
  const unregisteredDocs = files.filter((f) => !registry.includes(f.replace(/\.md$/, '')))
  if (missingDocs.length > 0 || unregisteredDocs.length > 0) {
    fail(
      check,
      'docs/evidence-profiles/*.md and the envelope manifest atrib_profile_registry disagree',
      { missingDocs, unregisteredDocs },
    )
    mismatchCount += 1
  }
  const actualCount = registry.length
  const expectedWord = NUMBER_WORDS[actualCount]
  const claude = read('CLAUDE.md')
  const m = claude.match(/\b(\w+) atrib-maintained evidence-envelope profiles\b/)
  if (!m) {
    fail(check, 'CLAUDE.md "<word> atrib-maintained evidence-envelope profiles" claim not found')
    mismatchCount += 1
  } else if (m[1].toLowerCase() !== expectedWord) {
    fail(
      check,
      `CLAUDE.md claims "${m[1]} atrib-maintained evidence-envelope profiles" but the registry lists ${actualCount}`,
      { claimed: m[1], actualCount, registry },
    )
    mismatchCount += 1
  }
  if (mismatchCount === 0) {
    ok(check, `${actualCount} evidence profiles: registry, profile docs, and CLAUDE.md agree`)
  }
}

// ─── Check: DOC-SYNC-TRIGGERS row count ────────────────────────────────────
//
// Ground truth: the data rows of the DOC-SYNC-TRIGGERS.md triggers table.
// CLAUDE.md's quick-reference paragraph claims "(N rows)"; the two must
// agree so the hub-doc claim can never drift again.

function checkDocSyncTriggersRowCount() {
  const check = 'doc-sync-triggers-row-count'
  const triggers = read('DOC-SYNC-TRIGGERS.md')
  let inTable = false
  let rows = 0
  for (const line of lines(triggers)) {
    if (line.startsWith('| Event')) {
      inTable = true
      continue
    }
    if (!inTable) continue
    if (/^\|\s*-/.test(line)) continue // separator row
    if (line.startsWith('|')) rows += 1
    else if (rows > 0) break
  }
  if (rows === 0) {
    fail(check, 'DOC-SYNC-TRIGGERS.md triggers table not found')
    return
  }
  const claude = read('CLAUDE.md')
  const m = claude.match(/DOC-SYNC-TRIGGERS\.md\) \((\d+) rows\b/)
  if (!m) {
    fail(check, 'CLAUDE.md "(N rows)" claim for DOC-SYNC-TRIGGERS.md not found')
    return
  }
  const claimed = Number(m[1])
  if (claimed !== rows) {
    fail(
      check,
      `CLAUDE.md claims DOC-SYNC-TRIGGERS.md has ${claimed} rows, table has ${rows} data rows`,
      { claimed, rows },
    )
    return
  }
  ok(check, `DOC-SYNC-TRIGGERS.md has ${rows} rows, CLAUDE.md agrees`)
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
  checkConformanceCorpusConsistency,
  checkPaymentProtocolCount,
  checkEvidenceProfileCount,
  checkDocSyncTriggersRowCount,
  checkPublicBoundaryWording,
  checkPrivateWordlist,
  checkInlineLinks,
]

for (const c of checks) {
  try {
    c()
  } catch (e) {
    fail(c.name, `check threw: ${e.message}`, { stack: e.stack })
  }
}

const fails = findings.filter((f) => f.level === 'fail')
const passes = findings.filter((f) => f.level === 'ok')

if (JSON_MODE) {
  console.log(
    JSON.stringify(
      {
        summary: { passed: passes.length, failed: fails.length },
        findings,
      },
      null,
      2,
    ),
  )
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
    console.log('To fix: see DOC-SYNC-TRIGGERS.md for which docs each kind of change requires.')
  }
}

process.exit(fails.length === 0 ? 0 : 1)
