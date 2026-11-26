#!/usr/bin/env node
// docs-map v1.1.0
//
// Binds doc sections to the code they describe and checks the binding.
// The same file is copied byte for byte into every repo that uses it; change
// it in one place and copy it, never edit a copy. The format is documented in
// the header comment below and in each repo's docs/docs-map.json.
//
// Usage:
//   node scripts/docs-map.mjs                    check the map and generated blocks
//   node scripts/docs-map.mjs --base origin/main also flag sections this branch's code changes may have outdated
//   node scripts/docs-map.mjs --write            re-render generated blocks, then check
//   node scripts/docs-map.mjs --why <file>...    list the doc sections bound to these files
//   node scripts/docs-map.mjs --drift            list sections bound to upstream files changed since the pin
//   node scripts/docs-map.mjs --json             print the result as JSON
//   --map <path>                                 map file (default docs/docs-map.json)
//
// Exit codes: 0 clean (warnings allowed), 1 the map or a generated block is
// wrong, 2 only unacknowledged flags from --base.
//
// Map format (docs/docs-map.json):
// {
//   "version": 1,
//   "mode": "fail",                      default for entries: "fail" or "warn"
//   "docs": ["**/*.md"],                 which files are docs (default **/*.md)
//   "ignore": ["vendor/**"],             never docs
//   "frozen": ["docs/releases/**"],      dated records: never flagged
//   "unbound": ["CODE_OF_CONDUCT.md"],   prose that describes no code
//   "entries": [
//     { "doc": "README.md", "section": "Packages",
//       "covers": ["packages/*/package.json", "!**/*.test.ts"], "mode": "fail" },
//     { "doc": "packages/*/README.md", "covers": ["packages/$1/src/**"] }
//   ],
//   "generators": [
//     { "id": "cli-usage", "doc": "README.md", "command": "node cli.mjs --help",
//       "cwd": ".", "fence": "text" }
//   ],
//   "upstreams": {
//     "atrib": { "repo": "creatornader/atrib", "ref": "upstream/atrib.ref",
//                "path": ".upstream/atrib" }
//   }
// }
//
// - section is a heading's text or its GitHub slug; omit it to bind the whole
//   file. A section runs from its heading to the next heading of the same or a
//   higher level, so its subsections belong to it.
// - Globs: ** any depth, * within one path segment, ? one character, {a,b}
//   alternatives. A leading ! in covers excludes. Each * or ** in a doc glob
//   captures, and $1..$9 in covers reuse the captures. Such an entry needs
//   each doc it expands to to cover some file, and each covers glob to match
//   for some doc; a plain entry needs every positive glob to match.
// - Every doc must match an entry, frozen, unbound or ignore. A doc glob in
//   an entry skips docs that are frozen or unbound.
// - A generated block sits between
//     <!-- docs-map:generated id="cli-usage" -->
//     <!-- docs-map:end id="cli-usage" -->
//   and holds the command's stdout (inside a ``` fence when fence is set).
// - With --base, a flag is a section whose covers matched a file this branch
//   changed while the branch left the section's lines alone. A line
//     docs-map: README.md#packages: <why no edit is needed>
//   in a commit message on the branch, or in DOCS_MAP_PR_BODY, acknowledges a
//   flag (doc path, then # and the heading's slug; no # for a whole file).
// - A doc is any text file an entry names; docs globs only set which files
//   must be in the map. Sections need markdown headings; a whole-file entry
//   can bind a page's source, such as a .tsx or .html file.
// - Upstreams bind docs here to code in another repo. The ref file holds the
//   upstream commit this repo was last checked against, and path is a git
//   clone of it. A covers glob "atrib:src/**" matches upstream files at that
//   commit. With --base, a branch that moves the ref file counts every
//   upstream file changed between the old and new commit as changed, so the
//   sections bound to them are flagged. A missing clone skips that upstream's
//   globs with a warning; a clone that lacks a pinned commit is an error.
//   --drift compares each pin with its clone's checked-out commit and lists
//   the sections bound to the files changed between them, so a scheduled job
//   can say what moving the pin will ask for.

import { execFileSync, execSync } from 'node:child_process'
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const VERSION = '1.1.0'

// Plain stream writes, so linters that forbid console calls stay quiet.
const print = (text) => process.stdout.write(`${text}\n`)
const printErr = (text) => process.stderr.write(`${text}\n`)
// GitHub Actions workflow commands need %, CR and LF escaped in the message.
const ghaEscape = (text) =>
  String(text).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A')

// ---------- arguments ----------

export function parseArgs(argv) {
  const opts = {
    map: 'docs/docs-map.json',
    base: null,
    write: false,
    json: false,
    why: null,
    drift: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--map') opts.map = argv[++i]
    else if (a === '--base') opts.base = argv[++i]
    else if (a === '--write') opts.write = true
    else if (a === '--json') opts.json = true
    else if (a === '--drift') opts.drift = true
    else if (a === '--why') opts.why = []
    else if (opts.why && !a.startsWith('-')) opts.why.push(a)
    else if (a === '--version') opts.version = true
    else if (a === '--help' || a === '-h') opts.help = true
    else throw new Error(`unknown argument: ${a}`)
  }
  if (opts.map === undefined || opts.base === undefined)
    throw new Error('--map and --base need a value')
  return opts
}

// ---------- globs ----------

// Returns { re, captures } for a glob. Every * and ** is a capture group.
export function globToRegex(glob) {
  let re = ''
  let captures = 0
  let i = 0
  let depth = 0
  while (i < glob.length) {
    const c = glob[i]
    if (c === '*') {
      if (glob[i + 1] === '*') {
        const atStart = i === 0 || glob[i - 1] === '/'
        const atEnd = i + 2 === glob.length || glob[i + 2] === '/'
        if (atStart && atEnd) {
          // "**/" matches zero or more whole segments; a final "**" matches the rest.
          if (glob[i + 2] === '/') {
            re += '((?:[^/]+/)*)'
            i += 3
          } else {
            re += '(.*)'
            i += 2
          }
        } else {
          re += '(.*)'
          i += 2
        }
      } else {
        re += '([^/]*)'
        i += 1
      }
      captures++
      continue
    }
    if (c === '?') re += '[^/]'
    else if (c === '{') {
      re += '(?:'
      depth++
    } else if (c === '}' && depth > 0) {
      re += ')'
      depth--
    } else if (c === ',' && depth > 0) re += '|'
    else re += c.replace(/[.+^$()|[\]\\]/g, '\\$&')
    i++
  }
  return { re: new RegExp(`^${re}$`), captures }
}

// An upstream path is "name:path". A glob matches only paths in its own
// repo, so "**/*.ts" never matches an upstream file and "atrib:**" never a
// local one.
const scope = (s) => {
  const colon = s.indexOf(':')
  const slash = s.indexOf('/')
  return colon > 0 && (slash < 0 || colon < slash) ? s.slice(0, colon) : ''
}

const globCache = new Map()
export function globMatch(glob, path) {
  if (scope(glob) !== scope(path)) return null
  let g = globCache.get(glob)
  if (!g) globCache.set(glob, (g = globToRegex(glob)))
  return g.re.exec(path)
}

// Patterns may start with "!" to exclude. A path matches when it matches a
// positive pattern and no negative one.
export function matchesCovers(covers, path) {
  let hit = false
  for (const p of covers) {
    if (p.startsWith('!')) {
      if (globMatch(p.slice(1), path)) return false
    } else if (!hit && globMatch(p, path)) hit = true
  }
  return hit
}

// Glob lists in the map (docs, ignore, frozen, unbound) take ! exclusions too.
const anyMatch = (globs, path) => matchesCovers(globs || [], path)

// ---------- markdown ----------

// GitHub's heading anchor: links become their text, then lowercase, drop
// everything but letters, digits, spaces, hyphens and underscores, and turn
// spaces into hyphens.
// Inline HTML tags are dropped until none is left, so nested or overlapping
// tags cannot leave one behind. The slug is never rendered as HTML.
export function slugify(text) {
  const linked = text.replace(/!?\[([^\]]*)\]\(([^)]*)\)/g, '$1')
  // Code spans keep their text; tags outside them are dropped until none is
  // left, so nested or overlapping tags cannot leave one behind.
  const s = linked
    .split(/(`+[^`]*`+)/)
    .map((part, i) => {
      if (i % 2) return part
      let out = part
      for (let prev = null; prev !== out;) {
        prev = out
        out = out.replace(/<\/?[A-Za-z][^<>]*>/g, '')
      }
      return out
    })
    .join('')
  return s
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-')
}

// Headings with 1-based line numbers and extents, skipping fenced code.
export function parseHeadings(text) {
  const lines = text.split('\n')
  const heads = []
  let fence = null
  const seen = new Map()
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    // A backtick fence's info string cannot hold a backtick, so an inline
    // span such as ```js``` at the start of a line opens no fence.
    const f = line.match(/^ {0,3}(`{3,}(?=[^`]*$)|~{3,})/)
    if (f) {
      if (!fence) fence = f[1]
      else if (f[1][0] === fence[0] && f[1].length >= fence.length && line.trim() === f[1].trim())
        fence = null
      continue
    }
    if (fence) continue
    // ATX headings only; a closing # run needs a space before it (CommonMark).
    const m = line.match(/^ {0,3}(#{1,6})(?:\s+(.*?))?(?:\s+#+)?\s*$/)
    if (!m) continue
    const text = (m[2] || '').trim()
    // GitHub's duplicate rule: try base, base-1, base-2, ... until unused.
    const base = slugify(text)
    let slug = base
    for (let n = seen.get(base) || 0; seen.has(slug); n++) {
      slug = `${base}-${n + 1}`
      seen.set(base, n + 1)
    }
    seen.set(slug, seen.get(slug) || 0)
    heads.push({ level: m[1].length, text, slug, start: i + 1 })
  }
  for (let k = 0; k < heads.length; k++) {
    let end = lines.length
    for (let j = k + 1; j < heads.length; j++) {
      if (heads[j].level <= heads[k].level) {
        end = heads[j].start - 1
        break
      }
    }
    heads[k].end = end
  }
  return { heads, lineCount: lines.length }
}

export function findSection(parsed, section) {
  const bySlug = parsed.heads.filter((h) => h.slug === section)
  if (bySlug.length === 1) return { head: bySlug[0] }
  const byText = parsed.heads.filter((h) => h.text === section)
  if (byText.length === 1) return { head: byText[0] }
  if (byText.length > 1)
    return {
      error: `heading "${section}" appears ${byText.length} times; name it by slug (${byText.map((h) => h.slug).join(', ')})`,
    }
  return { error: `no heading "${section}"` }
}

// ---------- generated blocks ----------

// A marker is a line of its own, so a marker quoted in prose or code is not one.
const START = /^\s*<!--\s*docs-map:generated\s+id="([^"]+)"\s*-->\s*$/
const END = /^\s*<!--\s*docs-map:end\s+id="([^"]+)"\s*-->\s*$/

export function findBlocks(text) {
  const lines = text.split('\n')
  const blocks = []
  const errors = []
  let open = null
  for (let i = 0; i < lines.length; i++) {
    const s = lines[i].match(START)
    const e = lines[i].match(END)
    if (s) {
      if (open) errors.push(`line ${i + 1}: block "${s[1]}" starts inside block "${open.id}"`)
      open = { id: s[1], startLine: i }
    } else if (e) {
      if (!open || open.id !== e[1])
        errors.push(`line ${i + 1}: end of block "${e[1]}" without its start`)
      else blocks.push({ id: open.id, startLine: open.startLine, endLine: i })
      open = null
    }
  }
  if (open) errors.push(`block "${open.id}" is never closed`)
  return { blocks, errors }
}

export function renderGenerator(gen, root) {
  const out = execSync(gen.command, {
    cwd: join(root, gen.cwd || '.'),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' },
  })
  const body = out.replace(/\s+$/, '')
  if (gen.fence === undefined || gen.fence === null || gen.fence === false) return body
  return `\`\`\`${gen.fence === true ? '' : gen.fence}\n${body}\n\`\`\``
}

export function replaceBlock(text, block, rendered) {
  const lines = text.split('\n')
  const inner = rendered === '' ? [] : rendered.split('\n')
  lines.splice(block.startLine + 1, block.endLine - block.startLine - 1, ...inner)
  return lines.join('\n')
}

export function blockBody(text, block) {
  return text
    .split('\n')
    .slice(block.startLine + 1, block.endLine)
    .join('\n')
}

// ---------- git ----------

function git(root, args) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

// Tracked files, plus untracked ones when asked (PR mode, so a new file
// counts before it is staged). Plain mode stays on tracked files, so a stray
// local note never fails the check.
export function listFiles(root, { untracked = false } = {}) {
  return git(root, [
    'ls-files',
    '-z',
    '--cached',
    ...(untracked ? ['--others', '--exclude-standard'] : []),
  ])
    .split('\0')
    .filter(Boolean)
    .filter((f) => existsSync(join(root, f)))
}

// Files changed between the merge base and the working tree, and for each
// changed doc, the new-side lines it touched (a deletion touches the lines
// around it). Untracked files count as wholly new.
export function changesSince(root, base) {
  let mb
  try {
    mb = git(root, ['merge-base', base, 'HEAD']).trim()
  } catch {
    throw new Error(
      `no merge base between ${base} and HEAD; fetch ${base} with full history (actions/checkout fetch-depth: 0)`,
    )
  }
  const changed = new Set(
    git(root, [
      'diff',
      '--no-color',
      '--no-ext-diff',
      '--name-only',
      '--no-renames',
      '-z',
      mb,
      '--',
    ])
      .split('\0')
      .filter(Boolean),
  )
  const untracked = git(root, ['ls-files', '-z', '--others', '--exclude-standard'])
    .split('\0')
    .filter(Boolean)
  for (const f of untracked) changed.add(f)
  return { mergeBase: mb, changed, untracked: new Set(untracked) }
}

export function touchedLines(root, mergeBase, doc, isNew) {
  if (isNew) return 'all'
  const diff = git(root, [
    'diff',
    '--no-color',
    '--no-ext-diff',
    '-U0',
    '--no-renames',
    mergeBase,
    '--',
    doc,
  ])
  if (!diff) return new Set()
  // A new file, or one git shows as binary (an encrypted doc, say), counts as wholly edited.
  if (/^new file mode/m.test(diff) || /^Binary files /m.test(diff)) return 'all'
  const touched = new Set()
  for (const m of diff.matchAll(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm)) {
    const start = Number(m[1])
    const count = m[2] === undefined ? 1 : Number(m[2])
    // A pure deletion sits after new-side line `start`; those lines belonged to
    // the section that holds `start`, so only that line counts (line 1 when
    // the deletion was at the top).
    if (count === 0) touched.add(Math.max(start, 1))
    else for (let l = start; l < start + count; l++) touched.add(l)
  }
  return touched
}

export function readAcks(root, mergeBase, prBody) {
  const text = [
    git(root, ['log', '--no-color', '--format=%B%n', `${mergeBase}..HEAD`]),
    prBody || '',
  ].join('\n')
  const acks = new Map()
  // Lines that start like an ack but do not parse, so a typo is reported
  // instead of silently leaving the flag up.
  acks.malformed = []
  for (const m of text.matchAll(/^[ \t>*-]*docs-map:.*$/gim)) {
    const a = m[0].match(/^[ \t>*-]*docs-map:[ \t]*([^\s#:]+(?:#[^\s:]+)?):[ \t]*(\S.*)$/i)
    if (a) acks.set(a[1], a[2].trim())
    else acks.malformed.push(m[0].trim())
  }
  return acks
}

// ---------- upstreams ----------

// The pinned commit in a ref file: the first line that is not blank or a #
// comment. null when the file is absent, undefined when it holds no SHA.
export function readPin(root, ref, rev = null) {
  let text
  try {
    text = rev ? git(root, ['show', `${rev}:${ref}`]) : readFileSync(join(root, ref), 'utf8')
  } catch {
    return null
  }
  const line = text
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l && !l.startsWith('#'))
  const sha = line ? line.split(/\s+/)[0] : ''
  return /^[0-9a-f]{40}$/.test(sha) ? sha : undefined
}

// Lists each upstream's files at its pinned commit, prefixed with its name.
export function upstreamState(root, map) {
  const files = []
  const warnings = []
  const errors = []
  const unavailable = new Set()
  const info = new Map()
  for (const [name, u] of Object.entries(map.upstreams || {})) {
    const sha = readPin(root, u.ref)
    if (!sha) {
      errors.push(`upstream ${name}: ${u.ref} must hold one 40-character commit SHA`)
      unavailable.add(name)
      continue
    }
    const dir = join(root, u.path)
    if (!existsSync(join(dir, '.git'))) {
      warnings.push(
        `upstream ${name}: no clone at ${u.path}, so its covers are not checked (clone ${u.repo || 'it'} there with full history)`,
      )
      unavailable.add(name)
      continue
    }
    let list
    try {
      list = git(dir, ['ls-tree', '-r', '-z', '--name-only', sha])
    } catch {
      errors.push(
        `upstream ${name}: the clone at ${u.path} does not have ${sha}; fetch with full history`,
      )
      unavailable.add(name)
      continue
    }
    for (const f of list.split('\0').filter(Boolean)) files.push(`${name}:${f}`)
    info.set(name, { dir, sha, ref: u.ref })
  }
  return { files, warnings, errors, unavailable, info }
}

// Upstream files changed between the pin at the merge base and the pin now.
// A pin that is new on this branch sets a baseline and changes nothing.
export function upstreamChanges(root, mergeBase, changed, up) {
  const out = []
  const errors = []
  for (const [name, { dir, sha, ref }] of up.info) {
    if (!changed.has(ref)) continue
    const old = readPin(root, ref, mergeBase)
    if (!old || old === sha) continue
    try {
      const diff = git(dir, [
        'diff',
        '--no-color',
        '--no-ext-diff',
        '--name-only',
        '--no-renames',
        '-z',
        old,
        sha,
      ])
      for (const f of diff.split('\0').filter(Boolean)) out.push(`${name}:${f}`)
    } catch {
      errors.push(
        `upstream ${name}: cannot compare ${old} with ${sha} in its clone; fetch with full history`,
      )
    }
  }
  return { files: out, errors }
}

// ---------- the check ----------

export function loadMap(root, mapPath) {
  const raw = readFileSync(join(root, mapPath), 'utf8')
  const map = JSON.parse(raw)
  const errors = []
  if (map.version !== 1) errors.push(`${mapPath}: version must be 1`)
  if (!Array.isArray(map.entries)) errors.push(`${mapPath}: entries must be an array`)
  for (const key of ['docs', 'ignore', 'frozen', 'unbound']) {
    if (map[key] !== undefined && !Array.isArray(map[key]))
      errors.push(`${mapPath}: ${key} must be an array of globs`)
  }
  for (const mode of [map.mode, ...(map.entries || []).map((e) => e.mode)]) {
    if (mode !== undefined && mode !== 'fail' && mode !== 'warn')
      errors.push(`${mapPath}: mode must be "fail" or "warn", not "${mode}"`)
  }
  ;(map.entries || []).forEach((e, i) => {
    if (typeof e.doc !== 'string') errors.push(`${mapPath}: entries[${i}] needs a doc`)
    if (!Array.isArray(e.covers) || !e.covers.some((c) => !c.startsWith('!')))
      errors.push(
        `${mapPath}: entries[${i}] (${e.doc}) needs covers with at least one positive glob`,
      )
  })
  if (map.upstreams !== undefined) {
    if (typeof map.upstreams !== 'object' || Array.isArray(map.upstreams))
      errors.push(`${mapPath}: upstreams must be an object`)
    else
      for (const [name, u] of Object.entries(map.upstreams)) {
        if (!/^[a-z0-9][a-z0-9-]*$/.test(name))
          errors.push(`${mapPath}: upstream name "${name}" must be lowercase letters, digits and -`)
        if (!u || typeof u.ref !== 'string' || typeof u.path !== 'string')
          errors.push(`${mapPath}: upstreams.${name} needs ref and path`)
      }
  }
  const ids = new Set()
  ;(map.generators || []).forEach((g, i) => {
    if (!g.id || !g.doc || !g.command)
      errors.push(`${mapPath}: generators[${i}] needs id, doc and command`)
    if (ids.has(g.id)) errors.push(`${mapPath}: generator id "${g.id}" is used twice`)
    ids.add(g.id)
  })
  return { map, errors }
}

const sub = (glob, caps) => glob.replace(/\$(\d)/g, (_, n) => caps[Number(n) - 1] ?? '')

// Expands each entry against the file list into concrete bindings.
export function expandEntries(map, files, coverFiles = files, unavailable = new Set()) {
  const bindings = []
  const errors = []
  // An upstream glob whose clone is missing cannot be checked here.
  const skipped = (c) => {
    const m = c.replace(/^!/, '').match(/^([a-z0-9][a-z0-9-]*):/)
    return Boolean(m && unavailable.has(m[1]))
  }
  ;(map.entries || []).forEach((e, i) => {
    const label = `entries[${i}] ${e.doc}${e.section ? ` § ${e.section}` : ''}`
    const matched = files.map((f) => [f, globMatch(e.doc, f)]).filter(([, m]) => m)
    if (matched.length === 0) {
      errors.push(`${label}: no file matches the doc`)
      return
    }
    // A doc glob skips docs listed as frozen or unbound; a plain entry may not name one.
    const skip = (d) => anyMatch(map.frozen, d) || anyMatch(map.unbound, d)
    const docs = matched.filter(([d]) => !skip(d))
    if (docs.length === 0) {
      errors.push(`${label}: every matching doc is listed under frozen or unbound`)
      return
    }
    // A plain entry needs every positive covers glob to match a file, which
    // catches typos and code that moved. An entry whose doc glob expands to
    // several docs needs each expansion to cover some file, and each covers
    // glob to match a file for some expansion.
    const templated = e.covers.some((c) => /\$\d/.test(c))
    const globHit = new Map()
    for (const [doc, m] of docs) {
      const covers = (e.covers || []).map((c) => sub(c, m.slice(1)))
      let any = false
      covers.forEach((c, k) => {
        if (c.startsWith('!')) return
        if (skipped(c)) {
          any = true
          globHit.set(k, true)
          return
        }
        const hit = coverFiles.some((f) => globMatch(c, f))
        any ||= hit
        globHit.set(k, globHit.get(k) || hit)
        if (!hit && !templated) errors.push(`${label}: covers glob "${c}" matches no file`)
      })
      if (templated && !any) errors.push(`${label}: no covers glob matches a file for ${doc}`)
      bindings.push({
        entry: i,
        doc,
        section: e.section || null,
        covers,
        mode: e.mode || map.mode || 'fail',
      })
    }
    if (templated) {
      e.covers.forEach((c, k) => {
        if (!c.startsWith('!') && !globHit.get(k))
          errors.push(`${label}: covers glob "${c}" matches no file for any doc`)
      })
    }
  })
  return { bindings, errors }
}

export function run(root, opts, env = process.env) {
  const errors = []
  const warnings = []
  const flags = []
  const written = []
  const { map, errors: mapErrors } = loadMap(root, opts.map)
  errors.push(...mapErrors)
  if (mapErrors.length) return { errors, warnings, flags, written }

  const files = listFiles(root, { untracked: Boolean(opts.base) })
  const isDoc = (f) => anyMatch(map.docs || ['**/*.md'], f) && !anyMatch(map.ignore, f)
  const docs = files.filter(isDoc)
  const up = upstreamState(root, map)
  errors.push(...up.errors)
  warnings.push(...up.warnings)
  const { bindings, errors: expandErrors } = expandEntries(
    map,
    files,
    files.concat(up.files),
    up.unavailable,
  )
  errors.push(...expandErrors)

  // Generated blocks (render first so section checks see the new text).
  const generators = map.generators || []
  const docText = new Map()
  const crlf = new Set()
  const textOf = (d) => {
    // Parse with \n line endings; --write puts a CRLF file's endings back.
    if (!docText.has(d)) {
      const raw = readFileSync(join(root, d), 'utf8')
      if (raw.includes('\r\n')) crlf.add(d)
      docText.set(d, raw.replace(/\r\n/g, '\n'))
    }
    return docText.get(d)
  }
  const genById = new Map(generators.map((g) => [g.id, g]))
  for (const g of generators) {
    if (!existsSync(join(root, g.doc))) {
      errors.push(`generator "${g.id}": ${g.doc} does not exist`)
      continue
    }
    const { blocks, errors: blockErrors } = findBlocks(textOf(g.doc))
    for (const e of blockErrors) errors.push(`${g.doc}: ${e}`)
    const mine = blocks.filter((b) => b.id === g.id)
    if (mine.length !== 1) {
      errors.push(
        `${g.doc}: needs exactly one docs-map:generated block with id "${g.id}" (found ${mine.length})`,
      )
      continue
    }
    let rendered
    try {
      rendered = renderGenerator(g, root)
    } catch (err) {
      errors.push(
        `generator "${g.id}": \`${g.command}\` failed: ${(err.stderr || err.message || '').toString().trim().split('\n')[0]}`,
      )
      continue
    }
    if (blockBody(textOf(g.doc), mine[0]) === rendered) continue
    if (opts.write) {
      const next = replaceBlock(textOf(g.doc), mine[0], rendered)
      writeFileSync(join(root, g.doc), crlf.has(g.doc) ? next.replace(/\n/g, '\r\n') : next)
      docText.set(g.doc, next)
      written.push(`${g.doc} (${g.id})`)
    } else {
      errors.push(
        `${g.doc}: generated block "${g.id}" is stale; run node scripts/docs-map.mjs --write`,
      )
    }
  }
  for (const d of docs) {
    const text = textOf(d)
    if (!text.includes('docs-map:')) continue
    const { blocks, errors: blockErrors } = findBlocks(text)
    if (!generators.some((g) => g.doc === d)) for (const e of blockErrors) errors.push(`${d}: ${e}`)
    for (const b of blocks) {
      const g = genById.get(b.id)
      if (!g || g.doc !== d)
        errors.push(`${d}: generated block "${b.id}" has no generator for this doc in the map`)
    }
  }

  // Sections exist.
  const parsedDocs = new Map()
  const parsed = (d) => {
    if (!parsedDocs.has(d)) parsedDocs.set(d, parseHeadings(textOf(d)))
    return parsedDocs.get(d)
  }
  for (const b of bindings) {
    if (!b.section) {
      b.start = 1
      b.end = parsed(b.doc).lineCount
      b.key = b.doc
      continue
    }
    const found = findSection(parsed(b.doc), b.section)
    if (found.error) {
      errors.push(`${b.doc}: ${found.error} (entries[${b.entry}])`)
      b.missing = true
      continue
    }
    Object.assign(b, {
      start: found.head.start,
      end: found.head.end,
      key: `${b.doc}#${found.head.slug}`,
    })
  }

  // Every doc is accounted for.
  const bound = new Set(bindings.map((b) => b.doc))
  for (const d of docs) {
    if (bound.has(d) || anyMatch(map.frozen, d) || anyMatch(map.unbound, d)) continue
    errors.push(`${d}: not in the docs map; add an entry, or list it under frozen or unbound`)
  }

  // PR mode.
  if (opts.base) {
    const { mergeBase, changed, untracked } = changesSince(root, opts.base)
    const upChanged = upstreamChanges(root, mergeBase, changed, up)
    errors.push(...upChanged.errors)
    for (const f of upChanged.files) changed.add(f)
    const acks = readAcks(root, mergeBase, env.DOCS_MAP_PR_BODY)
    const used = new Set()
    const touchCache = new Map()
    const touched = (d) => {
      if (!touchCache.has(d))
        touchCache.set(
          d,
          changed.has(d) ? touchedLines(root, mergeBase, d, untracked.has(d)) : new Set(),
        )
      return touchCache.get(d)
    }
    const byKey = new Map()
    for (const b of bindings) {
      if (b.missing || anyMatch(map.frozen, b.doc)) continue
      const hits = [...changed].filter((f) => f !== b.doc && matchesCovers(b.covers, f))
      if (hits.length === 0) continue
      const t = touched(b.doc)
      let edited = t === 'all'
      for (let l = b.start; !edited && l <= b.end; l++) if (t.has(l)) edited = true
      if (edited) continue
      // Entries that bind the same section make one flag: fail if any of them
      // is fail, listing every changed file they cover.
      const prior = byKey.get(b.key)
      if (prior) {
        if (b.mode === 'fail') prior.mode = 'fail'
        for (const h of hits) if (!prior.changed.includes(h)) prior.changed.push(h)
        continue
      }
      const ack = acks.get(b.key)
      if (ack !== undefined) used.add(b.key)
      const flag = {
        key: b.key,
        doc: b.doc,
        section: b.section,
        line: b.start,
        mode: b.mode,
        changed: hits,
        ack: ack ?? null,
      }
      byKey.set(b.key, flag)
      flags.push(flag)
    }
    for (const k of acks.keys())
      if (!used.has(k)) warnings.push(`ack "docs-map: ${k}" matches no flag on this branch`)
    for (const line of acks.malformed)
      warnings.push(
        `ack line "${line}" does not parse; the form is "docs-map: <doc>[#<heading-slug>]: <reason>"`,
      )
  }

  return { errors, warnings, flags, written }
}

// --why: which sections bind these files.
export function why(root, opts, paths) {
  const { map, errors } = loadMap(root, opts.map)
  if (errors.length) return { errors, bound: [] }
  const files = listFiles(root)
  const up = upstreamState(root, map)
  const { bindings } = expandEntries(map, files, files.concat(up.files), up.unavailable)
  return {
    errors: [],
    bound: paths.map((p) => ({
      file: p,
      sections: bindings
        .filter((b) => matchesCovers(b.covers, p))
        .map((b) => (b.section ? `${b.doc} § ${b.section}` : b.doc)),
    })),
  }
}

// --drift: what moving each upstream pin to its clone's HEAD would flag.
export function drift(root, opts) {
  const { map, errors } = loadMap(root, opts.map)
  if (errors.length) return { errors, warnings: [], upstreams: [] }
  const files = listFiles(root)
  const up = upstreamState(root, map)
  const { bindings } = expandEntries(map, files, files.concat(up.files), up.unavailable)
  const upstreams = []
  for (const [name, { dir, sha }] of up.info) {
    const head = git(dir, ['rev-parse', 'HEAD']).trim()
    const changed =
      head === sha
        ? []
        : git(dir, [
            'diff',
            '--no-color',
            '--no-ext-diff',
            '--name-only',
            '--no-renames',
            '-z',
            sha,
            head,
          ])
            .split('\0')
            .filter(Boolean)
            .map((f) => `${name}:${f}`)
    const sections = new Map()
    for (const b of bindings) {
      if (anyMatch(map.frozen, b.doc)) continue
      const hits = changed.filter((f) => matchesCovers(b.covers, f))
      if (hits.length === 0) continue
      const where = b.section ? `${b.doc} § ${b.section}` : b.doc
      const prior = sections.get(where)
      if (!prior) sections.set(where, { section: where, mode: b.mode, changed: hits })
      else {
        if (b.mode === 'fail') prior.mode = 'fail'
        for (const h of hits) if (!prior.changed.includes(h)) prior.changed.push(h)
      }
    }
    upstreams.push({
      name,
      pin: sha,
      head,
      changed: changed.length,
      sections: [...sections.values()],
    })
  }
  return { errors: up.errors, warnings: up.warnings, upstreams }
}

// ---------- output ----------

function report(result, opts) {
  const { errors, warnings, flags, written } = result
  const failing = flags.filter((f) => f.mode === 'fail' && f.ack === null)
  const gha = process.env.GITHUB_ACTIONS === 'true'
  const out = []
  for (const w of written) out.push(`rendered ${w}`)
  for (const e of errors) {
    out.push(`error: ${e}`)
    if (gha) print(`::error::${ghaEscape(e)}`)
  }
  for (const w of warnings) out.push(`warning: ${w}`)
  for (const f of flags) {
    const where = f.section ? `${f.doc} § ${f.section}` : f.doc
    const state =
      f.ack !== null
        ? `acknowledged: ${f.ack}`
        : f.mode === 'warn'
          ? 'warning'
          : 'needs an edit or an ack'
    out.push(
      `flag: ${where} (${state})\n  changed: ${f.changed.slice(0, 5).join(', ')}${f.changed.length > 5 ? ', ...' : ''}${f.ack === null ? `\n  ack line: docs-map: ${f.key}: <why no edit is needed>` : ''}`,
    )
    if (gha && f.ack === null)
      print(
        `::${f.mode === 'fail' ? 'error' : 'warning'} file=${f.doc},line=${f.line}::${ghaEscape(`Code this section describes changed (${f.changed[0]}${f.changed.length > 1 ? ` and ${f.changed.length - 1} more` : ''}). Edit the section, or add "docs-map: ${f.key}: <reason>" to a commit message or, where the workflow reads it, the PR body.`)}`,
      )
  }
  if (!errors.length && !failing.length)
    out.push(
      `docs-map: ok${!opts.base ? '' : flags.length ? ` (${flags.length} flag${flags.length === 1 ? '' : 's'}: ${flags.filter((f) => f.ack !== null).length} acknowledged, ${flags.filter((f) => f.ack === null).length} warn-only)` : ' (no flags)'}`,
    )
  if (failing.length)
    out.push(
      `docs-map: ${failing.length} flag${failing.length === 1 ? ' needs' : 's need'} an edit to the section or an ack line in a commit message (or the PR body, where the workflow reads it)`,
    )
  print(out.join('\n'))
  if (gha && process.env.GITHUB_STEP_SUMMARY && (errors.length || flags.length)) {
    const md = ['### docs-map', '']
    for (const e of errors) md.push(`- ❌ ${e}`)
    for (const f of flags)
      md.push(
        `- ${f.ack !== null ? '✅' : f.mode === 'warn' ? '⚠️' : '❌'} \`${f.key}\` (changed: ${f.changed
          .slice(0, 3)
          .map((c) => `\`${c}\``)
          .join(', ')})${f.ack !== null ? `: ${f.ack}` : ''}`,
      )
    try {
      writeFileSync(process.env.GITHUB_STEP_SUMMARY, md.join('\n') + '\n', {
        flag: 'a',
      })
    } catch {
      // The summary is a convenience; the log above already has everything.
    }
  }
}

function main() {
  let opts
  try {
    opts = parseArgs(process.argv.slice(2))
  } catch (err) {
    printErr(`docs-map: ${err.message}`)
    process.exit(1)
  }
  if (opts.version) return print(VERSION)
  if (opts.help)
    return print(
      readFileSync(new URL(import.meta.url), 'utf8')
        .split('\n')
        .slice(2, 16)
        .map((l) => l.replace(/^\/\/ ?/, ''))
        .join('\n'),
    )
  const root = git(process.cwd(), ['rev-parse', '--show-toplevel']).trim()
  if (opts.why) {
    const r = why(root, opts, opts.why)
    if (opts.json) print(JSON.stringify(r, null, 2))
    else
      for (const b of r.bound)
        print(`${b.file}\n${b.sections.map((s) => `  ${s}`).join('\n') || '  (no doc section)'}`)
    process.exit(r.errors.length ? 1 : 0)
  }
  if (opts.drift) {
    const r = drift(root, opts)
    if (opts.json) print(JSON.stringify(r, null, 2))
    else {
      for (const e of r.errors) print(`error: ${e}`)
      for (const w of r.warnings) print(`warning: ${w}`)
      for (const u of r.upstreams) {
        print(
          u.pin === u.head
            ? `${u.name}: the pin is current (${u.pin.slice(0, 12)})`
            : `${u.name}: ${u.changed} file${u.changed === 1 ? '' : 's'} changed from ${u.pin.slice(0, 12)} to ${u.head.slice(0, 12)}; ${u.sections.length} bound section${u.sections.length === 1 ? '' : 's'} to review`,
        )
        for (const s of u.sections)
          print(
            `  ${s.section} (${s.mode})\n${s.changed
              .slice(0, 10)
              .map((f) => `    ${f}`)
              .join(
                '\n',
              )}${s.changed.length > 10 ? `\n    ... and ${s.changed.length - 10} more` : ''}`,
          )
      }
    }
    process.exit(r.errors.length ? 1 : 0)
  }
  let result
  try {
    result = run(root, opts)
  } catch (err) {
    printErr(`docs-map: ${err.message}`)
    process.exit(1)
  }
  if (opts.json) print(JSON.stringify(result, null, 2))
  else report(result, opts)
  if (result.errors.length) process.exit(1)
  if (result.flags.some((f) => f.mode === 'fail' && f.ack === null)) process.exit(2)
}

const invoked = (() => {
  try {
    return process.argv[1] && pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url
  } catch {
    return false
  }
})()
if (invoked) main()
