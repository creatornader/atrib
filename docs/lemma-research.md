# Lemma: semantic failure monitoring and the evidence boundary

Research document, 2026-08-14. Not an ADR. This is a primary-source analysis
of Lemma's August 13 launch, public tracing contract, and failure taxonomy. It
compares Lemma with [DeepSeek Harness research](deepseek-harness-research.md)
and atrib without proposing an integration.

## 1. Executive read

Lemma is not another trace store in the narrow sense. It is a hosted semantic
monitoring and adaptation layer over agent traces. Its central claim is that
many costly agent failures look successful to ordinary observability: the agent
returns a result, no span necessarily errors, and the user-facing outcome is
still wrong. Lemma ingests trace trees, analyzes them against instructions and
other contextual references, clusters recurring findings into issues, routes
them to a developer through Slack or MCP, and proposes an online evaluation
after a fix.

The important move is the comparison, not the trace. Lemma's own taxonomy says
that a silent failure is a mismatch between an action and one of four things
outside that action: what the agent was told, what happened elsewhere in the
run, what was established as true, or what the user later understood. That is a
strong and useful framing for atrib.

But an inferred issue is not an independently verified fact. Lemma is an
excellent candidate to _produce a failure hypothesis and its operational
evidence_. atrib is the layer that can bind the underlying source window,
policy or instruction revision, evaluator identity, review state, and any
subsequent fix decision into a signed and independently checkable chain.

## 2. The launch claim and what the product documents

In the launch thread, Jerry Zhang describes the problem as agents taking on
economic work while teams often learn about errors from users or not at all. He
positions Lemma as a system that finds unanticipated failures in production
runs, sends urgent issues to Slack, gives a coding agent the traces and context
to fix an issue, and watches for recurrence after shipping. He also claims
Lemma processes more than one million agent conversations per day and is used
by named startups. Those scale and customer statements are founder claims in
the launch thread. This review does not independently verify them.

Sources: [launch thread](https://x.com/zjearbear/status/2087948196320567636),
[failure-discovery post](https://x.com/zjearbear/status/2087948988070887851),
[MCP handoff post](https://x.com/zjearbear/status/2087949219147682237), and
[scale and customer claim](https://x.com/zjearbear/status/2087949359455609100).

The first-party documentation substantiates the product shape. The marketing
site says Lemma audits traces against an agent's instructions, groups recurring
failures into issues, sends alerts, exposes context to coding agents through
MCP, and creates an online evaluation after a fix. The product's operating
claim should therefore be read as **detect, explain, hand off, and monitor for
regression**, not autonomous repair.

Source: [Lemma product site](https://www.uselemma.ai/).

## 3. What Lemma receives and controls

### Trace contract

Lemma receives one complete JSON trace tree for an agent execution at
`POST /traces/ingest`. The root holds current input, final output or error,
agent name, optional thread and user context, and timing. Child records model
calls, tools, retrieval, and application work as `span`, `generation`, or
`tool` children. The client must deliver a completed execution in one request;
the endpoint is not an incremental merge API. Re-delivery with the same span
IDs is idempotent, but server-side normalization may generate missing trace or
span IDs and add a synthetic root span for storage and display.

Source: [Lemma trace contract](https://docs.uselemma.ai/reference/trace-contract).

That is a conventional, useful observability intake model. It is not a native
evidence format. A project API key authenticates the caller to Lemma, while the
published contract does not describe a per-span producer signature, a
hash-linked append history, or an independently verifiable commitment to the
pre-normalized trace body. The synthetic root and server-generated IDs make
this distinction more important: a later receipt should bind the source trace
artifact and its canonicalization rule, not only a Lemma presentation object.

### OTel and trace portability

Lemma is explicitly built on OpenTelemetry-style traces. It recommends Langfuse
as the greenfield instrumentation layer, but accepts existing OpenTelemetry,
OpenInference, Arize, Braintrust, and provider instrumentation through OTLP
export. Its semantic fields support, and recommend recording, full generation
message history, tool arguments and results, thread and user identifiers,
timing, usage, and parent-child relationships.

Sources: [tracing overview](https://docs.uselemma.ai/tracing/overview) and
[Langfuse integration](https://docs.uselemma.ai/integrations/langfuse).

The documented `lemma.sdk.language` and `lemma.sdk.integration` attributes are
called "provenance" by Lemma, but their stated purpose is Analytics coverage
attribution by SDK and integration. They are not cryptographic provenance or
claims about who performed the underlying action.

Source: [trace-contract provenance attributes](https://docs.uselemma.ai/reference/trace-contract#provenance-attributes-lemma-extensions).

### Privacy and the hosted-data boundary

Lemma's contract asks clients to redact secrets, credentials, and sensitive
user data before delivery. It also says framework integrations record inputs,
outputs, and error messages because the product otherwise cannot show what a
run consumed, produced, or why it failed. This is a real operational boundary:
the semantic monitor needs content, whereas an external verifier might only
need commitments, selective disclosure, or an archive reference.

Source: [trace-contract privacy guidance](https://docs.uselemma.ai/reference/trace-contract#privacy).

### MCP and webhooks

Lemma's MCP service gives a developer's coding agent authenticated read access
to project traces, metrics, and monitors. This is an analysis and repair-context
plane. It is not a pre-action control surface. Its webhooks notify a customer
about incident creation, analysis, resolution, or dismissal. Those webhook
payloads are HMAC-SHA-256 authenticated with a per-endpoint shared secret,
letting the recipient authenticate a request from a holder of that secret. It
does not make the original trace, the detected issue, or the root cause
independently true.

Sources: [MCP documentation](https://docs.uselemma.ai/connections/mcp) and
[webhook documentation](https://docs.uselemma.ai/connections/webhooks).

## 4. Lemma's strongest idea: four external references

Lemma's published taxonomy divides seven silent failure modes across four
reference classes:

| Reference                    | Failure modes                                          | Why a span is insufficient                                                        |
| ---------------------------- | ------------------------------------------------------ | --------------------------------------------------------------------------------- |
| What the agent was told      | Skipped work, out-of-scope work, instruction violation | The action lacks the obligations and constraints live at that time.               |
| What occurred in the run     | Integration failure, retry loop                        | The result of one call cannot show whether recovery occurred or failure repeated. |
| What was established as true | Hallucination                                          | A claim needs comparison with grounded context or a verified external state.      |
| What the user took away      | Communication failure                                  | Completion and user understanding can diverge after the agent's turn.             |

Source: [A Taxonomy of Agent Failures](https://www.uselemma.ai/blog/a-taxonomy-of-agent-failures).

Two details deserve attention:

1. Lemma says the same action can receive different verdicts as the live
   instruction changes. This makes policy or instruction versioning and
   temporal scope part of any defensible evaluation result.
2. It says five of the seven modes emit no execution signal. Better trace
   coverage alone cannot close the semantic gap.

This is directly compatible with atrib's existing model. A signed action is
not correct merely because it is signed. A verifier needs the relevant declared
lineage and applicable policy or evidence. In particular,
[D143](../DECISIONS.md#d143-authority-is-verifier-side-policy-over-informed_by-lineage-with-minimum-along-path-propagation)
already keeps authority evaluation at the verifier, while Lemma's taxonomy
clarifies a broader class of outcome and communication comparisons that remain
product- or domain-specific.

## 5. Three layers, three different jobs

| Layer            | Primary question                                                                 | Canonical object                                                                             | What it can establish                                                                                                                     | What it cannot establish alone                                                                                   |
| ---------------- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| DeepSeek Harness | What occurred in one run?                                                        | Harness-owned append-only session event stream and Trajectory projection                     | Operational history, replay, tool-call ordering, context reconstruction                                                                   | Whether the run met its real-world obligation or whether a third party should trust the history                  |
| Lemma            | Is there a recurring semantic failure, and what should we inspect or fix?        | Hosted OTel trace tree, issue cluster, incident, and monitor                                 | Candidate failure patterns, diagnosis context, regression monitoring                                                                      | Whether an inference is true, which policy artifact was authoritative, or whether a suggested repair may execute |
| atrib            | What action, context claim, authorization, or result can another verifier check? | Signed record, declared graph relationship, proof receipt, and optional runtime-log manifest | Cryptographic authorship, record integrity, declared lineage, policy evidence, and protected-action decisions when a host composes a gate | Domain correctness or product quality without an evaluator and appropriate external evidence                     |

This is a stack, not a winner-take-all market map. DeepSeek Harness supplies
the detailed local execution history. Lemma makes that history analytically
useful at production scale. atrib lets selected observations, verdict inputs,
approvals, and outcomes travel outside either product's trust boundary without
asking the receiver to trust a dashboard screenshot or an opaque incident.

There is no documented native DeepSeek Harness integration in Lemma's published
integration roster. DeepSeek's current public implementation centers on its
own session event log, while Lemma expects a completed OTel-style trace tree.
An adapter is therefore possible but should be treated as a potentially lossy
projection, not assumed to be a byte-for-byte trace import.

Sources: [DeepSeek architecture](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/docs/architecture.md),
[Lemma trace contract](https://docs.uselemma.ai/reference/trace-contract), and
[Lemma integrations](https://docs.uselemma.ai/tracing/overview).

## 6. What this changes for atrib

### The opportunity is evidence-aware semantic monitoring

The compelling synthesis is not "atrib should detect silent failures." Lemma
is already focused on discovery, clustering, and repair workflow. atrib should
make a semantic verdict more accountable when that verdict affects a customer,
a production policy, an automated fix, or a dispute.

An evidence-aware incident could carry:

- a signed or manifest-bound source window with exact trace/session identity,
  canonicalization version, coverage facts, and redaction posture;
- the active instruction, policy, or knowledge artifact revision used by the
  evaluator, with temporal validity made explicit;
- evaluator identity, model and prompt or rule version, input selection,
  output, confidence, caveats, and a clear distinction between hypothesis and
  human-confirmed finding;
- a declared link to the affected action records rather than a claim that an
  OTel parent-child edge itself proves cause; and
- a separately signed approval and outcome when the proposed repair reaches a
  protected action boundary.

This would answer the question Lemma deliberately opens: not merely "why did
the monitor say this?", but "what exact evidence, authority, and policy did
that assertion depend on, and can another party check it?"

### The repair loop needs an authority boundary

Lemma's product flow makes it easy to hand an issue and trace context to a
coding agent. That is valuable, but an issue is still an analysis result over
potentially adversarial user content, tool output, and model reasoning. An
agent should not treat it as an approved instruction to change production code,
customer policy, or external state.

atrib's role is to preserve the separation:

1. Lemma or another evaluator emits a signed **observation/hypothesis** with
   its bounded evidence through an atrib-integrated producer.
2. A responsible operator or policy evaluator decides whether that hypothesis
   warrants action.
3. A host action gate signs the allow, block, or escalation decision and the
   eventual outcome.

This keeps useful failure discovery from becoming an unreviewed execution
authority. It also gives a receiving coding agent an honest context packet:
evidence is present, but it may still be incomplete, contested, redacted, or
unapproved.

### Keep raw-body ownership where it belongs

Lemma needs rich trace bodies to reason about semantic failures. DeepSeek needs
its session log to reconstruct a run. atrib should not duplicate either
product's trace store or build a competing issue dashboard. Its strongest
position remains: bind the source body or bounded window, retain detailed
content under the host's privacy rule, and expose signed receipts and selective
evidence to the parties that need verification.

## 7. Boundaries and unknowns

- Lemma's launch-thread processing volume, customer list, and investment amount
  are founder statements. They are not independently validated here.
- The public docs describe the input contract, integrations, MCP, and webhooks.
  They do not expose the internal issue-detection model, evaluator prompts,
  clustering method, false-positive rate, or a benchmark. No performance or
  accuracy claim should be inferred from the product materials.
- An HMAC-signed webhook is a useful authenticated transport from Lemma. It is
  not a public signature, a transparent-log proof, or evidence that the
  incident conclusion is correct.
- Lemma's taxonomy is a valuable analysis framework. It does not reduce
  domain-specific truth, policy interpretation, or user intent to a universal
  automatic verdict.

## Source register

- [Lemma launch thread](https://x.com/zjearbear/status/2087948196320567636)
- [Lemma product site](https://www.uselemma.ai/)
- [Lemma tracing overview](https://docs.uselemma.ai/tracing/overview)
- [Lemma trace contract](https://docs.uselemma.ai/reference/trace-contract)
- [Lemma MCP documentation](https://docs.uselemma.ai/connections/mcp)
- [Lemma webhook documentation](https://docs.uselemma.ai/connections/webhooks)
- [Lemma failure taxonomy](https://www.uselemma.ai/blog/a-taxonomy-of-agent-failures)
- [DeepSeek Harness research](deepseek-harness-research.md)
