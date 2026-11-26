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
  }
  put(files)
  g('add', '-A')
  g('commit', '-q', '-m', 'base')
  return {
    root,
    put,
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
      covers: ['src/config.js', '!src/**/*.test.js'],
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
