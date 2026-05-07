// Custom changeset formatter for atrib that inline-links bare §X.Y and Dxxx
// references during `changeset version` generation. Wraps the default
// formatter (`@changesets/cli/changelog`) so future CHANGELOG.md files land
// with linked references instead of bare ones.
//
// Anchor maps are loaded fresh from atrib-spec.md and DECISIONS.md at
// version-time so newly-added headings/ADRs are picked up automatically.
//
// Path assumption: every CHANGELOG.md this formatter writes lives 2 levels
// deep from repo root (packages/<name>/, services/<name>/). If a CHANGELOG
// lands at a different depth, parameterize via the `options` tuple in
// .changeset/config.json.
//
// Wire-up: see .changeset/config.json `"changelog": "./changelog-atrib.cjs"`.

const fs = require("node:fs");
const path = require("node:path");
const baseChangelog = require("@changesets/cli/changelog");

const REPO_ROOT = path.resolve(__dirname, "..");
const SPEC_PATH = path.join(REPO_ROOT, "atrib-spec.md");
const DECISIONS_PATH = path.join(REPO_ROOT, "DECISIONS.md");
const RELATIVE_PREFIX = "../..";

let cachedAnchors = null;

function slugify(text) {
  return text
    .trim()
    // Strip markdown link syntax: [display](url) -> display (visible text).
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .toLowerCase()
    .replace(/`/g, "")
    .replace(/\*/g, "")
    .replace(/[\[\]()]/g, "")
    .replace(/[^a-z0-9\-_ ]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function collectHeadings(filePath) {
  const text = fs.readFileSync(filePath, "utf8");
  const out = [];
  let inFence = false;
  for (const line of text.split("\n")) {
    const s = line.trimStart();
    if (s.startsWith("```") || s.startsWith("~~~")) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const m = s.match(/^(#{1,6})\s+(.+?)\s*$/);
    if (m) out.push(m[2]);
  }
  return out;
}

function buildSectionAnchors() {
  const out = {};
  for (const heading of collectHeadings(SPEC_PATH)) {
    const stripped = heading.replace(/^§\s?/, "");
    const m = stripped.match(/^(\d+(?:\.\d+)*)\s+/);
    if (!m) continue;
    out[m[1]] = slugify(heading);
  }
  return out;
}

function buildAdrAnchors() {
  const out = {};
  for (const heading of collectHeadings(DECISIONS_PATH)) {
    const m = heading.match(/^(D\d{3})\b/);
    if (m) out[m[1].toUpperCase()] = slugify(heading);
  }
  return out;
}

function loadAnchors() {
  if (cachedAnchors) return cachedAnchors;
  cachedAnchors = {
    sections: buildSectionAnchors(),
    adrs: buildAdrAnchors(),
  };
  return cachedAnchors;
}

// Walk text. For each char, decide whether it's inside a fenced code block,
// inline code span, or markdown link. Bare references get inline-linked;
// references already linked or in code stay untouched.
function autolink(text) {
  const { sections, adrs } = loadAnchors();
  const out = [];
  let inFence = false;
  for (const line of text.split("\n")) {
    const trimmed = line.trimStart();
    if (trimmed.startsWith("```") || trimmed.startsWith("~~~")) {
      inFence = !inFence;
      out.push(line);
      continue;
    }
    if (inFence) {
      out.push(line);
      continue;
    }
    const headingMatch = line.match(/^(\s*#{1,6}\s+)(.*)$/);
    if (headingMatch) {
      out.push(autolinkHeading(headingMatch[1], headingMatch[2], sections, adrs));
      continue;
    }
    out.push(autolinkLine(line, sections, adrs));
  }
  return out.join("\n");
}

// Skip the first ref if it appears at the start of the title (it is the
// heading's own anchor source, e.g. '## D001: Foo'); link cross-refs elsewhere.
function autolinkHeading(prefix, title, sections, adrs) {
  const leading = title.match(/^(?:§\s?\d+(?:\.\d+)*|D\d{3}\b)/);
  if (leading) {
    const head = title.slice(0, leading[0].length);
    const tail = title.slice(leading[0].length);
    return prefix + head + autolinkLine(tail, sections, adrs);
  }
  return prefix + autolinkLine(title, sections, adrs);
}

const REF_RE = /§\s?\d+(?:\.\d+)*|\bD\d{3}\b/g;

function autolinkLine(line, sections, adrs) {
  // Build masks: 1 if char is inside inline-code OR markdown-link (text or url).
  const linkMask = buildLinkMask(line);
  const codeMask = buildInlineCodeMask(line);
  const mask = linkMask.map((v, idx) => v || codeMask[idx]);

  let result = "";
  let last = 0;
  for (const m of line.matchAll(REF_RE)) {
    const start = m.index;
    const end = start + m[0].length;
    let masked = false;
    for (let i = start; i < end; i += 1) {
      if (mask[i]) {
        masked = true;
        break;
      }
    }
    result += line.slice(last, start);
    last = end;
    if (masked) {
      result += m[0];
      continue;
    }
    const token = m[0];
    if (token.startsWith("§")) {
      const before = line.slice(Math.max(0, start - 12), start);
      if (/RFC\s+\d{3,5}\s+$/.test(before)) {
        result += token;
        continue;
      }
      const num = token.replace(/§\s?/, "");
      const slug = sections[num];
      if (slug) {
        result += `[§${num}](${RELATIVE_PREFIX}/atrib-spec.md#${slug})`;
      } else {
        result += token;
      }
    } else {
      const slug = adrs[token.toUpperCase()];
      if (slug) {
        result += `[${token}](${RELATIVE_PREFIX}/DECISIONS.md#${slug})`;
      } else {
        result += token;
      }
    }
  }
  result += line.slice(last);
  return result;
}

function buildLinkMask(line) {
  const mask = new Array(line.length).fill(0);
  let i = 0;
  while (i < line.length) {
    if (line[i] === "[") {
      let depth = 1;
      let j = i + 1;
      while (j < line.length && depth > 0) {
        if (line[j] === "[") depth += 1;
        else if (line[j] === "]") depth -= 1;
        if (depth === 0) break;
        j += 1;
      }
      if (depth !== 0 || line[j + 1] !== "(") {
        i += 1;
        continue;
      }
      let k = j + 2;
      let pdepth = 1;
      while (k < line.length && pdepth > 0) {
        if (line[k] === "(") pdepth += 1;
        else if (line[k] === ")") pdepth -= 1;
        if (pdepth === 0) break;
        k += 1;
      }
      if (pdepth !== 0) {
        i += 1;
        continue;
      }
      for (let m = i; m <= k; m += 1) mask[m] = 1;
      i = k + 1;
    } else {
      i += 1;
    }
  }
  return mask;
}

function buildInlineCodeMask(line) {
  const mask = new Array(line.length).fill(0);
  let i = 0;
  while (i < line.length) {
    if (line[i] === "`") {
      const close = line.indexOf("`", i + 1);
      if (close === -1) break;
      for (let m = i; m <= close; m += 1) mask[m] = 1;
      i = close + 1;
    } else {
      i += 1;
    }
  }
  return mask;
}

const wrapped = {
  getReleaseLine: async (changeset, type, options) => {
    const baseLine = await baseChangelog.default.getReleaseLine(
      changeset,
      type,
      options,
    );
    return autolink(baseLine);
  },
  getDependencyReleaseLine: async (changesets, dependenciesUpdated, options) => {
    const baseLine = await baseChangelog.default.getDependencyReleaseLine(
      changesets,
      dependenciesUpdated,
      options,
    );
    return autolink(baseLine);
  },
};

module.exports = wrapped;
module.exports.default = wrapped;

// Exports for unit tests + the one-time backfill script.
module.exports.autolink = autolink;
module.exports.loadAnchors = loadAnchors;
module.exports._test = { slugify, buildSectionAnchors, buildAdrAnchors };
