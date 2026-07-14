# A vector layer for recall: cost, design, and what it would mean

Research document, 2026-07-14. Not an ADR. Companion to
[traces-integration-research.md](traces-integration-research.md), which found
no semantic search anywhere in the repo and deferred the question. External
claims were gathered and checked on the date above; numbers marked
"directional" come from single secondary sources and were not independently
reproduced.

## 1. The question

The recall stack is deliberately lexical: BM25 over per-record sidecar
content, weighted by recency and importance, with provable coverage contracts
and a durable fingerprint-keyed index
([D085](../DECISIONS.md#d085-recall-calibration-defaults-survey-grounded-rationale),
[D086](../DECISIONS.md#d086-bm25-corpus-extended-from-annotations-to-per-event_type-record-content),
[D123](../DECISIONS.md#d123-critical-path-content-recall-requires-complete-evidence-or-explicit-fallback)-[D126](../DECISIONS.md#d126-content-recall-uses-a-durable-index-behind-complete-evidence-coverage)).
A "Layer 2" vector sidecar appears in code comments and in the consequences of
[D126](../DECISIONS.md#d126-content-recall-uses-a-durable-index-behind-complete-evidence-coverage)
as deferred future work. This document answers two questions: what would it
actually take to build, and what would it mean for atrib strategically.

## 2. What the evidence says (checked 2026-07-14)

**The corpus is small enough that exact search wins.** At the current dogfood
scale (~57k records) and its plausible growth (100-200k), brute-force exact
cosine over 768-dim vectors costs roughly 1.5-7.5 ms per query on one core.
Approximate-nearest-neighbor indexes start paying for themselves past several
hundred thousand vectors, mainly under concurrent server workloads. A local
single-process recall runtime does not need ANN at this scale, which removes
most of the machinery a "vector database" implies.

**sqlite-vec is usable but hazardous as a dependency.** The stable npm release
(0.1.9) is brute-force only; the DiskANN work is alpha. More to the point,
OpenClaw's production issue history documents the failure mode that matters
for atrib: extension load can succeed silently while registering zero
functions (SQLite ABI mismatch against newer better-sqlite3), `node:sqlite`
needs explicit `allowExtension` opt-in, and the same "vector recall degraded"
symptom recurred five times in six weeks with four different root causes and
swallowed errors. Silent degradation is compatible with atrib's
[§5.8](../atrib-spec.md#58-degradation-contract) contract; undiagnosable
degradation is not a posture to import. Since exact search at this scale needs
nothing more than a scan over `Float32Array`s, the lowest-risk storage design
uses no native extension at all.

**Local embedding is practical on the operator's hardware.** Current
sub-1B open models (Qwen3-Embedding-0.6B at 1024 dims, EmbeddingGemma 300M at
768, nomic-embed-text-v2 at 137M/768) run through Ollama's localhost
embeddings API, llama.cpp, or transformers.js (ONNX, pure Node). Directional
throughput figures on Apple Silicon run from thousands to tens of thousands of
passages per second for the small models, so a full-corpus backfill is minutes
of local compute. Local-first tools already ship this shape: claude-mem is
FTS5 with an optional Chroma layer, and codemem ships FTS5 plus sqlite-vec,
the exact two-layer combination under evaluation here.

**API embedding is cheap enough to be a non-decision on cost.** The indexed
text behind the current corpus is on the order of tens of megabytes; a full
backfill lands at roughly 12-13M tokens, which prices between $0.13 (OpenAI
text-embedding-3-small, batch) and about $2.60 (Gemini) one-time, and inside
Voyage's free allowance. The decision axis is locality and privacy, not money.

**Hybrid retrieval helps a real but bounded amount, exactly where BM25 cannot.**
On LongMemEval, the closest published benchmark to atrib's memory workload,
BM25 alone reaches 86.2% and adding dense vectors reaches 95.2%, the largest
single-component gain in that study; the improvement concentrates in
paraphrase and synonym gaps where the query shares no keywords with the target
memory. PersonaMem does not isolate the retrieval comparison. This supports
building the layer as optional augmentation, not as a replacement for the
lexical index.

**Embedding versions do not compose.** Vectors from two versions of a model,
even under an unchanged model name, are not comparable; mixing them in one
index silently corrupts retrieval. The standard mitigation is to pin the exact
model identity next to every stored vector and rebuild or dual-write on model
change. This is the same discipline atrib already applies to signing-key
identity, and the index fingerprint pattern from
[D126](../DECISIONS.md#d126-content-recall-uses-a-durable-index-behind-complete-evidence-coverage)
extends to it directly.

## 3. What it would take

A concrete design that fits the existing contracts, in rough build order.

**V1: embedding provider abstraction.** One interface, local-first resolution:
a configured OpenAI-compatible embeddings endpoint (Ollama on localhost by
default) or an in-process transformers.js model, else the layer reports itself
disabled. Precedent exists: `atrib-summarize` already sends sidecar content to
a configured LLM endpoint, so a configured embedding endpoint is the same
trust posture, and an off-machine API stays a deliberate opt-in rather than a
default.

**V2: a vector sidecar next to the content index.** A second cache file under
`~/.atrib/cache/`, keyed by the same mirror fingerprint as `content-index-v1`
plus the embedding model identity (name, version, dims, quantization). One
vector per record, embedded from the same `extractIndexableText` output that
feeds BM25, so both layers index the same view of a record. Storage is a flat
binary or JSON structure scanned brute-force; no SQLite, no native extension.
Stale detection reuses the
[D126](../DECISIONS.md#d126-content-recall-uses-a-durable-index-behind-complete-evidence-coverage)
rule: fingerprint mismatch or model-identity mismatch means rebuild, never
silent reuse.

**V3: fusion in scoring, not a second tool.** Content recall (`recall` shape `content`; legacy `recall_by_content` per [D164](../DECISIONS.md#d164-attestrecall-verb-rename-and-primitive-surface-collapse)) gains an
optional dense channel: reciprocal-rank fusion (the tuning-free standard)
combines the BM25 ranking and the cosine ranking into the relevance component,
which then flows through the existing Park weighted-sum with recency and
importance unchanged. The
[D085](../DECISIONS.md#d085-recall-calibration-defaults-survey-grounded-rationale)
calibration survives; only the relevance input widens.

**V4: coverage honesty.** The response's `coverage` block gains a `vector`
section: model identity, index status (`hit`, `rebuilt`, `disabled`,
`load_failed:<class>`), and per-result retrieval provenance saying which
channel surfaced each hit (lexical, dense, or both). The named failure classes
are the direct lesson from the OpenClaw issue history: degrade silently on the
call path, but say precisely why in the diagnostics. Completeness claims stay
lexical: `require_complete` continues to mean a full scan of the mirror by the
deterministic index, and a missing or stale vector sidecar can never fail a
complete-evidence claim, only annotate it.

**V5: the eval gate.** The in-repo memory-substrate harness
([D149](../DECISIONS.md#d149-cross-attestation-composes-with-a-trust-set-for-sybil-resistance)-[D162](../DECISIONS.md#d162-factual-values-never-truncate-in-rendered-memory))
already runs LongMemEval-style corpora with pre-registered predictions, and
its history shows why that bar exists: the
[D153](../DECISIONS.md#d153-chain-expansion-competes-through-a-reserved-budget-share)
expansion lift mostly evaporated under a stricter matcher, and the
[D162](../DECISIONS.md#d162-factual-values-never-truncate-in-rendered-memory)
format legend converted nothing it was predicted to convert. The vector layer
ships only if a pre-registered run shows lift on the paraphrase-gap cases
without regressing the update-chain and rendering behaviors
[D151](../DECISIONS.md#d151-own-signed-content-wins-over-chain-derived-text-in-rendering)
through
[D162](../DECISIONS.md#d162-factual-values-never-truncate-in-rendered-memory)
pinned.

Build effort is modest: the provider abstraction, one cache format, one fusion
function, and tests. The eval work is the real cost, and it is the part that
should not be skipped, because the external +9pp number was measured on
conversational memory, not on atrib's record shapes.

## 4. What it would mean strategically

**It upgrades a cognitive primitive; it does not cross the product boundary.**
Scoped to the signed-record corpus, a vector layer makes the `recall` verb (the `@atrib/recall` read home) better
at its existing job: finding what the agent signed when the query shares no
vocabulary with it. That stays inside
[D108](../DECISIONS.md#d108-observability-span-trees-are-intake-local-sidecars-are-cognitive-payload)'s
composition posture. The boundary to watch is the corpus, not the technique:
vectors over the agent's own signed memory are a substrate feature; vectors
over raw harness transcripts are claude-mem's lane and would ride in only
through the transcript-corpus decision deferred in
[traces-integration-research.md](traces-integration-research.md) (O4).

**It introduces atrib's first model-dependent retrieval, so the index must
stay a cache and never become evidence.** Everything in recall today is
replayable: same mirror, same index version, same query, same ranking. An
embedding model breaks that property; retrieval quality becomes a function of
a binary artifact no verifier re-derives. The invariant worth pinning in the
eventual ADR: vector state lives only in the deletable advisory cache tier,
never in signed records, never in verifier inputs, never in coverage
completeness claims, and every response discloses when dense retrieval
participated. That keeps the trust story exactly where it is (the coverage
contract stays deterministic and lexical) while the suggestion quality
improves.

**Dependency posture matters more than capability here.** The capability is
commodity: models are small, costs are trivial, and the scan is a for-loop.
The strategic risk is importing a native-extension failure surface into the
one component every session touches. The zero-native-dependency design (flat
sidecar, brute-force scan, out-of-process embedding runtime) keeps recall's
blast radius unchanged and leaves sqlite-vec or LanceDB as a swap-in if the
corpus ever grows past what a scan tolerates.

**Privacy stays a configuration, not an accident.** Local models keep sidecar
content on-machine, preserving the local-mirror posture by default. Routing
embeddings through a hosted API moves record content off-machine and should
sit behind the same explicit configuration choice the summarize primitive
already requires, documented in the same terms.

**The demand signal is real and already served elsewhere.** The operator's own
machine runs a 1.4 GB vector store today (claude-mem, over Claude Code
transcripts). The question is not whether semantic retrieval is useful; it is
whether the signed substrate specifically gains enough from it. The honest
external answer is "meaningfully, at the paraphrase margins, if the eval
reproduces it." That makes this a P-entry with a measurement plan, not an
urgent build.

## 5. Recommendation

Hold the current deferral, but replace the vague "Layer 2" comment with a
concrete pending decision carrying this design: local-first embedding provider,
fingerprint-plus-model-keyed flat vector sidecar, RRF into the existing
relevance component, lexical-only completeness claims, retrieval provenance in
coverage, and a pre-registered memory-substrate eval as the acceptance gate.
Build it when either (a) a recall-miss postmortem shows paraphrase-gap misses
on real dogfood queries, or (b) the transcript-corpus decision (O4) is taken
up, since a transcript corpus would raise the paraphrase-gap rate and the two
efforts share the provider and sidecar work.

## 6. Sources

- https://github.com/asg017/sqlite-vec/releases
- https://alexgarcia.xyz/sqlite-vec/js.html
- https://github.com/openclaw/openclaw/issues/65704 (plus issues 65033, 86799: sqlite-vec load-failure classes in production)
- https://turso.tech/vector, https://duckdb.org/docs/lts/core_extensions/vss, https://www.npmjs.com/package/@lancedb/lancedb
- https://huggingface.co/blog/embeddinggemma, https://huggingface.co/google/embeddinggemma-300m
- https://www.morphllm.com/ollama-embedding-models (directional throughput)
- https://contracollective.com/blog/local-embeddings-apple-silicon-nomic-bge-qwen3-m5-max-2026 (directional throughput, single source)
- https://huggingface.co/blog/transformersjs-v4
- https://docs.voyageai.com/docs/pricing, https://embeddingcost.com/voyage, https://tokenmix.ai/blog/openai-embedding-pricing
- https://www.getfeather.store/theory/longmemeval-benchmark-explained, https://github.com/rohitg00/agentmemory/blob/main/benchmark/LONGMEMEVAL.md
- https://glaforge.dev/posts/2026/02/10/advanced-rag-understanding-reciprocal-rank-fusion-in-hybrid-search/
- https://aboutvectordatabase.com/learn/handling-updates-to-embedding-model-version-drift/
- https://docs.claude-mem.ai/architecture/overview, https://github.com/kunickiaj/codemem
