# “Interface for agent work”: language and collision research

Research document, 2026-08-26. Not an ADR. This is a primary-source review of
the phrases **“shared interface for agent work,” “interface for agent work,”**
and nearby category language. It covers public product copy, official product
documentation, public repositories, domain registry responses, and official
trademark-search guidance. It does not provide legal advice or a full trademark
clearance opinion.

The web and registry searches in this note were run on 2026-08-26. Search
results are a dated observation, not proof that a phrase has never been used or
that a name is available in every market.

Terms used below:

- **Exact** means the full words appear in the stated order.
- **Close** means the source uses the same noun structure or communicates nearly
  the same product role without using the full phrase.
- **Adjacent** means the source occupies the same semantic category but uses a
  different category label.
- **Inferred** marks a likely audience or search interpretation derived from the
  cited product language.

## Executive read

No indexed AI product source found in this review used either phrase verbatim as
a prominent product claim. The shorter string does have a literal legacy match:
ServiceNow's customer-service documentation calls forms and form headers a
“central user interface for agent work.” Here, `agent` means a human service
agent. ([L1]) A public AI project also says teams lack “a practical shared
interface” for deciding what an AI agent should do, what needs a human, what is
blocked, and what is ready for review. That wording entered its public
repository on 2026-06-04. ([E1], [E2])

The category around the phrase is crowded:

- OpenAI calls Codex a “command center for agents” and a new interface for
  managing multiple agents and parallel work. ([C1])
- GitHub offers a unified view to manage agents and tasks and compares it to a
  mission control center. ([C2])
- Asana names the category “Agentic Work Management,” grounds agents in its
  Work Graph, and calls its suite an operating system for human-agent teams.
  ([W1], [W2])
- Linear makes agents members of a workspace and lets users delegate and
  orchestrate work through issues. ([W3])
- Atlassian calls Rovo Studio a unified place and a workspace for agents,
  automations, and apps grounded in its Teamwork Graph. ([W4])
- Microsoft, IBM, and Workday use control-plane or system-of-record language for
  organization-wide agent identity, governance, observability, and lifecycle
  management. ([M1], [M2], [M3])
- “Agent workspace” already names unrelated products and older customer-service
  desktops, not one stable AI category. ([A1], [A2], [A3])

The longer phrase has low observed literal collision but high semantic
collision. The shorter phrase already exists outside the AI-agent category. The
wording reads as descriptive category copy, and the evidence does not support
treating it as an ownable category name by itself. “Shared,”
“interface,” “agent,” and “work” each describe the proposed function, and the
USPTO says descriptive wording is weak and can be difficult to protect. ([T1])

## 1. Search method and limits

The review used exact-phrase and close-variant searches for:

```text
"shared interface for agent work"
"interface for agent work"
"shared interface" "agent work"
"interface for AI agent work"
"agent work interface"
"interface for agentic work"
"shared workspace for agents"
"agent workspace"
```

It then searched first-party product and documentation sources for the adjacent
terms `agent work management`, `agent management`, `multi-agent`, `work graph`,
`operating graph`, `agent workspace`, and `agent control plane`.

The public-source review prioritizes pages controlled by the product owner and
public repositories controlled by the named project. Search snippets were used
to discover sources, then the first-party page or repository was treated as the
evidence. The absence finding is bounded to sources indexed and reachable on
the search date.

Trademark work was limited to exact-wordmark queries and official guidance.
Direct queries to the current USPTO search service returned zero wordmark
records for the two requested phrases and for `shared interface for agents`,
`agent work interface`, and `interface for agentic work`. USPTO itself says an
exact-wording search is only the first step and that a federal search should
expand wording, pronunciations, and related goods or services. ([T2], [T7])
WIPO prohibits automatic querying, so this review did not claim a direct Global
Brand Database result. WIPO also warns that the database does not cover every
national filing and recommends national or regional searches too. ([T3], [T4],
[T8]) No conclusion below should be read as legal clearance.

## 2. Exact and close phrase findings

| Wording                                                            | Match                         | Source and observed use                                                                                                                                                            | Collision meaning                                                                                                                             |
| ------------------------------------------------------------------ | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `shared interface for agent work`                                  | No indexed exact match found  | The full six-word string did not surface in the reviewed web or repository searches, and the USPTO exact-wordmark query returned zero.                                             | Literal whitespace exists as of the search date. Absence from indexed results is not ownership.                                               |
| `interface for agent work`                                         | Exact, legacy human-agent use | ServiceNow uses “central user interface for agent work” for the forms and form headers used by human customer-service agents. Its USPTO exact-wordmark query returned zero. ([L1]) | The exact wording is not novel across software. Its meaning differs from AI-agent coordination, but it creates search and category ambiguity. |
| `practical shared interface for deciding what the agent should do` | Close                         | Personal Task Assistant says teams lack this interface for agent versus human ownership, blocked state, and review readiness. ([E1])                                               | Direct semantic collision around shared decisions, work state, and review.                                                                    |
| `user interface for accountable agent work`                        | Close                         | Blake Crosley defines a “supervision surface” with this sentence, then lists run state, approvals, trace, evidence, recovery, and review. ([E3])                                   | Direct collision around accountability and human attention, though it is an essay term rather than a product name.                            |
| `unified interface for agent harnesses`                            | Close                         | HarnessRouter uses this as its headline and defines tasks, runs, sessions, files, artifacts, streaming, and renderers behind one API and control plane. ([E4])                     | Strong technical collision if “interface” means a stable API above multiple harnesses.                                                        |
| `missing interface between prompts and pull requests`              | Close                         | Rut uses this for a coding-agent command center with tickets, context, progress, decisions, handoffs, and review state. ([E5])                                                     | Strong workflow collision in software development.                                                                                            |
| `interface designed to ... manage multiple agents at once`         | Close                         | OpenAI describes the Codex app this way and calls it a command center for agents. ([C1])                                                                                           | A large first-party source already connects interface, multi-agent management, parallel work, review, and long-running tasks.                 |
| `shared workspace where agents and humans coordinate as a team`    | Close                         | Agent Kanban says this is missing, then presents itself as that workspace. ([E6])                                                                                                  | Direct collision around shared human-agent task coordination.                                                                                 |

The longer string is not a visibly established slogan in the reviewed corpus.
The shorter string appears in legacy customer-service software, and most of the
AI product meaning is already expressed in nearby copy.

## 3. Semantic collision map

### 3.1 Shared

“Shared” most often signals one of three things in the reviewed sources:

1. a common view for a human and one or more agents;
2. a team workspace in which agents act as members; or
3. shared context, task state, or memory across tools.

OpenAI Sites gives teams “a shared place” to explore work, contribute input,
track progress, and make decisions. ([S1]) Linear makes agents members of the
same workspace as people. ([W3]) Notion runs team-wide agents inside the
existing workspace, with permissions and logged runs. ([S2]) Agent Kanban uses
the missing “shared workspace” formulation directly. ([E6])

**Inferred customer interpretation:** “shared interface” promises a common
collaboration surface. It does not, by itself, tell a reader whether the shared
object is a task board, chat history, files, accepted state, memory, governance
policy, or signed evidence.

### 3.2 Interface

“Interface” spans at least four product layers:

| Layer                       | First-party example       | What “interface” means there                                                                         |
| --------------------------- | ------------------------- | ---------------------------------------------------------------------------------------------------- |
| Human control surface       | Codex, GitHub agents, Rut | A place to assign, monitor, review, and steer agent tasks. ([C1], [C2], [E5])                        |
| Stable application API      | HarnessRouter             | Contracts for invoking harnesses and receiving runs, files, and artifacts. ([E4])                    |
| Agent-generated UI protocol | Google A2UI               | A protocol by which agents provide UI descriptions to host applications. ([I1])                      |
| Contact-center desktop      | Oracle and Amazon Connect | A human service agent’s work-access application, a meaning that predates generative AI. ([A2], [A3]) |

**Inferred customer interpretation:** without a modifier, “interface” is
underspecified. A developer may hear API or protocol. An operator may hear
dashboard. A buyer familiar with contact-center software may hear an employee
desktop.

### 3.3 Agent work

“Agent work” can mean work performed by AI agents, work assigned to agents, the
artifacts agents produce, or the day-to-day work of human service agents.
OpenAI uses “agent work” for hours of delegated Codex activity. ([C3]) The
Personal Task Assistant and Rut use it for tasks and implementation units.
([E1], [E5]) ServiceNow uses the exact shorter string for a human
customer-service interface. Oracle's older “Agent Workplace” uses “agent work
access” for a human contact-center worker. ([L1], [A2]) AgentWork uses the
concatenated term for a marketplace where AI agents perform paid tasks. ([A4])

The joined and title-case forms are crowded too:

- `agentwork.com` is a shared knowledge layer with sourced answers and agent
  access over MCP. ([AW1])
- `agentwork.sh` calls AgentWork an autonomous AI workbench for software
  organizations. ([AW2])
- `agentworkhq.com` uses “Agent work, verified” for a task marketplace with
  verification scripts. ([AW3])
- `agentwork.app` is a separate job market for AI agents. ([A4])
- Colter calls itself “the operating system for paid agent work” and uses “Agent
  Work Platform” and “Agent Work Contract” as category language. ([AW4])

OpenAI also launched `ChatGPT Work` as the name of its long-running agent mode
for research, analysis, connected apps, and finished deliverables. ([O1]) It is
not an exact phrase collision, but it makes bare `Work` language less specific
when an AI agent is the subject.

**Inferred customer interpretation:** the phrase needs nearby AI or product
context to avoid the human call-center and labor-market meanings. Even with AI
context, it does not specify whether the product runs work, coordinates it,
governs it, or proves it. The AgentWork cluster also means a reader may treat
`Agent Work` as a product name rather than a category description.

### 3.4 Work management and agent management

Asana claims “Agentic Work Management,” connects agents to its Work Graph, and
describes one plan, one context, and one governance model for humans and agents.
([W1], [W2]) Linear routes agent participation through existing issue and
project management. ([W3]) These sources frame the primary object as work.

Microsoft Agent 365, IBM’s definition of an agent control plane, and Workday’s
Agent System of Record frame the primary object as the agent fleet: identity,
registration, access, behavior, governance, observability, and lifecycle.
([M1], [M2], [M3])

**Inferred customer interpretation:** “interface for agent work” lands between
these two categories. Buyers may assume work management if the page shows tasks
and review. They may assume fleet management if it shows identity, policy,
budgets, security, and lifecycle.

### 3.5 Multi-agent and command center

OpenAI, GitHub, and many public coding-agent projects use “command center” or
“mission control” for parallel task execution and review. OpenAI describes
separate threads and worktrees. GitHub describes one unified view for agents and
tasks. ([C1], [C2]) Public repositories use the same metaphor for local coding
sessions, dashboards, worktrees, and queues. ([E7])

**Inferred customer interpretation:** language about managing multiple agents
is likely to be read first as orchestration or supervision of concurrent runs,
especially in developer tooling. It does not inherently communicate durable
cross-runtime state or provenance.

### 3.6 Work graph and operating graph

Asana’s Work Graph connects goals, projects, tasks, and people, and its new
agentic suite puts AI teammates into that graph. ([W1], [W2]) Atlassian’s
Teamwork Graph supplies live organizational context to agents, automations, and
apps. ([W4]) “Operating graph” is less common in the reviewed first-party
corpus, but “operating system for human-agent teams” is already an Asana claim.
([W2])

**Inferred customer interpretation:** “work graph” suggests an enterprise work
model or knowledge graph. “Operating graph” can suggest a broader coordination
and state layer, but a reader still needs concrete objects and boundaries to
distinguish it from Asana’s and Atlassian’s graph-backed work platforms.

### 3.7 Agent workspace

This term has the highest lexical collision in the set. It currently describes:

- a local multi-CLI control plane called Agent Workspace; ([A1])
- a sandboxed calendar, docs, and email account for an agent called
  AgentWorkspace; ([A5])
- a product surface for monitoring and configuring one AI agent; ([A6])
- Notion and Linear workspaces in which AI agents operate as teammates; ([S2],
  [W3])
- Amazon Connect’s and Oracle’s human customer-service desktops; and ([A2],
  [A3])
- an AWS developer product whose title is literally “Agent Workspace.” ([A7])

**Inferred customer interpretation:** “agent workspace” is already a generic,
multi-meaning category phrase. Searchers cannot infer human versus AI agent,
local versus cloud, sandbox versus team workspace, or execution versus
management from the term alone.

### 3.8 Agent control plane

Microsoft says Agent 365 is a centralized control plane for enterprise agents.
IBM defines an agent control plane as the system that deploys, operates,
monitors, and governs agents. Microsoft Foundry separately calls its Control
Plane the governance and operations layer for AI applications and agents.
([M1], [M2], [M4])

**Inferred customer interpretation:** “control plane” now carries a concrete
enterprise-infrastructure promise: registry, lifecycle, policy, observability,
security, and deployment control. Using it for a view-only coordination product
would create expectation risk.

## 4. SEO and discovery ambiguity

This section reports likely search interpretation, not measured search volume.
No keyword-volume provider was used.

The reviewed result sets show four competing intents:

| Query language             | Likely intent visible in results                                                                     | Representative sources                                                                                  |
| -------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `agent interface`          | UI protocols, agent dashboards, and older intelligent “interface agent” research                     | Google A2UI, Codex, older interface-agent literature. ([I1], [C1])                                      |
| `agent work`               | AI task execution, marketplaces, and human service-agent work                                        | OpenAI’s research, AgentWork, Oracle. ([C3], [A4], [A2])                                                |
| `AgentWork` / `Agent Work` | Shared knowledge, autonomous software delivery, verified-task markets, and paid-agent infrastructure | Agentwork.com, AgentWork.sh, AgentWorkHQ, AgentWork.app, and Colter. ([AW1], [AW2], [AW3], [A4], [AW4]) |
| `agent workspace`          | Local agent runner, isolated digital workspace, AI team workspace, or contact-center desktop         | Agent Workspace, AgentWorkspace, Notion, Amazon Connect. ([A1], [A5], [S2], [A3])                       |
| `agent control plane`      | Enterprise governance, security, lifecycle, and orchestration infrastructure                         | Microsoft, IBM, Workday. ([M1], [M2], [M3])                                                             |

“Interface for agent work” is natural-language descriptive copy, so it can
match broad informational queries. That same property makes it difficult to
dominate as a unique navigational term. “Shared” narrows the collaboration
meaning but does not remove the ambiguity between a dashboard, task system,
workspace, API, and context layer.

The direct collision from OpenAI matters for discovery even without an exact
phrase match. Its Codex page already combines the words and concepts most likely
to satisfy a searcher seeking an interface for parallel agent work: interface,
command center, multiple agents, parallel work, long-running tasks, review, and
project context. ([C1]) GitHub and Linear cover much of the same intent inside
developer workflows. ([C2], [W3])

## 5. Trademark and domain observations

### 5.1 Trademark posture

Direct exact-wordmark queries to the USPTO service returned zero records for the
two requested phrases and three close variants. This is only a negative
knock-out observation. The review did not run a direct WIPO database query
because WIPO prohibits automatic searches. Web-index searches did not surface a
WIPO record for the phrases, but that is not a WIPO result. These observations
do not exclude unindexed filings, national records outside WIPO coverage,
common-law use, design marks, similar wording, or related-goods conflicts.

The official guidance points to two evidence-backed constraints:

1. USPTO says weak marks are descriptive or generic. Descriptive wording
   immediately describes an aspect of the goods or services and may be hard to
   register or defend without acquired distinctiveness. ([T1])
2. USPTO says rights attach to use with identified goods or services, not to a
   phrase in the abstract, and similar marks on related goods or services can
   matter. ([T5], [T6])

Applied to this wording, “shared interface for agent work” reads as a direct
description of purpose and intended users: a common interface for work done by
or with agents. That makes strong exclusive ownership of the phrase itself look
unlikely on the public evidence. This is a language-strength inference, not a
legal conclusion about registrability.

The phrase may still function as a tagline used with a distinctive product
name. The research does not establish whether sustained marketplace use could
create secondary meaning, nor whether a specific stylized presentation would
be registrable.

### 5.2 Domain observations

Direct RDAP queries on 2026-08-26 returned `404` for the following names:

```text
interfaceforagentwork.com
sharedinterfaceforagentwork.com
agentworkinterface.com
sharedagentinterface.com
interfaceforagentwork.ai
sharedinterfaceforagentwork.ai
agentworkinterface.ai
sharedagentinterface.ai
```

The `.com` checks used Verisign’s authoritative RDAP service; the `.ai` checks
used Identity Digital’s RDAP service. ([D1], [D2]) A `404` means no domain
object was returned at that moment. It is not a purchase guarantee, does not
cover premium or reserved status, and does not establish trademark rights.

Domain string whitespace is therefore greater than search-category whitespace.
None of these long domains appears to have an established registry object at
the check time, while shorter adjacent terms such as `agent-workspace.ai` and
`agentworkspace.dev` are already active product domains. ([A1], [A5])

## 6. What phrase ownership appears realistically available

The evidence supports a three-part distinction:

| Kind of ownership                                                | Evidence-backed read                                                                                                                                                                                                                                                                                                                |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Exact-string novelty in current indexed copy                     | **Mixed.** The longer phrase did not appear as an established headline or named category. The shorter phrase has an exact legacy match in ServiceNow customer-service documentation. ([L1])                                                                                                                                         |
| Semantic category ownership                                      | **Little whitespace.** Major platforms and smaller products already claim shared workspaces, unified views, command centers, work graphs, operating systems, and control planes for human-agent work. `AgentWork` and `Agent Work` also identify several unrelated products and category claims. ([AW1], [AW2], [AW3], [A4], [AW4]) |
| Exclusive brand or trademark ownership of the descriptive phrase | **Unclear and likely weak.** The wording describes the product function, and official USPTO guidance treats descriptive wording as weak. A real clearance process would need live exact, expanded, phonetic, related-goods, common-law, and jurisdiction-specific searches. ([T1], [T2], [T3])                                      |

Several products already claim the broad idea of “one place where people and
agents work.” Any remaining language territory depends on a narrower factual
definition of what is shared and what the interface carries. The sources show that
specificity is what separates neighboring categories: Codex shares active
threads and review; Linear shares issue state; Asana shares a work graph and
governance; Microsoft manages agent identity and lifecycle; HarnessRouter
standardizes harness execution contracts. ([C1], [W3], [W1], [M1], [E4])

That is an implication of the collision evidence, not a recommendation for a
particular phrase or product position.

## Sources

- **[E1]** J3d1-fm, [Personal Task Assistant README](https://github.com/J3d1-fm/Personal-Task-Assistant), “practical shared interface” and coordination-layer description.
- **[E2]** J3d1-fm, [commit introducing the shared-interface wording](https://github.com/J3d1-fm/Personal-Task-Assistant/commit/5fbe7052d3cac4a3b0cd649fb5aa892b77b58a4c), 2026-06-04.
- **[E3]** Blake Crosley, [Agents Need Supervision Surfaces](https://blakecrosley.com/blog/agents-need-supervision-surfaces), definition of a user interface for accountable agent work.
- **[E4]** HarnessRouter, [The World’s First Unified Interface for Agent Harnesses](https://harnessrouter.ai/blog/harnessrouter-unified-interface-for-agent-harnesses), 2026-08-03.
- **[E5]** Rut, [The command center for AI coding agents](https://tryrut.com/), interface, ticket, handoff, and review language.
- **[E6]** saltbo, [Agent Kanban](https://github.com/saltbo/agent-kanban), shared human-agent workspace claim.
- **[E7]** AgentSystemLabs, [MissionControl](https://github.com/AgentSystemLabs/mission-control), desktop control surface for multi-project coding-agent work.
- **[C1]** OpenAI, [Introducing the Codex app](https://openai.com/index/introducing-the-codex-app/), 2026-02-02.
- **[C2]** GitHub, [Copilot agents](https://github.com/features/copilot/agents), unified agent-and-task view and mission-control comparison.
- **[C3]** OpenAI, [How agents are transforming work](https://openai.com/index/how-agents-are-transforming-work/), 2026-06-25.
- **[W1]** Asana, [Agentic Work Management](https://asana.com/product/ai/smart-assists), AI teammates, connectors, and Work Graph.
- **[W2]** Asana, [Asana unveils operating system for human-agent teams](https://investors.asana.com/news-releases/news-release-details/asana-unveils-operating-system-human-agent-teams), 2026-06-04.
- **[W3]** Linear, [Linear for Agents](https://linear.app/agents), agents as workspace members and issue contributors.
- **[W4]** Atlassian, [Rovo Studio](https://www.atlassian.com/software/rovo/studio), unified builder workspace and Teamwork Graph.
- **[M1]** Microsoft, [Why does an enterprise need Agent 365?](https://learn.microsoft.com/en-us/microsoft-agent-365/leadership/why-agent-365-for-enterprise), updated 2026-08-19.
- **[M2]** IBM, [What is an Agent Control Plane?](https://www.ibm.com/think/topics/agent-control-plane), 2026.
- **[M3]** Workday, [The Foundation of the Blended Workforce](https://www.workday.com/content/dam/web/en-us/documents/datasheets/asor-datasheet-enus.pdf), Agent System of Record datasheet.
- **[M4]** Microsoft Azure, [Foundry Control Plane](https://azure.microsoft.com/en-us/products/ai-foundry/control-plane), governance and operations layer.
- **[S1]** OpenAI, [Codex for every role, tool, and workflow](https://openai.com/index/codex-for-every-role-tool-workflow/), shared Sites workspace language, 2026-06-02.
- **[S2]** Notion, [Notion Agents](https://www.notion.com/product/agents), team-wide agents, permissions, and logged runs.
- **[I1]** Google, [A2UI](https://github.com/google/a2ui), agent-to-user-interface protocol.
- **[A1]** Agent Workspace, [All your Agents. One Workspace](https://agent-workspace.ai/), local multi-CLI control plane.
- **[A2]** Oracle, [Universal Work Queue User Guide: Agent Workplace](https://docs.oracle.com/cd/E26401_01/doc.122/e48979/T249747T249750.htm), human service-agent work access.
- **[A3]** AWS, [Amazon Connect agent workspace](https://aws.amazon.com/connect/agent-workspace/), unified customer-service application.
- **[A4]** AgentWork, [The Freelance Economy for AI Agents](https://www.agentwork.app/), AI-agent work marketplace.
- **[A5]** AgentWorkspace, [The workspace your AI agents actually own](https://agentworkspace.dev/), isolated calendar, docs, and email.
- **[A6]** KANAP, [AI Agents: Agent workspace](https://doc.kanap.net/agents-workspace/), single-agent monitoring and configuration surface.
- **[A7]** AWS, [Agent Workspace Developer Guide](https://docs.aws.amazon.com/agentworkspace/latest/devguide/developer-guide.pdf), named AWS developer product.
- **[L1]** ServiceNow, [Migrate to CSM Configurable Workspace](https://www.servicenow.com/docs/r/yokohama/customer-service-management/csm-migrate-configurable-workspace.html), exact human-service-agent phrase match, updated 2025-01-30.
- **[AW1]** Agentwork, [One place to ask, across every tool](https://agentwork.com/), shared knowledge layer and sourced answers.
- **[AW2]** AgentWork, [Autonomous AI Workbench](https://agentwork.sh/), software-organization workbench.
- **[AW3]** AgentWork, [Agent work, verified](https://agentworkhq.com/), verification-script task marketplace.
- **[AW4]** Colter, [The Agent Work Platform](https://colter.ai/platform), paid agent-work operating system and contract language.
- **[O1]** OpenAI, [ChatGPT Work and Codex](https://help.openai.com/en/articles/20001275/), Work as a long-running agent mode.
- **[T1]** USPTO, [Strong trademarks](https://www.uspto.gov/trademarks/basics/strong-trademarks), descriptive and generic marks.
- **[T2]** USPTO, [Federal trademark searching](https://www.uspto.gov/trademarks/search/federal-trademark-searching), exact and expanded wording search guidance.
- **[T3]** WIPO, [Global Brand Database](https://www.wipo.int/en/web/global-brand-database), database coverage and national-register caveat.
- **[T4]** WIPO, [Check availability](https://www.wipo.int/en/web/madrid-system/check-availability), exact, similar, and jurisdiction-specific search guidance.
- **[T5]** USPTO, [What is a trademark?](https://www.uspto.gov/trademarks/basics/what-trademark), source-identifying use and phrase scope.
- **[T6]** USPTO, [Trademark scope of protection](https://www.uspto.gov/trademarks/basics/scope-protection), goods-and-services scope.
- **[T7]** USPTO, [Trademark Search](https://tmsearch.uspto.gov/), live wordmark-query service used on 2026-08-26.
- **[T8]** WIPO, [Global Brand Database FAQ](https://www.wipo.int/en/web/global-brand-database/faqs_branddb), automatic-query prohibition and coverage guidance.
- **[D1]** Verisign, [`.com` RDAP service](https://rdap.verisign.com/com/v1/domain/interfaceforagentwork.com), representative checked domain query.
- **[D2]** Identity Digital, [`.ai` RDAP service](https://rdap.identitydigital.services/rdap/domain/interfaceforagentwork.ai), representative checked domain query.
