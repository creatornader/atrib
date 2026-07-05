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

const clip = (s: unknown, n: number): string => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim()
  return t.length <= n ? t : t.slice(0, n) + '…'
}

/** Render one record as a memory line; own signed content renders, while `revises` only drives chain expansion. */
function renderLine(m: SignedMemory, compact = false, noteForm = false): string {
  const c = m.content
  const isRevision = m.record.event_type === EVENT_TYPE_REVISION_URI || c.prior_position !== undefined
  if (noteForm) {
    // Natural-language note form: same information, no field markup.
    if (isRevision) {
      const priorText = String(c.prior_position ?? '')
      return `- User previously ${clip(priorText, 90)}, but now ${clip(c.new_position, 90)} because ${clip(c.reason, 140)}`
    }
    return `- ${clip(c.statement, 110)}${c.reason ? ` because ${clip(c.reason, 90)}` : ''}`
  }
  if (isRevision) {
    const priorText = String(c.prior_position ?? '')
    if (compact)
      return `- [REVISED] was: "${clip(priorText, 90)}" -> now: "${clip(c.new_position, 90)}" BECAUSE: "${clip(c.reason, 140)}"${c.topic ? ` (${c.topic})` : ''}`
    return `- [REVISED] was: "${priorText}" -> now: "${c.new_position}" BECAUSE: "${c.reason}"${c.topic ? ` (${c.topic})` : ''}`
  }
  if (compact) return `- ${clip(c.statement, 110)}${c.reason ? ` (reason: ${clip(c.reason, 90)})` : ''}${c.topic ? ` [${c.topic}]` : ''}`
  return `- ${c.statement}${c.reason ? ` (reason: ${c.reason})` : ''}${c.topic ? ` [${c.topic}]` : ''}`
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

  let backward: SignedMemory | undefined = seed
  for (let hop = 0; hop < depth; hop++) {
    const next = backward.revises ? byHash.get(backward.revises) : undefined
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

/**
 * Retrieve memory for a query. BM25 ranks all visible records; for each hit the
 * full revision chain (superseded record + revising record) is pulled in, so a
 * hit on either end of a change surfaces the change AND its reason.
 */
export function retrieveMemory(records: SignedMemory[], query: string, opts: RetrieveOptions = {}): string {
  const budget = (opts.budgetTokens ?? 2000) * 4 // chars
  const expand = opts.expandChains !== false
  const chainDepth = Number.isFinite(opts.chainDepth) ? Math.max(0, Math.floor(opts.chainDepth!)) : 3
  const compact = opts.compact ?? true
  const visible = records.filter((m) => opts.windowEnd === undefined || m.msg_end < opts.windowEnd)
  if (!visible.length) return '(no memory)'
  const byHash = new Map(visible.map((m) => [m.hash, m]))
  const revisedBy = new Map<string, SignedMemory[]>()
  for (const m of visible) {
    if (!m.revises) continue
    const next = revisedBy.get(m.revises) ?? []
    next.push(m)
    revisedBy.set(m.revises, next)
  }

  const scores = bm25Rank(visible.map(contentText), query)
  const order = visible.map((_, i) => i).sort((a, b) => scores[b]! - scores[a]!)

  type Choice = { seed: SignedMemory; score: number; members: SignedMemory[] }
  const choices: Choice[] = []
  const admitted = new Set<string>()
  const renderChoices = (): string =>
    choices.flatMap((choice) => [choice.seed, ...choice.members]).map((m) => renderLine(m, compact, opts.noteForm)).join('\n')
  const canAddSeed = (seed: SignedMemory): boolean => {
    choices.push({ seed, score: 0, members: [] })
    const fits = renderChoices().length <= budget
    choices.pop()
    return fits
  }
  const addSeed = (seed: SignedMemory, score: number): void => {
    admitted.add(seed.hash)
    choices.push({ seed, score, members: [] })
  }

  for (const i of order) {
    const score = scores[i]!
    const seed = visible[i]!
    if (score <= 0) {
      if (!choices.length) addSeed(seed, score)
      break
    }
    if (!admitted.has(seed.hash) && canAddSeed(seed)) addSeed(seed, score)
  }

  if (!choices.length && order.length) addSeed(visible[order[0]!]!, scores[order[0]!]!)

  if (expand) {
    for (const choice of choices) {
      if (choice.score <= 0) continue
      const seedTokens = new Set(contentTokens(renderLine(choice.seed, compact, opts.noteForm)))
      for (const member of revisionChainMembers(choice.seed, byHash, revisedBy, chainDepth)) {
        if (admitted.has(member.hash)) continue
        const memberTokens = new Set(contentTokens(renderLine(member, compact, opts.noteForm)))
        let isEchoSubset = true
        for (const token of memberTokens) {
          if (!seedTokens.has(token)) {
            isEchoSubset = false
            break
          }
        }
        if (isEchoSubset) continue

        choice.members.push(member)
        if (renderChoices().length <= budget) {
          admitted.add(member.hash)
        } else {
          choice.members.pop()
        }
      }
    }
  }

  return renderChoices()
}
