// Tests for scripts/docs-map.mjs. Copied byte for byte with the script.
// Run: node --test scripts/docs-map.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  globMatch,
  matchesCovers,
  slugify,
  parseHeadings,
  findSection,
  findBlocks,
  readAcks,
  run,
  drift,
} from './docs-map.mjs'

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'docs-map.mjs')

function repo(files) {
  const root = mkdtempSync(join(tmpdir(), 'docs-map-'))
  const g = (...a) =>
    execFileSync('git', a, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  g('init', '-q', '-b', 'main')
  g('config', 'user.email', 'test@example.com')
  g('config', 'user.name', 'test')
  g('config', 'commit.gpgsign', 'false')
  const put = (fs) => {
    for (const [p, c] of Object.entries(fs)) {
      mkdirSync(dirname(join(root, p)), { recursive: true })
      if (c === null) rmSync(join(root, p))
      else writeFileSync(join(root, p), typeof c === 'string' ? c : JSON.stringify(c, null, 2))
    }
    // Stage, so plain mode (tracked files only) sees the change.
    g('add', '-A')
  }
  put(files)
  g('commit', '-q', '-m', 'base')
  return {
    root,
    put,
    git: g,
    commit(msg, fs = {}) {
      put(fs)
      g('add', '-A')
      g('commit', '-q', '--allow-empty', '-m', msg)
    },
    branch: (name) => g('checkout', '-q', '-b', name),
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  }
}

const README =
  '# Tool\n\nIntro.\n\n## Commands\n\nRun it.\n\n### Flags\n\n--x\n\n## Config\n\nKeys.\n'
const baseMap = (extra = {}) => ({
  version: 1,
  entries: [
    { doc: 'README.md', section: 'Commands', covers: ['src/cli.js'] },
    {
      doc: 'README.md',
      section: 'config',
      covers: ['src/config*', '!src/**/*.test.js'],
      mode: 'warn',
    },
  ],
  ...extra,
})

test('globs: ** spans segments, * stays in one, braces and negation', () => {
  assert.ok(globMatch('src/**', 'src/a/b.ts'))
  assert.ok(globMatch('**/*.md', 'README.md'))
  assert.ok(globMatch('**/*.md', 'a/b/c.md'))
  assert.ok(!globMatch('src/*.ts', 'src/a/b.ts'))
  assert.ok(globMatch('src/*.{ts,js}', 'src/a.js'))
  assert.ok(globMatch('docs/**/x.md', 'docs/x.md'))
  assert.deepEqual([...globMatch('packages/*/README.md', 'packages/mcp/README.md')].slice(1), [
    'mcp',
  ])
  assert.ok(matchesCovers(['src/**', '!src/**/*.test.ts'], 'src/a.ts'))
  assert.ok(!matchesCovers(['src/**', '!src/**/*.test.ts'], 'src/a.test.ts'))
  assert.ok(globMatch('a.b', 'a.b') && !globMatch('a.b', 'axb'))
})

test('slugs follow GitHub anchors', () => {
  assert.equal(slugify('Hosted hub sync'), 'hosted-hub-sync')
  assert.equal(slugify('`rousr send` & friends'), 'rousr-send--friends')
  assert.equal(slugify('[Link](x.md) text'), 'link-text')
  assert.equal(slugify('October 16: the work map'), 'october-16-the-work-map')
  assert.equal(slugify('`Map<K,V>` and <code>b</code>'), 'mapkv-and-b')
  assert.equal(slugify('Café naïve'), 'café-naïve')
})

test('headings: GitHub duplicate slugs, a closing # run, inline fences', () => {
  const p = parseHeadings(
    '# Foo\n# Foo\n# Foo 1\n## Using C#\n## Done ##\n```js``` inline\n## After\n',
  )
  assert.deepEqual(
    p.heads.map((h) => [h.text, h.slug]),
    [
      ['Foo', 'foo'],
      ['Foo', 'foo-1'],
      ['Foo 1', 'foo-1-1'],
      ['Using C#', 'using-c'],
      ['Done', 'done'],
      ['After', 'after'],
    ],
  )
})

test('sections run to the next heading of the same or higher level, ignoring fenced code', () => {
  const p = parseHeadings('# A\n```\n# not a heading\n```\n## B\nb\n### C\nc\n## D\n## D\n')
  assert.deepEqual(
    p.heads.map((h) => [h.text, h.slug, h.start, h.end]),
    [
      ['A', 'a', 1, 11],
      ['B', 'b', 5, 8],
      ['C', 'c', 7, 8],
      ['D', 'd', 9, 9],
      ['D', 'd-1', 10, 11],
    ],
  )
  assert.equal(findSection(p, 'd-1').head.start, 10)
  assert.match(findSection(p, 'D').error, /appears 2 times/)
  assert.match(findSection(p, 'Z').error, /no heading/)
})

test('generated block markers must be lines of their own', () => {
  const text =
    'a\n<!-- docs-map:generated id="x" -->\nold\n<!-- docs-map:end id="x" -->\nsee `<!-- docs-map:generated id="y" -->`\n'
  const { blocks, errors } = findBlocks(text)
  assert.deepEqual(errors, [])
  assert.deepEqual(blocks, [{ id: 'x', startLine: 1, endLine: 3 }])
  assert.match(findBlocks('<!-- docs-map:generated id="x" -->\n').errors[0], /never closed/)
})

test('a clean map passes; every doc must be accounted for', () => {
  const r = repo({
    'README.md': README,
    'NOTES.md': '# n\n',
    'src/cli.js': '',
    'src/config.js': '',
    'docs/docs-map.json': baseMap(),
  })
  try {
    let res = run(r.root, { map: 'docs/docs-map.json' })
    assert.deepEqual(res.errors, [
      'NOTES.md: not in the docs map; add an entry, or list it under frozen or unbound',
    ])
    r.put({ 'docs/docs-map.json': baseMap({ unbound: ['NOTES.md'] }) })
    res = run(r.root, { map: 'docs/docs-map.json' })
    assert.deepEqual(res.errors, [])
  } finally {
    r.cleanup()
  }
})

test('stale map entries fail: missing doc, section, or covered file', () => {
  const r = repo({
    'README.md': README,
    'src/cli.js': '',
    'docs/docs-map.json': {
      version: 1,
      entries: [
        { doc: 'GONE.md', covers: ['src/cli.js'] },
        { doc: 'README.md', section: 'Nope', covers: ['src/cli.js'] },
        { doc: 'README.md', section: 'Commands', covers: ['src/missing.js'] },
      ],
    },
  })
  try {
    const { errors } = run(r.root, { map: 'docs/docs-map.json' })
    assert.equal(errors.length, 3)
    assert.match(errors[0], /GONE\.md: no file matches/)
    assert.match(errors[1], /covers glob "src\/missing\.js" matches no file/)
    assert.match(errors[2], /no heading "Nope"/)
  } finally {
    r.cleanup()
  }
})

test('captures carry from doc globs into covers', () => {
  const r = repo({
    'packages/a/README.md': '# a\n',
    'packages/a/src/x.ts': '',
    'packages/b/README.md': '# b\n',
    'docs/docs-map.json': {
      version: 1,
      entries: [{ doc: 'packages/*/README.md', covers: ['packages/$1/src/**'] }],
    },
  })
  try {
    const { errors } = run(r.root, { map: 'docs/docs-map.json' })
    assert.deepEqual(errors, [
      'entries[0] packages/*/README.md: no covers glob matches a file for packages/b/README.md',
    ])
    r.put({
      'packages/b/package.json': '{}',
      'docs/docs-map.json': {
        version: 1,
        entries: [
          {
            doc: 'packages/*/README.md',
            covers: ['packages/$1/src/**', 'packages/$1/package.json', 'packages/$1/typo/**'],
          },
        ],
      },
    })
    assert.deepEqual(run(r.root, { map: 'docs/docs-map.json' }).errors, [
      'entries[0] packages/*/README.md: covers glob "packages/$1/typo/**" matches no file for any doc',
    ])
    r.put({
      'docs/docs-map.json': {
        version: 1,
        unbound: ['packages/b/README.md'],
        entries: [{ doc: 'packages/*/README.md', covers: ['packages/$1/src/**'] }],
      },
    })
    assert.deepEqual(run(r.root, { map: 'docs/docs-map.json' }).errors, [])
  } finally {
    r.cleanup()
  }
})

test('generated blocks: stale fails, --write renders, fence wraps output', () => {
  const doc =
    '# T\n\n## Usage\n\n<!-- docs-map:generated id="usage" -->\nold\n<!-- docs-map:end id="usage" -->\n'
  const r = repo({
    'README.md': doc,
    'cli.mjs': "console.log('usage: t [--x]')\n",
    'docs/docs-map.json': {
      version: 1,
      entries: [{ doc: 'README.md', covers: ['cli.mjs'] }],
      generators: [{ id: 'usage', doc: 'README.md', command: 'node cli.mjs', fence: 'text' }],
    },
  })
  try {
    assert.match(
      run(r.root, { map: 'docs/docs-map.json' }).errors[0],
      /generated block "usage" is stale/,
    )
    const w = run(r.root, { map: 'docs/docs-map.json', write: true })
    assert.deepEqual(w.errors, [])
    assert.deepEqual(w.written, ['README.md (usage)'])
    assert.match(
      readFileSync(join(r.root, 'README.md'), 'utf8'),
      /id="usage" -->\n```text\nusage: t \[--x\]\n```\n<!-- docs-map:end/,
    )
    assert.deepEqual(run(r.root, { map: 'docs/docs-map.json' }).errors, [])
    r.put({
      'README.md':
        doc + '\n<!-- docs-map:generated id="orphan" -->\n<!-- docs-map:end id="orphan" -->\n',
    })
    assert.ok(
      run(r.root, { map: 'docs/docs-map.json' }).errors.some((e) =>
        /"orphan" has no generator/.test(e),
      ),
    )
  } finally {
    r.cleanup()
  }
})

test('PR mode flags untouched sections, clears on an edit or an ack, respects negation and mode', () => {
  const r = repo({
    'README.md': README,
    'src/cli.js': '1',
    'src/config.js': '1',
    'src/config.test.js': '1',
    'docs/docs-map.json': baseMap(),
  })
  try {
    r.branch('feature')
    r.commit('change cli', { 'src/cli.js': '2', 'src/config.test.js': '2' })
    let res = run(r.root, { map: 'docs/docs-map.json', base: 'main' })
    assert.deepEqual(
      res.flags.map((f) => [f.key, f.mode, f.ack]),
      [['README.md#commands', 'fail', null]],
    )

    // Editing a subsection counts as touching the section.
    r.put({ 'README.md': README.replace('--x', '--x, --y') })
    res = run(r.root, { map: 'docs/docs-map.json', base: 'main' })
    assert.deepEqual(res.flags, [])
    r.put({ 'README.md': README })

    // Editing a different section does not.
    r.put({ 'README.md': README.replace('Keys.', 'Keys and more.') })
    assert.equal(run(r.root, { map: 'docs/docs-map.json', base: 'main' }).flags.length, 1)
    r.put({ 'README.md': README })

    // A commit-message ack clears it; an env PR body works too.
    r.commit('refactor\n\ndocs-map: README.md#commands: internal rename, no behavior change')
    res = run(r.root, { map: 'docs/docs-map.json', base: 'main' })
    assert.equal(res.flags[0].ack, 'internal rename, no behavior change')

    // Warn-mode entries flag but never fail.
    r.commit('config', { 'src/config.js': '2' })
    res = run(
      r.root,
      { map: 'docs/docs-map.json', base: 'main' },
      { DOCS_MAP_PR_BODY: 'docs-map: README.md#nothing: stale ack' },
    )
    assert.deepEqual(
      res.flags.map((f) => [f.key, f.mode]),
      [
        ['README.md#commands', 'fail'],
        ['README.md#config', 'warn'],
      ],
    )
    assert.deepEqual(res.warnings, [
      'ack "docs-map: README.md#nothing" matches no flag on this branch',
    ])
  } finally {
    r.cleanup()
  }
})

test('PR mode: a doc git sees as binary counts as edited', () => {
  const r = repo({
    '.gitattributes': 'secret.md binary\n',
    'secret.md': '# s\n',
    'src/a.js': '1',
    'docs/docs-map.json': { version: 1, entries: [{ doc: 'secret.md', covers: ['src/a.js'] }] },
  })
  try {
    r.branch('f')
    r.commit('c', { 'src/a.js': '2', 'secret.md': '# s\nmore\n' })
    assert.deepEqual(run(r.root, { map: 'docs/docs-map.json', base: 'main' }).flags, [])
  } finally {
    r.cleanup()
  }
})

test('acks: trailer case, bullets, whole-file keys', () => {
  const r = repo({ 'a.md': '# a\n' })
  try {
    r.branch('f')
    r.commit('x\n\nDocs-map: a.md: no change\n- docs-map: b.md#sec: also fine')
    const acks = readAcks(
      r.root,
      execFileSync('git', ['rev-parse', 'main'], { cwd: r.root, encoding: 'utf8' }).trim(),
      'docs-map: c.md#x-y: from body',
    )
    assert.deepEqual(
      [...acks],
      [
        ['a.md', 'no change'],
        ['b.md#sec', 'also fine'],
        ['c.md#x-y', 'from body'],
      ],
    )
  } finally {
    r.cleanup()
  }
})

test('CLI exit codes: 0 clean, 1 map error, 2 unacknowledged flag', () => {
  const r = repo({
    'README.md': README,
    'src/cli.js': '1',
    'src/config.js': '1',
    'docs/docs-map.json': baseMap(),
  })
  const cli = (...a) =>
    spawnSync(process.execPath, [SCRIPT, ...a], {
      cwd: r.root,
      encoding: 'utf8',
      env: { ...process.env, GITHUB_ACTIONS: '' },
    })
  try {
    assert.equal(cli().status, 0)
    r.branch('f')
    r.commit('c', { 'src/cli.js': '2' })
    const two = cli('--base', 'main')
    assert.equal(two.status, 2)
    assert.match(two.stdout, /ack line: docs-map: README\.md#commands:/)
    assert.match(cli('--why', 'src/cli.js').stdout, /README\.md § Commands/)
    r.put({ 'EXTRA.md': '# x\n' })
    assert.equal(cli('--base', 'main').status, 1)
  } finally {
    r.cleanup()
  }
})

test('PR mode: a deletion at the end of one section does not clear the next', () => {
  const r = repo({
    'README.md': README,
    'src/config.js': '1',
    'docs/docs-map.json': baseMap(),
    'src/cli.js': '1',
  })
  try {
    r.branch('f')
    r.commit('c', { 'src/config.js': '2', 'README.md': README.replace('--x\n\n', '') })
    const res = run(r.root, { map: 'docs/docs-map.json', base: 'main' })
    assert.deepEqual(
      res.flags.map((f) => f.key),
      ['README.md#config'],
    )
  } finally {
    r.cleanup()
  }
})

test('PR mode: entries sharing a section make one flag, fail if any entry fails', () => {
  const r = repo({
    'README.md': README,
    'src/a.js': '1',
    'src/b.js': '1',
    'docs/docs-map.json': {
      version: 1,
      entries: [
        { doc: 'README.md', covers: ['src/a.js'], mode: 'warn' },
        { doc: 'README.md', covers: ['src/b.js'] },
      ],
    },
  })
  try {
    r.branch('f')
    r.commit('c', { 'src/a.js': '2', 'src/b.js': '2' })
    const res = run(r.root, { map: 'docs/docs-map.json', base: 'main' })
    assert.deepEqual(
      res.flags.map((f) => [f.key, f.mode, f.changed]),
      [['README.md', 'fail', ['src/a.js', 'src/b.js']]],
    )
  } finally {
    r.cleanup()
  }
})

test('PR mode ignores color and external diff settings; malformed acks warn', () => {
  const r = repo({
    'README.md': README,
    'src/cli.js': '1',
    'src/config.js': '1',
    'docs/docs-map.json': baseMap(),
  })
  try {
    r.git('config', 'color.ui', 'always')
    r.git('config', 'color.diff', 'always')
    r.branch('f')
    r.commit('c\n\ndocs-map: README.md#Commands typo: heading text, not slug', {
      'src/cli.js': '2',
      'README.md': README.replace('Run it.', 'Run it now.'),
    })
    const res = run(r.root, { map: 'docs/docs-map.json', base: 'main' })
    assert.deepEqual(res.flags, [])
    assert.equal(res.warnings.length, 1)
    assert.match(res.warnings[0], /does not parse/)
  } finally {
    r.cleanup()
  }
})

test('plain mode ignores untracked files; CRLF docs render and keep their endings', () => {
  const r = repo({
    'README.md':
      '# T\r\n\r\n<!-- docs-map:generated id="v" -->\r\nold\r\n<!-- docs-map:end id="v" -->\r\n',
    'docs/docs-map.json': {
      version: 1,
      unbound: ['README.md'],
      entries: [],
      generators: [{ id: 'v', doc: 'README.md', command: 'echo new' }],
    },
  })
  try {
    writeFileSync(join(r.root, 'scratch.md'), '# scratch\n')
    assert.deepEqual(run(r.root, { map: 'docs/docs-map.json' }).errors, [
      'README.md: generated block "v" is stale; run node scripts/docs-map.mjs --write',
    ])
    run(r.root, { map: 'docs/docs-map.json', write: true })
    assert.equal(
      readFileSync(join(r.root, 'README.md'), 'utf8'),
      '# T\r\n\r\n<!-- docs-map:generated id="v" -->\r\nnew\r\n<!-- docs-map:end id="v" -->\r\n',
    )
    assert.deepEqual(run(r.root, { map: 'docs/docs-map.json' }).errors, [])
  } finally {
    r.cleanup()
  }
})

test('frozen and unbound lists take ! exclusions', () => {
  const r = repo({
    'plans/old.md': '# old\n',
    'plans/live.md': '# live\n',
    'src/a.js': '1',
    'docs/docs-map.json': {
      version: 1,
      frozen: ['plans/**', '!plans/live.md'],
      entries: [{ doc: 'plans/live.md', covers: ['src/a.js'] }],
    },
  })
  try {
    assert.deepEqual(run(r.root, { map: 'docs/docs-map.json' }).errors, [])
    r.branch('f')
    r.commit('c', { 'src/a.js': '2' })
    assert.deepEqual(
      run(r.root, { map: 'docs/docs-map.json', base: 'main' }).flags.map((f) => f.key),
      ['plans/live.md'],
    )
  } finally {
    r.cleanup()
  }
})

test('upstreams: prefixed covers match at the pin; a pin bump flags bound docs', () => {
  const up = repo({ 'src/verbs.ts': 'a', 'src/other.ts': 'a', 'README.md': '# up\n' })
  const sha = () => up.git('rev-parse', 'HEAD').trim()
  const first = sha()
  const map = {
    version: 1,
    docs: ['**/*.md', 'site/*.tsx'],
    upstreams: { up: { repo: 'example/up', ref: 'upstream/up.ref', path: '.upstream/up' } },
    entries: [
      { doc: 'site/Verbs.tsx', covers: ['up:src/verbs.ts'] },
      { doc: 'README.md', covers: ['src/**', 'up:README.md'], mode: 'warn' },
    ],
  }
  const r = repo({
    '.gitignore': '.upstream/\n',
    'README.md': '# site\n',
    'src/a.ts': '1',
    'site/Verbs.tsx': 'export const VERBS = ["a"]\n',
    'upstream/up.ref': `# pinned upstream commit\n${first}\n`,
    'docs/docs-map.json': map,
  })
  try {
    const opts = { map: 'docs/docs-map.json' }
    // No clone: a warning, and the upstream globs are skipped.
    let res = run(r.root, opts)
    assert.deepEqual(res.errors, [])
    assert.match(res.warnings[0], /upstream up: no clone at \.upstream\/up/)

    execFileSync('git', ['clone', '-q', up.root, join(r.root, '.upstream/up')])
    res = run(r.root, opts)
    assert.deepEqual([res.errors, res.warnings], [[], []])

    // A prefixed glob that matches nothing upstream is a stale entry, and a
    // local glob never matches an upstream file.
    r.put({
      'docs/docs-map.json': {
        ...map,
        entries: [
          { doc: 'site/Verbs.tsx', covers: ['up:src/gone.ts'] },
          { doc: 'README.md', covers: ['**/verbs.ts', 'src/**'] },
        ],
      },
    })
    assert.deepEqual(run(r.root, opts).errors, [
      'entries[0] site/Verbs.tsx: covers glob "up:src/gone.ts" matches no file',
      'entries[1] README.md: covers glob "**/verbs.ts" matches no file',
    ])
    r.commit('restore map', { 'docs/docs-map.json': map })

    // Upstream moves; the branch bumps the pin and leaves the page alone.
    up.commit('change verbs', { 'src/verbs.ts': 'b', 'src/other.ts': 'b' })
    execFileSync('git', ['-C', join(r.root, '.upstream/up'), 'pull', '-q'])
    r.branch('bump')
    r.commit('bump pin', { 'upstream/up.ref': `${sha()}\n` })
    res = run(r.root, { ...opts, base: 'main' })
    assert.deepEqual(
      res.flags.map((f) => [f.key, f.mode, f.changed]),
      [['site/Verbs.tsx', 'fail', ['up:src/verbs.ts']]],
    )
    // Editing the page clears it, as for any whole-file doc.
    r.put({ 'site/Verbs.tsx': 'export const VERBS = ["a", "b"]\n' })
    assert.deepEqual(run(r.root, { ...opts, base: 'main' }).flags, [])

    // A pin the clone does not have is an error.
    r.put({ 'upstream/up.ref': `${'0'.repeat(40)}\n` })
    assert.match(run(r.root, opts).errors[0], /does not have 0{40}; fetch with full history/)
    r.put({ 'upstream/up.ref': 'main\n' })
    assert.deepEqual(run(r.root, opts).errors, [
      'upstream up: upstream/up.ref must hold one 40-character commit SHA',
    ])
  } finally {
    r.cleanup()
    up.cleanup()
  }
})

test('upstreams: a pin new on the branch sets a baseline and flags nothing', () => {
  const up = repo({ 'src/verbs.ts': 'a' })
  const r = repo({
    'README.md': '# site\n',
    '.gitignore': '.upstream/\n',
    'docs/docs-map.json': { version: 1, entries: [{ doc: 'README.md', covers: ['.gitignore'] }] },
  })
  try {
    execFileSync('git', ['clone', '-q', up.root, join(r.root, '.upstream/up')])
    r.branch('add')
    r.commit('add upstream', {
      'upstream/up.ref': `${up.git('rev-parse', 'HEAD').trim()}\n`,
      'site/Verbs.tsx': 'x\n',
      'docs/docs-map.json': {
        version: 1,
        upstreams: { up: { ref: 'upstream/up.ref', path: '.upstream/up' } },
        entries: [
          { doc: 'README.md', covers: ['.gitignore'] },
          { doc: 'site/Verbs.tsx', covers: ['up:src/**'] },
        ],
      },
    })
    const res = run(r.root, { map: 'docs/docs-map.json', base: 'main' })
    assert.deepEqual([res.errors, res.flags], [[], []])
  } finally {
    r.cleanup()
    up.cleanup()
  }
})

test('upstreams: --drift lists the sections a pin move would flag', () => {
  const up = repo({ 'src/verbs.ts': 'a', 'src/other.ts': 'a' })
  const pin = up.git('rev-parse', 'HEAD').trim()
  const r = repo({
    '.gitignore': '.upstream/\n',
    'README.md': '# site\n\n## Verbs\n\nattest, recall\n',
    'upstream/up.ref': `${pin}\n`,
    'docs/docs-map.json': {
      version: 1,
      upstreams: { up: { ref: 'upstream/up.ref', path: '.upstream/up' } },
      entries: [
        { doc: 'README.md', section: 'Verbs', covers: ['up:src/verbs.ts'] },
        { doc: 'README.md', section: 'Verbs', covers: ['up:src/**'], mode: 'warn' },
      ],
    },
  })
  try {
    const clone = join(r.root, '.upstream/up')
    execFileSync('git', ['clone', '-q', up.root, clone])
    const opts = { map: 'docs/docs-map.json' }
    assert.deepEqual(drift(r.root, opts).upstreams, [
      { name: 'up', pin, head: pin, changed: 0, sections: [] },
    ])
    up.commit('change', { 'src/verbs.ts': 'b', 'src/other.ts': 'b' })
    execFileSync('git', ['-C', clone, 'pull', '-q'])
    const [u] = drift(r.root, opts).upstreams
    assert.equal(u.changed, 2)
    assert.deepEqual(u.sections, [
      {
        section: 'README.md § Verbs',
        mode: 'fail',
        changed: ['up:src/verbs.ts', 'up:src/other.ts'],
      },
    ])
    const cli = spawnSync('node', [SCRIPT, '--drift'], { cwd: r.root, encoding: 'utf8' })
    assert.equal(cli.status, 0)
    assert.match(
      cli.stdout,
      /^up: 2 files changed from \w{12} to \w{12}; 1 bound section to review\n {2}README\.md § Verbs \(fail\)\n/,
    )
  } finally {
    r.cleanup()
    up.cleanup()
  }
})
