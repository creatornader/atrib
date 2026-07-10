// SPDX-License-Identifier: Apache-2.0

/**
 * Memory substrate over atrib records: sign extracted memory items (facts,
 * preferences, revisions) as real chained atrib records, and retrieve them with
 * the shipped recall semantics: BM25 over content (D086) plus revision-chain
 * expansion (trace / recall_revisions). Generic on purpose: items come from any
 * extractor over any conversation; this module neither reads benchmarks nor
 * knows about them.
 *
 * The design mirrors how an agent actually uses atrib as memory:
 *   - a stated preference/fact  -> observation record, content {statement, reason?, topic}
 *   - a preference change       -> revision record, content {prior_position, new_position,
 *                                  reason}, `revises` -> the superseded record's hash
 * Retrieval surfaces the full revision chain for any hit, so the REASON a
 * position changed arrives with the latest position: exactly the property a
 * flat/semantic store does not give you structurally.
 *
 * Stage mapping:
 *   - selectMemory maps to atrib-recall (look-up): text-ranked seed selection.
 *   - expandMemory maps to atrib-trace (lineage): hash-and-edge traversal from seeds.
 *   - retrieveMemoryDetailed composes recall then trace for callers that need one context block.
 *
 * Lexical and structural relevance do not share a principled exchange rate.
 * The composed path states its arbitration as a reserve: expansionShare is two
 * budgets expressed as one fraction.
 */

import {
  sha256,
  hexEncode,
  canonicalRecord,
  genesisChainRoot,
  getPublicKey,
  base64urlEncode,
  signRecord,
  EVENT_TYPE_OBSERVATION_URI,
  EVENT_TYPE_REVISION_URI,
  type AtribRecord,
} from '@atrib/mcp'

export interface MemoryItem {
  type: 'fact' | 'preference' | 'revision'
  statement?: string
  prior?: string
  new?: string
  reason?: string
  topic?: string
  msg_start?: number
  msg_end?: number
}

export interface SignedMemory {
  record: AtribRecord
  hash: string
  content: Record<string, unknown>
  msg_end: number
  /** hash of the record this one revises (revision records only) */
  revises?: string
}

const SEED = new Uint8Array(32).fill(0x2a)

function recordHashHex(r: AtribRecord): string {
  return hexEncode(sha256(canonicalRecord(r)))
}

const tokens = (s: string): string[] => (s ?? '').toLowerCase().match(/[a-z0-9']+/g) ?? []
const STOPWORDS = new Set(['a','an','the','and','or','but','with','without','of','in','on','at','to','for','from','by','as','is','are','was','were','be','been','being','do','does','did','has','have','had','will','would','can','could','should','may','might','not','no','that','this','these','those','it','its','they','them','their','he','she','his','her','i','my','me','we','our','us','you','your','so','too','very','just','than','then','there','here','when','while','about'])
const contentTokens = (s: string): string[] => tokens(s).filter((t) => t.length >= 3 && !STOPWORDS.has(t))

/** Token-overlap similarity for matching a revision's `prior` text to an earlier record. */
function overlap(a: string, b: string): number {
  const ta = new Set(contentTokens(a))
  const tb = new Set(contentTokens(b))
  if (!ta.size || !tb.size) return 0
  let n = 0
  for (const t of ta) if (tb.has(t)) n++
  return n / Math.min(ta.size, tb.size)
}

/**
 * Sign memory items in order as a chained atrib record set. Revisions link to
 * the best-matching earlier record (content-token overlap >= 0.5, same-topic
 * bonus, different-topic candidates skipped); when no prior matches, the change
 * is signed as an observation that still carries prior/new/reason content
 * (nothing is dropped).
 */
export async function signMemoryItems(items: MemoryItem[], contextLabel: string): Promise<SignedMemory[]> {
  const contextId = hexEncode(sha256(new TextEncoder().encode(contextLabel))).slice(0, 32)
  const creatorKey = base64urlEncode(await getPublicKey(SEED))
  const out: SignedMemory[] = []
  let prevHash: string | null = null
  let ts = 1_783_000_000_000

  for (const it of items) {
    let revisesHash: string | undefined
    let content: Record<string, unknown>
    let eventType: string = EVENT_TYPE_OBSERVATION_URI

    if (it.type === 'revision') {
      // find the superseded record among earlier ones
      let best: { h: string; score: number } | null = null
      for (const prev of out) {
        const prevText = String(prev.content.statement ?? prev.content.new_position ?? '')
        if (prev.content.topic && it.topic && prev.content.topic !== it.topic) continue
        const topicBonus = prev.content.topic && it.topic && prev.content.topic === it.topic ? 0.15 : 0
        const score = overlap(it.prior ?? '', prevText) + topicBonus
        if (score >= 0.5 && (!best || score > best.score)) best = { h: prev.hash, score }
      }
      content = {
        prior_position: it.prior ?? '',
        new_position: it.new ?? '',
        reason: it.reason ?? '',
        ...(it.topic ? { topic: it.topic } : {}),
      }
      if (best) {
        eventType = EVENT_TYPE_REVISION_URI
        revisesHash = best.h
      }
    } else {
      content = {
        statement: it.statement ?? '',
        ...(it.reason ? { reason: it.reason } : {}),
        ...(it.topic ? { topic: it.topic } : {}),
      }
    }

    const base: AtribRecord = {
      spec_version: 'atrib/1.0',
      content_id: 'sha256:' + hexEncode(sha256(new TextEncoder().encode(JSON.stringify(content) + ts))),
      creator_key: creatorKey,
      chain_root: prevHash ? 'sha256:' + prevHash : genesisChainRoot(contextId),
      event_type: eventType,
      context_id: contextId,
      timestamp: ts++,
      signature: '',
      ...(revisesHash ? { revises: 'sha256:' + revisesHash } : {}),
    } as AtribRecord
    const signed = await signRecord(base, SEED)
    const h = recordHashHex(signed)
    out.push({ record: signed, hash: h, content, msg_end: it.msg_end ?? 0, ...(revisesHash ? { revises: revisesHash } : {}) })
    prevHash = h
  }
  return out
}

// ---------------------------------------------------------------------------
// Retrieval: BM25 (D086 semantics) + revision-chain expansion (trace semantics)
// ---------------------------------------------------------------------------

function contentText(m: SignedMemory): string {
  const c = m.content
  return [c.statement, c.prior_position, c.new_position, c.reason, c.topic].filter(Boolean).join(' ')
}

function bm25Rank(corpus: string[], query: string): number[] {
  const docs = corpus.map(tokens)
  const N = docs.length
  const avgdl = docs.reduce((a, d) => a + d.length, 0) / Math.max(1, N)
  const df = new Map<string, number>()
  for (const d of docs) for (const t of new Set(d)) df.set(t, (df.get(t) ?? 0) + 1)
  const k1 = 1.5, b = 0.75
  const q = tokens(query)
  return docs.map((d) => {
    const tf = new Map<string, number>()
    for (const t of d) tf.set(t, (tf.get(t) ?? 0) + 1)
    let s = 0
    for (const t of new Set(q)) {
      const f = tf.get(t) ?? 0
      if (!f) continue
      const idf = Math.log(1 + (N - (df.get(t) ?? 0) + 0.5) / ((df.get(t) ?? 0) + 0.5))
      s += idf * (f * (k1 + 1)) / (f + k1 * (1 - b + b * d.length / avgdl))
    }
    return s
  })
}

export interface RetrieveOptions {
  /** approx token budget for the rendered memory block (chars/4 heuristic) */
  budgetTokens?: number
  /** include revision-chain expansion (the atrib-distinctive step). Default true. */
  expandChains?: boolean
  /** fraction of the budget reserved for chain-expansion members before seeds consume it all; 0 disables the reserve (headroom-only expansion); default 0.25. */
  expansionShare?: number
  /** maximum revision-chain hops walked in each direction from a hit during expansion; default 3. */
  chainDepth?: number
  /** only records with msg_end < windowEnd are visible (question-time windowing) */
  windowEnd?: number
  /**
   * Compact rendering: one line per record with reasons truncated, mirroring
   * atrib-recall's compact mode (sidecar_summary one-liners). Default true
   * (compact). Verbose verbatim reasons are the opt-in via compact: false.
   * Verbose rendering fits ~6 entries in a 2k-token budget vs ~40+ compact
   * lines; coverage usually beats verbatim depth.
   */
  compact?: boolean
  /**
   * Note-form rendering: render each record as a natural-language memory note
   * (no [REVISED]/field markup), clipped like compact. The signed layer is
   * representation-independent; this adopts the note representation while
   * keeping records, chains, and chain-expansion retrieval intact.
   */
  noteForm?: boolean
}

export interface RetrieveStats {
  seeds: number
  backfilled_seeds: number
  chain_members_considered: number
  chain_members_admitted: number
  chains_compacted?: number
  echo_skipped: number
  budget_chars: number
  rendered_chars: number
  expansion_engaged: boolean
}

export interface SelectedSeed {
  record: SignedMemory
  score: number
}

export interface SelectResult {
  seeds: SelectedSeed[]
  text: string
  rendered_chars: number
}

export interface ExpandedMember {
  record: SignedMemory
  from: string
}

export interface ExpandResult {
  members: ExpandedMember[]
  text: string
  considered: number
  echo_skipped: number
}

const clip = (s: unknown, n: number): string => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim()
  return t.length <= n ? t : t.slice(0, n) + '…'
}

function formatContentDate(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed || undefined
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(value).toISOString()
  }
  return undefined
}

function temporalProvenanceSuffix(m: SignedMemory): string {
  const contentDate = formatContentDate(m.content.date)
  if (contentDate) return ` (as of ${contentDate})`
  return Number.isFinite(m.msg_end) && m.msg_end > 0 ? ` (as of msg ${m.msg_end})` : ''
}

function appendTemporalProvenance(line: string, m: SignedMemory): string {
  return line + temporalProvenanceSuffix(m)
}

/** Render one record as a memory line; own signed content renders, while `revises` drives expansion and chain composition. */
function renderLineCore(m: SignedMemory, compact = false, noteForm = false): string {
  const c = m.content
  const isRevision = m.record.event_type === EVENT_TYPE_REVISION_URI || c.prior_position !== undefined
  if (noteForm) {
    // Natural-language note form: same information, no field markup.
    // Factual values (statements, positions) never truncate; only commentary
    // (reasons) may clip. A clipped value can amputate the fact itself.
    if (isRevision) {
      const priorText = String(c.prior_position ?? '')
      return `- User previously ${priorText}, but now ${String(c.new_position ?? '')} because ${clip(c.reason, 140)}`
    }
    return `- ${String(c.statement ?? '')}${c.reason ? ` because ${clip(c.reason, 90)}` : ''}`
  }
  if (isRevision) {
    const priorText = String(c.prior_position ?? '')
    if (compact)
      return `- [REVISED] was: "${priorText}" -> now: "${String(c.new_position ?? '')}" BECAUSE: "${clip(c.reason, 140)}"${c.topic ? ` (${c.topic})` : ''}`
    return `- [REVISED] was: "${priorText}" -> now: "${c.new_position}" BECAUSE: "${c.reason}"${c.topic ? ` (${c.topic})` : ''}`
  }
  if (compact) return `- ${String(c.statement ?? '')}${c.reason ? ` (reason: ${clip(c.reason, 90)})` : ''}${c.topic ? ` [${c.topic}]` : ''}`
  return `- ${c.statement}${c.reason ? ` (reason: ${c.reason})` : ''}${c.topic ? ` [${c.topic}]` : ''}`
}

function renderLine(m: SignedMemory, compact = false, noteForm = false): string {
  return appendTemporalProvenance(renderLineCore(m, compact, noteForm), m)
}


function chainTopic(records: SignedMemory[]): string {
  for (const record of records) {
    const topic = record.content.topic
    if (topic !== undefined && String(topic).trim()) return String(topic)
  }
  return 'untopiced'
}

function shortForm(record: SignedMemory): string {
  return clip(record.content.new_position ?? record.content.what ?? record.record.content_id, 48)
}

function chainPathLine(label: 'earlier' | 'later', records: SignedMemory[]): string | undefined {
  if (!records.length) return undefined
  const prefix = `  ${label} (${records.length} ${records.length === 1 ? 'step' : 'steps'}): `
  const forms = records.map(shortForm)
  const full = prefix + forms.join(' -> ')
  if (full.length <= 240) return full

  if (forms.length < 2) return undefined
  const compact = `${prefix}${forms[0]} -> ... -> ${forms[forms.length - 1]}`
  return compact.length <= 240 ? compact : undefined
}

function orderRevisionLineage(seed: SignedMemory, members: SignedMemory[]): { ordered: SignedMemory[]; rest: SignedMemory[] } {
  const local = new Map<string, SignedMemory>([[seed.hash, seed]])
  for (const member of members) local.set(member.hash, member)

  const orderedMembers = new Set<string>()
  const backward: SignedMemory[] = []
  let cursor: SignedMemory | undefined = seed
  while (cursor?.revises) {
    const next = local.get(cursor.revises)
    if (!next || orderedMembers.has(next.hash) || next.hash === seed.hash) break
    orderedMembers.add(next.hash)
    backward.push(next)
    cursor = next
  }

  const memberOrder = new Map(members.map((member, index) => [member.hash, index]))
  const forward: SignedMemory[] = []
  let frontier = [seed]
  const seenForward = new Set<string>([seed.hash, ...orderedMembers])
  while (frontier.length) {
    const nextFrontier: SignedMemory[] = []
    for (const current of frontier) {
      const nextMembers = members
        .filter((member) => member.revises === current.hash && !seenForward.has(member.hash))
        .sort((a, b) => (memberOrder.get(a.hash) ?? 0) - (memberOrder.get(b.hash) ?? 0))
      for (const next of nextMembers) {
        seenForward.add(next.hash)
        orderedMembers.add(next.hash)
        forward.push(next)
        nextFrontier.push(next)
      }
    }
    frontier = nextFrontier
  }

  const ordered = [...backward.reverse(), seed, ...forward]
  const rest = members.filter((member) => !orderedMembers.has(member.hash))
  return { ordered, rest }
}

/**
 * D143 composition: signed revision edges must render as lineage. A disconnected
 * reverse-order list discards the edge information that the graph certifies.
 */
function composeSeedWithLineage(
  seed: SignedMemory,
  members: SignedMemory[],
  compact: boolean,
  noteForm: boolean,
  opts: {
    droppedMembers?: SignedMemory[]
    admitCompactLine?: (line: string) => boolean
  } = {},
): { lines: string[]; chainsCompacted: number } {
  if (!members.length) return { lines: [renderLine(seed, compact, noteForm)], chainsCompacted: 0 }

  const { ordered, rest } = orderRevisionLineage(seed, members)
  const hasLineageMembers = ordered.some((record) => record.hash !== seed.hash)
  if (!hasLineageMembers) {
    return { lines: [seed, ...members].map((record) => renderLine(record, compact, noteForm)), chainsCompacted: 0 }
  }

  const droppedMembers = opts.droppedMembers ?? []
  const droppedHashes = new Set(droppedMembers.map((record) => record.hash))
  const droppedOrdered = droppedHashes.size > 0 ? orderRevisionLineage(seed, [...members, ...droppedMembers]).ordered : []
  const droppedSeedIndex = droppedOrdered.findIndex((record) => record.hash === seed.hash)
  const earlierDropped = droppedSeedIndex >= 0
    ? droppedOrdered.slice(0, droppedSeedIndex).filter((record) => droppedHashes.has(record.hash))
    : []
  const laterDropped = droppedSeedIndex >= 0
    ? droppedOrdered.slice(droppedSeedIndex + 1).filter((record) => droppedHashes.has(record.hash))
    : []

  const n = ordered.length
  const lines = [`- [chain: ${chainTopic(ordered)}, ${n} steps]`]
  let chainsCompacted = 0

  const earlierLine = chainPathLine('earlier', earlierDropped)
  if (earlierLine && (opts.admitCompactLine?.(earlierLine) ?? true)) {
    lines.push(earlierLine)
    chainsCompacted = 1
  }

  lines.push(...ordered.map((record, index) => `  step ${index + 1}/${n}: ${renderLine(record, compact, noteForm)}`))

  const laterLine = chainPathLine('later', laterDropped)
  if (laterLine && (opts.admitCompactLine?.(laterLine) ?? true)) {
    lines.push(laterLine)
    chainsCompacted = 1
  }

  return { lines: [...lines, ...rest.map((record) => renderLine(record, compact, noteForm))], chainsCompacted }
}

function revisionChainMembers(
  seed: SignedMemory,
  byHash: Map<string, SignedMemory>,
  revisedBy: Map<string, SignedMemory[]>,
  depth: number,
): SignedMemory[] {
  if (depth <= 0) return []
  const members: SignedMemory[] = []
  const seen = new Set<string>([seed.hash])

  let backward: SignedMemory = seed
  for (let hop = 0; hop < depth; hop++) {
    const next: SignedMemory | undefined = backward.revises ? byHash.get(backward.revises) : undefined
    if (!next || seen.has(next.hash)) break
    seen.add(next.hash)
    members.push(next)
    backward = next
  }

  let frontier = [seed]
  for (let hop = 0; hop < depth; hop++) {
    const nextFrontier: SignedMemory[] = []
    for (const current of frontier) {
      for (const next of revisedBy.get(current.hash) ?? []) {
        if (seen.has(next.hash)) continue
        seen.add(next.hash)
        members.push(next)
        nextFrontier.push(next)
      }
    }
    if (!nextFrontier.length) break
    frontier = nextFrontier
  }

  return members
}

function admissionPriorityRevisionMembers(seed: SignedMemory, members: SignedMemory[]): SignedMemory[] {
  let cursor = seed
  let tail: SignedMemory | undefined

  while (true) {
    const next = members.find((member) => member.revises === cursor.hash)
    if (!next) break
    tail = next
    cursor = next
  }

  if (!tail) return members
  return [tail, ...members.filter((member) => member.hash !== tail.hash)]
}

interface NormalizedRetrieveOptions {
  budget: number
  compact: boolean
  noteForm: boolean
  chainDepth: number
}

type MutableSelectedSeed = SelectedSeed
type Choice = { seed: SignedMemory; score: number; members: SignedMemory[]; droppedMembers: SignedMemory[] }

interface RankedRecords {
  visible: SignedMemory[]
  scores: number[]
  order: number[]
}

interface RevisionIndex {
  byHash: Map<string, SignedMemory>
  revisedBy: Map<string, SignedMemory[]>
}

interface LineAdmission {
  renderedLength: number
  renderedLineCount: number
  lineLengthAfterAppend(line: string): number
  admitLine(line: string): void
}

function normalizeRetrieveOptions(opts: RetrieveOptions): NormalizedRetrieveOptions {
  return {
    budget: (opts.budgetTokens ?? 2000) * 4,
    compact: opts.compact ?? true,
    noteForm: opts.noteForm ?? false,
    chainDepth: Number.isFinite(opts.chainDepth) ? Math.max(0, Math.floor(opts.chainDepth!)) : 3,
  }
}

function visibleRecords(records: SignedMemory[], opts: RetrieveOptions): SignedMemory[] {
  return records.filter((m) => opts.windowEnd === undefined || m.msg_end < opts.windowEnd)
}

function rankVisibleRecords(visible: SignedMemory[], query: string): RankedRecords {
  const scores = bm25Rank(visible.map(contentText), query)
  const order = visible.map((_, i) => i).sort((a, b) => scores[b]! - scores[a]!)
  return { visible, scores, order }
}

function buildRevisionIndex(visible: SignedMemory[]): RevisionIndex {
  const byHash = new Map(visible.map((m) => [m.hash, m]))
  const revisedBy = new Map<string, SignedMemory[]>()
  for (const m of visible) {
    if (!m.revises) continue
    const next = revisedBy.get(m.revises) ?? []
    next.push(m)
    revisedBy.set(m.revises, next)
  }
  return { byHash, revisedBy }
}

function createLineAdmission(): LineAdmission {
  return {
    renderedLength: 0,
    renderedLineCount: 0,
    lineLengthAfterAppend(line: string): number {
      return this.renderedLength + line.length + (this.renderedLineCount > 0 ? 1 : 0)
    },
    admitLine(line: string): void {
      this.renderedLength = this.lineLengthAfterAppend(line)
      this.renderedLineCount++
    },
  }
}

function renderSelectedText(seeds: SelectedSeed[], compact: boolean, noteForm: boolean): string {
  return seeds.map(({ record }) => renderLine(record, compact, noteForm)).join('\n')
}

function forceAddSeed<T extends MutableSelectedSeed | Choice>(
  target: T[],
  seed: SignedMemory,
  score: number,
  admitted: Set<string>,
  admission: LineAdmission,
  compact: boolean,
  noteForm: boolean,
  makeEntry: (seed: SignedMemory, score: number) => T,
): void {
  admitted.add(seed.hash)
  target.push(makeEntry(seed, score))
  admission.admitLine(renderLineCore(seed, compact, noteForm))
}

function tryAddSeed<T extends MutableSelectedSeed | Choice>(
  target: T[],
  seed: SignedMemory,
  score: number,
  targetBudget: number,
  admitted: Set<string>,
  admission: LineAdmission,
  compact: boolean,
  noteForm: boolean,
  makeEntry: (seed: SignedMemory, score: number) => T,
): boolean {
  const line = renderLineCore(seed, compact, noteForm)
  if (admission.lineLengthAfterAppend(line) > targetBudget) return false
  admitted.add(seed.hash)
  target.push(makeEntry(seed, score))
  admission.admitLine(line)
  return true
}

function admitRankedSeeds<T extends MutableSelectedSeed | Choice>(
  ranked: RankedRecords,
  startIndex: number,
  target: T[],
  targetBudget: number,
  stopOnOverflow: boolean,
  fallbackWhenEmpty: boolean,
  fallbackTarget: T[],
  admitted: Set<string>,
  admission: LineAdmission,
  compact: boolean,
  noteForm: boolean,
  makeEntry: (seed: SignedMemory, score: number) => T,
): number {
  for (let orderIndex = startIndex; orderIndex < ranked.order.length; orderIndex++) {
    const i = ranked.order[orderIndex]!
    const score = ranked.scores[i]!
    const seed = ranked.visible[i]!
    if (score <= 0) {
      if (fallbackWhenEmpty && !fallbackTarget.length) {
        forceAddSeed(target, seed, score, admitted, admission, compact, noteForm, makeEntry)
      }
      return orderIndex + 1
    }
    if (admitted.has(seed.hash)) continue
    if (!tryAddSeed(target, seed, score, targetBudget, admitted, admission, compact, noteForm, makeEntry) && stopOnOverflow) {
      return orderIndex
    }
  }
  return ranked.order.length
}

function isEchoSubset(seed: SignedMemory, member: SignedMemory, compact: boolean, noteForm: boolean): boolean {
  const seedTokens = new Set(contentTokens(renderLineCore(seed, compact, noteForm)))
  const memberTokens = new Set(contentTokens(renderLineCore(member, compact, noteForm)))
  for (const token of memberTokens) {
    if (!seedTokens.has(token)) return false
  }
  return true
}

interface ExpandSeed {
  record: SignedMemory
  score?: number
  onAdmit?: (member: SignedMemory) => void
  onDrop?: (member: SignedMemory) => void
}

interface SharedExpandResult {
  members: ExpandedMember[]
  dropped: ExpandedMember[]
  considered: number
  admitted: number
  echoSkipped: number
}

function expandSeedMembers(
  seeds: ExpandSeed[],
  index: RevisionIndex,
  opts: NormalizedRetrieveOptions,
  admitted: Set<string>,
  admission: LineAdmission,
  skipNonPositiveScores: boolean,
): SharedExpandResult {
  const members: ExpandedMember[] = []
  const dropped: ExpandedMember[] = []
  let considered = 0
  let admittedCount = 0
  let echoSkipped = 0

  for (const seed of seeds) {
    if (skipNonPositiveScores && (seed.score ?? 0) <= 0) continue
    const walkedMembers = revisionChainMembers(seed.record, index.byHash, index.revisedBy, opts.chainDepth)
    for (const member of admissionPriorityRevisionMembers(seed.record, walkedMembers)) {
      considered++
      if (admitted.has(member.hash)) continue
      if (isEchoSubset(seed.record, member, opts.compact, opts.noteForm)) {
        echoSkipped++
        continue
      }

      const line = renderLineCore(member, opts.compact, opts.noteForm)
      if (admission.lineLengthAfterAppend(line) > opts.budget) {
        seed.onDrop?.(member)
        dropped.push({ record: member, from: seed.record.hash })
        continue
      }
      seed.onAdmit?.(member)
      admission.admitLine(line)
      admitted.add(member.hash)
      members.push({ record: member, from: seed.record.hash })
      admittedCount++
    }
  }

  return { members, dropped, considered, admitted: admittedCount, echoSkipped }
}

/**
 * Retrieve memory for a query. BM25 ranks all visible records; for each hit the
 * full revision chain (superseded record + revising record) is pulled in, so a
 * hit on either end of a change surfaces the change AND its reason.
 */
export function retrieveMemory(records: SignedMemory[], query: string, opts: RetrieveOptions = {}): string {
  return retrieveMemoryDetailed(records, query, opts).text
}

export function selectMemory(records: SignedMemory[], query: string, opts: RetrieveOptions = {}): SelectResult {
  const normalized = normalizeRetrieveOptions(opts)
  const visible = visibleRecords(records, opts)
  if (!visible.length) {
    const text = '(no memory)'
    return { seeds: [], text, rendered_chars: text.length }
  }

  const ranked = rankVisibleRecords(visible, query)
  const seeds: MutableSelectedSeed[] = []
  const admitted = new Set<string>()
  const admission = createLineAdmission()
  admitRankedSeeds(
    ranked,
    0,
    seeds,
    normalized.budget,
    false,
    true,
    seeds,
    admitted,
    admission,
    normalized.compact,
    normalized.noteForm,
    (record, score) => ({ record, score }),
  )
  if (!seeds.length && ranked.order.length) {
    forceAddSeed(
      seeds,
      visible[ranked.order[0]!]!,
      ranked.scores[ranked.order[0]!]!,
      admitted,
      admission,
      normalized.compact,
      normalized.noteForm,
      (record, score) => ({ record, score }),
    )
  }

  const text = renderSelectedText(seeds, normalized.compact, normalized.noteForm)
  return { seeds, text, rendered_chars: text.length }
}

export function expandMemory(records: SignedMemory[], seeds: SignedMemory[], opts: RetrieveOptions = {}): ExpandResult {
  const normalized = normalizeRetrieveOptions(opts)
  const visible = visibleRecords(records, opts)
  if (!visible.length || !seeds.length) return { members: [], text: '', considered: 0, echo_skipped: 0 }

  const index = buildRevisionIndex(visible)
  const admitted = new Set(seeds.map((seed) => seed.hash))
  const admission = createLineAdmission()
  const expanded = expandSeedMembers(
    seeds.map((record) => ({ record })),
    index,
    normalized,
    admitted,
    admission,
    false,
  )
  const text = seeds.flatMap((seed) => {
    const members = expanded.members.filter((member) => member.from === seed.hash).map((member) => member.record)
    const droppedMembers = expanded.dropped.filter((member) => member.from === seed.hash).map((member) => member.record)
    if (!members.length) return []
    const { ordered } = orderRevisionLineage(seed, members)
    const hasLineageMembers = ordered.some((record) => record.hash !== seed.hash)
    if (!hasLineageMembers) return members.map((member) => renderLine(member, normalized.compact, normalized.noteForm))
    return composeSeedWithLineage(seed, members, normalized.compact, normalized.noteForm, {
      droppedMembers,
      admitCompactLine: (line: string) => {
        if (admission.lineLengthAfterAppend(line) > normalized.budget) return false
        admission.admitLine(line)
        return true
      },
    }).lines
  }).join('\n')
  return { members: expanded.members, text, considered: expanded.considered, echo_skipped: expanded.echoSkipped }
}

export function retrieveMemoryDetailed(records: SignedMemory[], query: string, opts: RetrieveOptions = {}): { text: string; stats: RetrieveStats } {
  const normalized = normalizeRetrieveOptions(opts)
  const budget = normalized.budget
  const expand = opts.expandChains !== false
  const share = expand === false ? 0 : Math.min(0.9, Math.max(0, opts.expansionShare ?? 0.25))
  const visible = visibleRecords(records, opts)
  if (!visible.length) {
    const text = '(no memory)'
    return {
      text,
      stats: {
        seeds: 0,
        backfilled_seeds: 0,
        chain_members_considered: 0,
        chain_members_admitted: 0,
        chains_compacted: 0,
        echo_skipped: 0,
        budget_chars: budget,
        rendered_chars: text.length,
        expansion_engaged: false,
      },
    }
  }

  const ranked = rankVisibleRecords(visible, query)
  const choices: Choice[] = []
  const backfilled: Choice[] = []
  const admitted = new Set<string>()
  const admission = createLineAdmission()

  const seedBudget = (1 - share) * budget
  // When share > 0, A1 stops at first overflow so the reserve prefix stays contiguous.
  // share === 0 keeps trying smaller seeds to preserve pre-reserve behavior.
  const backfillStart = admitRankedSeeds(
    ranked,
    0,
    choices,
    seedBudget,
    share > 0,
    true,
    choices,
    admitted,
    admission,
    normalized.compact,
    normalized.noteForm,
    (seed, score) => ({ seed, score, members: [], droppedMembers: [] }),
  )

  if (!choices.length && ranked.order.length) {
    forceAddSeed(
      choices,
      visible[ranked.order[0]!]!,
      ranked.scores[ranked.order[0]!]!,
      admitted,
      admission,
      normalized.compact,
      normalized.noteForm,
      (seed, score) => ({ seed, score, members: [], droppedMembers: [] }),
    )
  }

  let chainMembersConsidered = 0
  let chainMembersAdmitted = 0
  let echoSkipped = 0
  if (expand) {
    const index = buildRevisionIndex(visible)
    const expanded = expandSeedMembers(
      choices.map((choice) => ({
        record: choice.seed,
        score: choice.score,
        onAdmit: (member: SignedMemory) => choice.members.push(member),
        onDrop: (member: SignedMemory) => choice.droppedMembers.push(member),
      })),
      index,
      normalized,
      admitted,
      admission,
      true,
    )
    chainMembersConsidered = expanded.considered
    chainMembersAdmitted = expanded.admitted
    echoSkipped = expanded.echoSkipped
  }

  // Backfilled seeds never expand; expansion only sees the A1 seed prefix.
  admitRankedSeeds(
    ranked,
    backfillStart,
    backfilled,
    budget,
    false,
    false,
    choices,
    admitted,
    admission,
    normalized.compact,
    normalized.noteForm,
    (seed, score) => ({ seed, score, members: [], droppedMembers: [] }),
  )

  let chainsCompacted = 0
  const choiceLines = choices.flatMap((choice) => {
    const rendered = composeSeedWithLineage(choice.seed, choice.members, normalized.compact, normalized.noteForm, {
      droppedMembers: choice.droppedMembers,
      admitCompactLine: (line: string) => {
        if (admission.lineLengthAfterAppend(line) > budget) return false
        admission.admitLine(line)
        return true
      },
    })
    chainsCompacted += rendered.chainsCompacted
    return rendered.lines
  })

  const text = [
    ...choiceLines,
    ...backfilled.map((choice) => renderLine(choice.seed, normalized.compact, normalized.noteForm)),
  ].join('\n')
  return {
    text,
    stats: {
      seeds: choices.length,
      backfilled_seeds: backfilled.length,
      chain_members_considered: chainMembersConsidered,
      chain_members_admitted: chainMembersAdmitted,
      chains_compacted: chainsCompacted,
      echo_skipped: echoSkipped,
      budget_chars: budget,
      rendered_chars: text.length,
      expansion_engaged: chainMembersAdmitted > 0,
    },
  }
}
