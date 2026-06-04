export function renderApp(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Cloudflare approval trace</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f5f7fb;
        --panel: #ffffff;
        --line: #d9e1ec;
        --text: #111318;
        --muted: #596579;
        --blue: #1f5fd8;
        --green: #147a54;
        --amber: #b36200;
        --orange: #f38020;
        --red: #b4232e;
        --ink: #1f2937;
        --soft: #eef3f8;
        --shadow: 0 18px 48px rgba(18, 28, 45, 0.08);
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        background: var(--bg);
        color: var(--text);
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }

      button,
      textarea,
      input {
        font: inherit;
      }

      button {
        border: 0;
        cursor: pointer;
      }

      button:disabled,
      textarea:disabled,
      input:disabled {
        cursor: not-allowed;
        opacity: 0.58;
      }

      .shell {
        margin: 0 auto;
        max-width: 1460px;
        padding: 24px;
      }

      .hero {
        align-items: end;
        display: grid;
        gap: 18px;
        grid-template-columns: minmax(0, 1fr) auto;
        margin-bottom: 18px;
      }

      h1 {
        font-size: 26px;
        letter-spacing: 0;
        line-height: 1.15;
        margin: 0 0 6px;
      }

      .sub {
        color: var(--muted);
        font-size: 14px;
        line-height: 1.5;
        margin: 0;
        max-width: 760px;
      }

      .workflow-rail {
        align-items: center;
        background: var(--panel);
        border: 1px solid var(--line);
        border-radius: 8px;
        box-shadow: var(--shadow);
        display: flex;
        gap: 18px;
        justify-content: space-between;
        margin-bottom: 16px;
        min-height: 74px;
        padding: 14px 16px;
      }

      .status-chip {
        align-items: center;
        background: #fff7ed;
        border: 1px solid #fed7aa;
        border-radius: 999px;
        color: #9a3412;
        display: inline-flex;
        font-size: 12px;
        font-weight: 800;
        min-height: 28px;
        padding: 6px 10px;
      }

      .rail-main {
        align-items: center;
        display: flex;
        gap: 11px;
        min-width: 0;
      }

      .rail-main strong {
        display: block;
        font-size: 15px;
        line-height: 1.25;
      }

      .rail-main p {
        color: var(--muted);
        font-size: 13px;
        line-height: 1.35;
        margin: 2px 0 0;
      }

      .rail-stepper {
        align-items: center;
        display: flex;
        flex-wrap: wrap;
        gap: 7px;
        justify-content: end;
      }

      .step {
        background: var(--soft);
        border: 1px solid var(--line);
        border-radius: 999px;
        color: var(--muted);
        font-size: 12px;
        font-weight: 750;
        min-height: 28px;
        padding: 6px 9px;
      }

      .step.active {
        background: #e8efff;
        border-color: #b8c8f6;
        color: var(--blue);
      }

      .step.halted {
        background: #fff7ed;
        border-color: #fdba74;
        color: #9a3412;
      }

      .step.done {
        background: #e8f6ef;
        border-color: #b8dfca;
        color: var(--green);
      }

      .step.error {
        background: #fff1f2;
        border-color: #ffcdd4;
        color: var(--red);
      }

      .dot {
        border-radius: 999px;
        display: inline-block;
        height: 9px;
        width: 9px;
      }

      .dot.pending {
        background: var(--amber);
      }

      .dot.ok {
        background: var(--green);
      }

      .dot.error {
        background: var(--red);
      }

      .grid {
        display: grid;
        gap: 16px;
        grid-template-columns: minmax(320px, 0.92fr) minmax(390px, 1.12fr) minmax(360px, 1fr);
      }

      .panel {
        background: var(--panel);
        border: 1px solid var(--line);
        border-radius: 8px;
        box-shadow: var(--shadow);
        min-width: 0;
        padding: 16px;
      }

      .panel h2 {
        font-size: 14px;
        letter-spacing: 0.04em;
        margin: 0 0 12px;
        text-transform: uppercase;
      }

      .prompt {
        display: grid;
        gap: 10px;
      }

      textarea {
        background: #fff;
        border: 1px solid var(--line);
        border-radius: 8px;
        color: var(--text);
        min-height: 118px;
        padding: 12px;
        resize: vertical;
        width: 100%;
      }

      .primary,
      .secondary,
      .danger {
        align-items: center;
        border: 1px solid transparent;
        border-radius: 8px;
        display: inline-flex;
        font-weight: 750;
        justify-content: center;
        min-height: 40px;
        padding: 10px 13px;
      }

      .primary {
        background: var(--blue);
        color: #fff;
      }

      .secondary {
        background: var(--soft);
        color: var(--ink);
      }

      .danger {
        background: #fff1f2;
        color: var(--red);
      }

      .primary:disabled,
      .secondary:disabled,
      .danger:disabled {
        background: #edf2f7;
        border-color: var(--line);
        color: #7a8497;
        opacity: 1;
      }

      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }

      .run-state {
        align-items: start;
        background: #f8fafc;
        border: 1px solid var(--line);
        border-radius: 8px;
        display: grid;
        gap: 4px;
        padding: 10px;
      }

      .run-state.halt {
        background: #fff7ed;
        border-color: #fdba74;
      }

      .run-state.ok {
        background: #ecfdf5;
        border-color: #a7f3d0;
      }

      .progress-list {
        display: grid;
        gap: 8px;
      }

      .progress-item {
        align-items: start;
        border: 1px solid var(--line);
        border-radius: 8px;
        display: grid;
        gap: 4px;
        grid-template-columns: 12px minmax(0, 1fr);
        padding: 10px;
      }

      .progress-item .dot {
        margin-top: 4px;
      }

      .progress-item strong {
        display: block;
        font-size: 13px;
      }

      .progress-item span {
        color: var(--muted);
        display: block;
        font-size: 12px;
        line-height: 1.35;
      }

      .progress-item.halted {
        background: #fff7ed;
        border-color: #fdba74;
      }

      .run-state strong {
        font-size: 13px;
      }

      .run-state span {
        color: var(--muted);
        font-size: 13px;
        line-height: 1.4;
      }

      .toggle {
        align-items: center;
        color: var(--muted);
        display: flex;
        font-size: 13px;
        gap: 8px;
      }

      .proposal {
        display: grid;
        gap: 10px;
      }

      .metric-row {
        display: grid;
        gap: 8px;
      }

      .metric {
        background: var(--soft);
        border: 1px solid var(--line);
        border-radius: 8px;
        display: grid;
        gap: 4px;
        padding: 10px;
      }

      .label {
        color: var(--muted);
        font-size: 12px;
        font-weight: 750;
        letter-spacing: 0.03em;
        text-transform: uppercase;
      }

      .value {
        font-size: 14px;
        line-height: 1.4;
        overflow-wrap: anywhere;
      }

      .diff {
        display: grid;
        gap: 8px;
        grid-template-columns: 1fr 1fr;
      }

      .diff pre,
      .json pre {
        background: #111827;
        border-radius: 8px;
        color: #f9fafb;
        font-size: 12px;
        line-height: 1.45;
        margin: 0;
        max-height: 280px;
        overflow: auto;
        padding: 12px;
        white-space: pre-wrap;
        word-break: break-word;
      }

      .value-props {
        display: grid;
        gap: 10px;
      }

      .prop {
        border: 1px solid var(--line);
        border-radius: 8px;
        display: grid;
        gap: 4px;
        padding: 11px;
      }

      .prop strong {
        font-size: 14px;
      }

      .prop span {
        color: var(--muted);
        font-size: 13px;
        line-height: 1.4;
      }

      .timeline {
        display: grid;
        gap: 8px;
      }

      .event {
        background: #fff;
        border: 1px solid var(--line);
        border-radius: 8px;
        color: inherit;
        display: grid;
        gap: 6px;
        text-align: left;
        padding: 10px;
      }

      .event:hover,
      .event:focus-visible,
      .event.selected {
        border-color: #8aa8f7;
        box-shadow: 0 0 0 3px rgba(35, 91, 216, 0.12);
        outline: 0;
      }

      .event-head {
        align-items: center;
        display: flex;
        gap: 8px;
        justify-content: space-between;
      }

      .pill {
        background: var(--soft);
        border: 1px solid var(--line);
        border-radius: 999px;
        color: var(--ink);
        display: inline-flex;
        font-size: 12px;
        font-weight: 750;
        min-height: 24px;
        padding: 4px 8px;
      }

      .hash {
        color: var(--muted);
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        font-size: 12px;
        overflow-wrap: anywhere;
      }

      .event-action {
        color: var(--blue);
        font-size: 12px;
        font-weight: 750;
      }

      .empty {
        color: var(--muted);
        font-size: 14px;
        line-height: 1.45;
      }

      .links {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-top: 10px;
      }

      .links a {
        background: #fff;
        border: 1px solid var(--line);
        border-radius: 999px;
        color: var(--ink);
        font-size: 12px;
        font-weight: 750;
        padding: 7px 10px;
        text-decoration: none;
      }

      @media (max-width: 1100px) {
        .hero,
        .grid {
          grid-template-columns: 1fr;
        }

        .workflow-rail {
          align-items: stretch;
          display: grid;
        }

        .rail-stepper {
          justify-content: start;
        }
      }
    </style>
  </head>
  <body>
    <main class="shell" data-testid="approval-trace-app">
      <section class="hero">
        <div>
          <h1>Cloudflare Agent Trace</h1>
          <p class="sub">Watch an agent wake from a prior trigger, work autonomously, halt for human approval, resume through MCP execution, then leave a signed audit trail.</p>
        </div>
        <span class="status-chip">Local proof surface</span>
      </section>

      <section class="workflow-rail" id="workflowRail" aria-live="polite">
        <div class="rail-main">
          <span class="dot pending" id="statusDot"></span>
          <div>
            <strong id="statusTitle">Ready</strong>
            <p id="statusDetail">Run the prior trigger to start autonomous triage before the human review gate.</p>
          </div>
        </div>
        <div class="rail-stepper" id="workflowSteps">
          <span class="step active" data-step="trigger">Trigger</span>
          <span class="step" data-step="autonomous">Autonomous triage</span>
          <span class="step" data-step="halt">HITL halt</span>
          <span class="step" data-step="resume">Resume</span>
          <span class="step" data-step="audit">Audit</span>
        </div>
      </section>

      <section class="grid">
        <div class="panel">
          <h2>Prior trigger</h2>
          <div class="prompt">
            <textarea id="prompt">A scheduled agent follow-up found a bug-labeled Workers issue with enough evidence to publish a triage reply.</textarea>
            <label class="toggle">
              <input id="simulateError" type="checkbox" />
              Simulate issue thread change after approval
            </label>
            <div class="actions">
              <button class="primary" id="create">Run prior trigger</button>
              <button class="secondary" id="reset">Reset</button>
            </div>
          </div>
          <div class="links">
            <a href="https://developers.cloudflare.com/agents/concepts/human-in-the-loop/">Cloudflare HITL</a>
            <a href="https://developers.cloudflare.com/agents/api-reference/observability/">Agents observability</a>
            <a href="https://github.com/cloudflare/agents/issues/1148">agents#1148</a>
            <a href="https://github.com/cloudflare/agents/issues/1486">agents#1486</a>
          </div>
        </div>

        <div class="panel">
          <h2>Human review gate</h2>
          <div id="proposal" class="proposal">
            <p class="empty">Run the trigger to see the agent's proposal, exact payload, diff, risk, and approval controls.</p>
          </div>
        </div>

        <div class="panel">
          <h2>Live agent progress</h2>
          <div id="answer" class="metric-row">
            <p class="empty">No run yet.</p>
          </div>
        </div>
      </section>

      <section class="grid" style="margin-top: 16px;">
        <div class="panel">
          <h2>Atrib value layer</h2>
          <div class="value-props">
            <div class="prop">
              <strong>Autonomous trigger context</strong>
              <span>The audit starts before the proposal, at the webhook or scheduled follow-up that woke the agent.</span>
            </div>
            <div class="prop">
              <strong>Decision context</strong>
              <span>The reviewer sees the exact payload and risk before the agent resumes.</span>
            </div>
            <div class="prop">
              <strong>Signer separation</strong>
              <span>Agent trigger/proposal, human decision, and action MCP execution carry distinct keys.</span>
            </div>
          </div>
        </div>
        <div class="panel">
          <h2>Signed timeline</h2>
          <div id="timeline" class="timeline">
            <p class="empty">Signed records will appear here as the workflow runs.</p>
          </div>
        </div>
        <div class="panel">
          <h2>Receipts and proofs</h2>
          <div id="receipts" class="json">
            <p class="empty">Open a receipt to inspect the record and Merkle proof.</p>
          </div>
        </div>
      </section>
    </main>

    <script type="module">
      let currentRun = null;
      let busy = false;
      let currentStep = 'trigger';

      const statusDot = document.querySelector('#statusDot');
      const statusTitle = document.querySelector('#statusTitle');
      const statusDetail = document.querySelector('#statusDetail');
      const workflowSteps = document.querySelector('#workflowSteps');
      const proposalEl = document.querySelector('#proposal');
      const answerEl = document.querySelector('#answer');
      const timelineEl = document.querySelector('#timeline');
      const receiptsEl = document.querySelector('#receipts');
      const createButton = document.querySelector('#create');
      const resetButton = document.querySelector('#reset');
      const promptInput = document.querySelector('#prompt');
      const simulateErrorInput = document.querySelector('#simulateError');

      function renderSteps(step, kind = 'pending') {
        currentStep = step;
        const order = ['trigger', 'autonomous', 'halt', 'resume', 'audit'];
        const activeIndex = order.indexOf(step);
        workflowSteps.querySelectorAll('.step').forEach((item) => {
          const itemIndex = order.indexOf(item.dataset.step);
          item.className = 'step';
          if (itemIndex < activeIndex) item.classList.add('done');
          if (item.dataset.step === step) {
            item.classList.add(step === 'halt' ? 'halted' : kind === 'error' ? 'error' : 'active');
          }
        });
      }

      function setStatus(title, kind = 'pending', detail = '', step = currentStep) {
        statusDot.className = 'dot ' + kind;
        statusTitle.textContent = title;
        statusDetail.textContent = detail || 'The workflow is waiting for the next action.';
        renderSteps(step, kind);
      }

      function updateControls(activeLabel = '') {
        const hasRun = currentRun !== null;
        const hasPendingApproval = currentRun?.status === 'pending_approval';
        const canSetFailureMode = !hasRun || hasPendingApproval;
        createButton.disabled = busy || hasRun;
        createButton.textContent = busy && activeLabel === 'create' ? 'Running trigger...' : 'Run prior trigger';
        resetButton.disabled = busy || !hasRun;
        promptInput.disabled = busy || hasRun;
        simulateErrorInput.disabled = busy || !canSetFailureMode;
        const approve = document.querySelector('#approve');
        const reject = document.querySelector('#reject');
        if (approve) {
          approve.disabled = busy || !hasPendingApproval;
          approve.textContent = busy && activeLabel === 'approve' ? 'Resuming agent...' : 'Approve and resume';
        }
        if (reject) {
          reject.disabled = busy || !hasPendingApproval;
          reject.textContent = busy && activeLabel === 'reject' ? 'Rejecting...' : 'Reject';
        }
      }

      function setBusy(next, activeLabel = '') {
        busy = next;
        document.body.classList.toggle('busy', busy);
        document.body.setAttribute('aria-busy', String(busy));
        updateControls(activeLabel);
      }

      async function post(path, body = {}) {
        const response = await fetch(path, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!response.ok) throw new Error(await response.text());
        return response.json();
      }

      function shortHash(hash) {
        if (!hash) return 'missing';
        return hash.slice(0, 18) + '...' + hash.slice(-8);
      }

      function pretty(value) {
        return JSON.stringify(value, null, 2);
      }

      function runStateCopy(run) {
        switch (run.status) {
          case 'pending_approval':
            return {
              title: 'Halted for human review',
              detail: 'The agent has stopped before publishing. Approval resumes execution through the action MCP.',
            };
          case 'succeeded':
            return {
              title: 'Execution resumed and completed',
              detail: 'The trigger, proposal, approval, execution, outcome, and handoff are all signed below.',
            };
          case 'failed':
            return {
              title: 'Execution resumed and failed',
              detail: 'The signed diagnostic record explains the changed issue thread.',
            };
          case 'rejected':
            return {
              title: 'Rejected before execution',
              detail: 'The human decision is signed. The agent did not run the MCP action.',
            };
          default:
            return {
              title: run.status.replaceAll('_', ' '),
              detail: 'The signed trace is updating.',
            };
        }
      }

      function setStatusForRun(run) {
        if (run.status === 'pending_approval') {
          setStatus('Halted for human review', 'pending', 'Autonomous triage is complete. Review the payload before the agent can resume.', 'halt');
          return;
        }
        if (run.status === 'succeeded') {
          setStatus('Trace complete', 'ok', 'The approved execution, outcome, and handoff records are signed and ready to inspect.', 'audit');
          return;
        }
        if (run.status === 'failed') {
          setStatus('Diagnostic trace complete', 'error', 'The approved action failed, and the signed outcome explains why.', 'audit');
          return;
        }
        if (run.status === 'rejected') {
          setStatus('Rejected', 'error', 'The human decision is signed. No execution ran.', 'audit');
          return;
        }
        setStatus(run.status.replaceAll('_', ' '), 'pending', 'The workflow is still running.', 'resume');
      }

      function renderProposal(run) {
        const proposal = run.records.find((record) => record.label === 'proposal');
        const body = proposal?.body ?? {};
        const payload = body.proposed_payload ?? {};
        const before = payload.before ?? {};
        const after = payload.after ?? {};
        const disabled = run.status !== 'pending_approval';
        const state = runStateCopy(run);
        proposalEl.innerHTML = \`
          <div class="run-state \${run.status === 'pending_approval' ? 'halt' : run.status === 'succeeded' ? 'ok' : ''}">
            <strong>\${state.title}</strong>
            <span>\${state.detail}</span>
          </div>
          <div class="metric">
            <span class="label">Agent proposal</span>
            <span class="value">\${body.action ?? 'No action'}</span>
          </div>
          <div class="metric">
            <span class="label">Risk</span>
            <span class="value">\${body.risk ?? 'requires_human_approval'}</span>
          </div>
          <div class="diff">
            <div>
              <span class="label">Before</span>
              <pre>\${pretty(before)}</pre>
            </div>
            <div>
              <span class="label">After</span>
              <pre>\${pretty(after)}</pre>
            </div>
          </div>
          <div class="metric">
            <span class="label">Payload hash</span>
            <span class="hash">\${body.proposed_payload_hash ?? 'missing'}</span>
          </div>
          <div class="actions">
            <button class="primary" id="approve" \${disabled ? 'disabled' : ''}>Approve and resume</button>
            <button class="danger" id="reject" \${disabled ? 'disabled' : ''}>Reject</button>
          </div>
        \`;
        document.querySelector('#approve')?.addEventListener('click', async () => {
          await transition({
            title: 'Agent resumed',
            detail: 'The human approval is signed. The action MCP is publishing the approved issue reply.',
            step: 'resume',
            activeLabel: 'approve',
            fn: async () => post('/api/runs/' + run.run_id + '/approve', {
              reason: 'Payload matches the issue scope and expected Cloudflare support target.',
              simulate_error: simulateErrorInput.checked,
            }),
          });
        });
        document.querySelector('#reject')?.addEventListener('click', async () => {
          await transition({
            title: 'Signing rejection',
            detail: 'The human decision is being signed. No execution will run.',
            step: 'review',
            activeLabel: 'reject',
            fn: async () => post('/api/runs/' + run.run_id + '/reject', {
              reason: 'This issue reply should not be published.',
            }),
          });
        });
        updateControls();
      }

      function renderAnswer(run) {
        const answer = run.trace_packet.answer;
        const publicUrl = run.trace_packet.handoff?.public_context_url;
        const auditReady = ['succeeded', 'failed', 'rejected'].includes(run.status);
        const labels = new Set(run.records.map((record) => record.label));
        const stageRows = [
          {
            title: 'Prior trigger received',
            detail: labels.has('trigger') ? 'GitHub issue webhook or scheduled follow-up woke the agent.' : 'Waiting for trigger.',
            done: labels.has('trigger'),
          },
          {
            title: 'Autonomous triage complete',
            detail: labels.has('proposal') ? 'Agent classified the issue and prepared a publishable action candidate.' : 'Agent has not planned yet.',
            done: labels.has('proposal'),
          },
          {
            title: run.status === 'pending_approval' ? 'Halted at HITL gate' : 'Human review recorded',
            detail: answer.decision ? 'Decision: ' + answer.decision : 'Execution is stopped until a human signs approval or rejection.',
            done: Boolean(answer.decision),
            halted: run.status === 'pending_approval',
          },
          {
            title: answer.executed ? 'Agent resumed through MCP' : 'Resume not started',
            detail: answer.executed ? 'The action MCP ran only after approval.' : 'Rejected or waiting for approval.',
            done: answer.executed,
          },
          {
            title: auditReady ? 'Audit ready' : 'Audit assembling',
            detail: auditReady
              ? 'Public log context and trace JSON are ready.'
              : 'Receipts appear as the run progresses; terminal audit waits for a decision.',
            done: auditReady,
          },
        ];
        answerEl.innerHTML = \`
          <div class="metric-row">
            <div class="metric">
              <span class="label">Current state</span>
              <span class="value">\${run.status}</span>
            </div>
            <div class="metric">
              <span class="label">Execution result</span>
              <span class="value">\${answer.executed ? answer.outcome : 'not run'}</span>
            </div>
          </div>
          <div class="progress-list">
            \${stageRows.map((row) => \`
              <div class="progress-item \${row.halted ? 'halted' : ''}">
                <span class="dot \${row.done ? 'ok' : row.halted ? 'pending' : 'pending'}"></span>
                <div>
                  <strong>\${row.title}</strong>
                  <span>\${row.detail}</span>
                </div>
              </div>
            \`).join('')}
          </div>
          <div class="metric">
            <span class="label">Changed rows</span>
            <span class="value">\${answer.changed.length ? answer.changed.join(', ') : 'none'}</span>
          </div>
          \${auditReady && publicUrl ? '<div class="links"><a href="' + publicUrl + '">Public log context</a><a href="/api/runs/' + run.run_id + '">Trace JSON</a></div>' : ''}
        \`;
      }

      function renderTimeline(run) {
        timelineEl.innerHTML = run.trace_packet.timeline.length
          ? run.trace_packet.timeline.map((entry) => \`
              <button class="event" data-hash="\${entry.record_hash}">
            <span class="event-head">
              <strong>\${entry.label}</strong>
              <span class="pill">\${entry.signer}</span>
            </span>
            <span class="hash">\${shortHash(entry.record_hash)}</span>
            <span class="value">informed by: \${entry.informed_by.length ? entry.informed_by.map(shortHash).join(', ') : 'genesis'}</span>
            <span class="event-action">View signed record and proof</span>
          </button>
        \`).join('')
          : '<p class="empty">No signed records yet.</p>';
        timelineEl.querySelectorAll('.event').forEach((button) => {
          button.addEventListener('click', () => {
            const record = run.records.find((item) => item.record_hash === button.dataset.hash);
            timelineEl.querySelectorAll('.event').forEach((item) => item.classList.remove('selected'));
            button.classList.add('selected');
            receiptsEl.innerHTML = '<pre>' + pretty(record) + '</pre>';
          });
        });
      }

      function render(run) {
        currentRun = run;
        renderProposal(run);
        renderAnswer(run);
        renderTimeline(run);
        setStatusForRun(run);
        updateControls();
      }

      async function transition({ title, detail, step, activeLabel = '', fn }) {
        if (busy) return;
        try {
          setBusy(true, activeLabel);
          setStatus(title, 'pending', detail, step);
          const run = await fn();
          render(run);
        } catch (error) {
          setStatus('Workflow error', 'error', 'The request failed before the trace could complete.', step ?? currentStep);
          receiptsEl.innerHTML = '<pre>' + String(error?.message ?? error) + '</pre>';
        } finally {
          setBusy(false);
        }
      }

      createButton.addEventListener('click', async () => {
        await transition({
          title: 'Autonomous triage running',
          detail: 'The prior trigger is signed. The agent is classifying the issue and preparing a proposal.',
          step: 'autonomous',
          activeLabel: 'create',
          fn: () => post('/api/runs', {
            prompt: promptInput.value,
          }),
        });
      });

      resetButton.addEventListener('click', () => {
        if (busy) return;
        currentRun = null;
        proposalEl.innerHTML = '<p class="empty">Run the trigger to see the agent\\'s proposal, exact payload, diff, risk, and approval controls.</p>';
        answerEl.innerHTML = '<p class="empty">No run yet.</p>';
        timelineEl.innerHTML = '<p class="empty">Signed records will appear here as the workflow runs.</p>';
        receiptsEl.innerHTML = '<p class="empty">Open a receipt to inspect the record and Merkle proof.</p>';
        setStatus('Ready', 'pending', 'Run the prior trigger to start autonomous triage before the human review gate.', 'trigger');
        updateControls();
      });

      updateControls();
    </script>
  </body>
</html>`
}
