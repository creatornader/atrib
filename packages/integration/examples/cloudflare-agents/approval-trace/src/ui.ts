export function renderApp(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Cloudflare Agent Trace</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #eef2f7;
        --panel: #ffffff;
        --panel-strong: #101827;
        --line: #d3dce8;
        --line-strong: #aebccc;
        --text: #10141f;
        --muted: #526178;
        --blue: #245dd8;
        --green: #12704f;
        --amber: #b75b00;
        --orange: #f38020;
        --red: #b91c35;
        --ink: #202939;
        --soft: #f3f6fa;
        --soft-blue: #edf4ff;
        --shadow: 0 18px 50px rgba(25, 34, 51, 0.1);
        --shadow-tight: 0 10px 26px rgba(25, 34, 51, 0.08);
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        background:
          linear-gradient(180deg, #f8fafc 0, #eef2f7 320px, #e8edf4 100%),
          var(--bg);
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
        min-height: 100vh;
        padding: 22px 24px 32px;
      }

      .hero {
        align-items: center;
        background:
          linear-gradient(135deg, #101827 0%, #172136 58%, #24314b 100%),
          var(--panel-strong);
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 8px;
        box-shadow: var(--shadow);
        display: grid;
        gap: 18px;
        grid-template-columns: minmax(0, 1fr) auto;
        margin-bottom: 14px;
        overflow: hidden;
        padding: 22px 24px;
        position: relative;
      }

      .hero::after {
        background: #f38020;
        bottom: 0;
        content: "";
        height: 4px;
        left: 0;
        position: absolute;
        width: 100%;
      }

      h1 {
        color: #fff;
        font-size: 30px;
        letter-spacing: 0;
        line-height: 1.15;
        margin: 0 0 8px;
      }

      .sub {
        color: #cbd5e1;
        font-size: 14px;
        line-height: 1.5;
        margin: 0;
        max-width: 820px;
      }

      .workflow-rail {
        align-items: center;
        background: rgba(255, 255, 255, 0.94);
        border: 1px solid var(--line);
        border-radius: 8px;
        box-shadow: var(--shadow-tight);
        display: flex;
        gap: 18px;
        justify-content: space-between;
        margin-bottom: 14px;
        min-height: 74px;
        padding: 14px 16px;
      }

      .status-chip {
        align-items: center;
        background: rgba(255, 247, 237, 0.12);
        border: 1px solid rgba(251, 146, 60, 0.48);
        border-radius: 999px;
        color: #fed7aa;
        display: inline-flex;
        font-size: 12px;
        font-weight: 800;
        min-height: 28px;
        padding: 7px 11px;
      }

      .rail-main {
        align-items: center;
        display: flex;
        gap: 13px;
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
        background: var(--soft-blue);
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
        height: 10px;
        width: 10px;
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
        gap: 14px;
        grid-template-columns: minmax(330px, 0.9fr) minmax(420px, 1.18fr) minmax(360px, 1fr);
      }

      .panel {
        background: rgba(255, 255, 255, 0.96);
        border: 1px solid var(--line);
        border-radius: 8px;
        box-shadow: var(--shadow-tight);
        min-width: 0;
        padding: 16px;
        position: relative;
      }

      .panel::before {
        background: var(--orange);
        border-radius: 8px 8px 0 0;
        content: "";
        height: 3px;
        left: -1px;
        position: absolute;
        right: -1px;
        top: -1px;
      }

      .panel h2 {
        color: #121826;
        font-size: 13px;
        letter-spacing: 0.08em;
        margin: 1px 0 14px;
        text-transform: uppercase;
      }

      .prompt {
        display: grid;
        gap: 10px;
      }

      textarea {
        background: #fbfdff;
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
        border-radius: 7px;
        display: inline-flex;
        font-weight: 750;
        justify-content: center;
        min-height: 40px;
        padding: 10px 13px;
      }

      .primary {
        background: #245dd8;
        box-shadow: 0 10px 22px rgba(36, 93, 216, 0.22);
        color: #fff;
      }

      .secondary {
        background: #eef3f8;
        border-color: var(--line);
        color: var(--ink);
      }

      .danger {
        background: #fff1f2;
        border-color: #fecdd3;
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
        gap: 9px;
      }

      .progress-item {
        align-items: start;
        background: #fbfdff;
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
        background: #f8fafc;
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
        background: #0f172a;
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
        background: #fbfdff;
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
        background: #fbfdff;
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
        background: #eef3f8;
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

      .hero {
        background: rgba(255, 255, 255, 0.97);
        border-color: var(--line);
        box-shadow: var(--shadow-tight);
        padding: 12px 16px;
      }

      .hero::after {
        content: none;
      }

      .brand-row,
      .header-meta {
        align-items: center;
        display: flex;
        gap: 14px;
        min-width: 0;
      }

      .cloud-mark {
        color: var(--orange);
        flex: 0 0 auto;
        height: 32px;
        width: 38px;
      }

      .hero h1 {
        color: var(--text);
        font-size: 20px;
        margin: 0;
      }

      .hero .sub {
        color: var(--muted);
        font-size: 12px;
        margin-top: 2px;
      }

      .header-meta {
        flex-wrap: wrap;
        font-size: 13px;
        justify-content: end;
      }

      .meta-pill {
        align-items: center;
        background: #fff;
        border: 1px solid var(--line);
        border-radius: 7px;
        display: inline-flex;
        gap: 8px;
        min-height: 32px;
        padding: 7px 10px;
      }

      .meta-code {
        background: #f4f7fb;
        border: 1px solid #dce5f0;
        border-radius: 6px;
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        padding: 4px 7px;
      }

      .workflow-rail {
        display: grid;
        grid-template-columns: minmax(260px, 0.9fr) minmax(0, 1.45fr);
        min-height: 92px;
        padding: 14px 18px;
      }

      .rail-stepper {
        flex-wrap: nowrap;
        gap: 8px;
      }

      .step {
        border-radius: 8px;
        min-height: 52px;
        min-width: 0;
        padding: 8px;
        width: 100%;
      }

      .step-index {
        align-items: center;
        border: 2px solid #9aa8bb;
        border-radius: 999px;
        display: inline-flex;
        height: 30px;
        justify-content: center;
        margin-right: 7px;
        vertical-align: middle;
        width: 30px;
      }

      .step-copy {
        display: inline-block;
        line-height: 1.2;
        vertical-align: middle;
      }

      .step-copy strong,
      .step-copy span {
        display: block;
      }

      .step-copy span {
        color: inherit;
        font-size: 11px;
        font-weight: 500;
        margin-top: 2px;
      }

      .step.done .step-index {
        background: var(--green);
        border-color: var(--green);
        color: #fff;
      }

      .step.active .step-index {
        border-color: var(--blue);
        color: var(--blue);
      }

      .step.halted .step-index {
        background: var(--orange);
        border-color: var(--orange);
        color: #fff;
      }

      .grid {
        grid-template-columns: minmax(320px, 0.95fr) minmax(430px, 1.35fr) minmax(360px, 1fr);
      }

      .trigger-card {
        border-bottom: 1px solid var(--line);
        display: grid;
        gap: 8px;
        margin: -4px -16px 14px;
        padding: 4px 16px 14px;
      }

      .trigger-source {
        align-items: center;
        display: flex;
        gap: 10px;
        font-weight: 800;
      }

      .trigger-details {
        display: grid;
        gap: 7px;
      }

      .detail-row {
        display: grid;
        font-size: 13px;
        gap: 8px;
        grid-template-columns: 92px minmax(0, 1fr);
      }

      .detail-row span:first-child {
        color: var(--muted);
      }

      .progress-list {
        position: relative;
      }

      .progress-item,
      .event {
        animation: itemIn 360ms ease both;
      }

      .progress-item {
        grid-template-columns: 18px minmax(0, 1fr) auto;
      }

      .progress-time {
        color: var(--muted);
        font-size: 12px;
        margin-top: 2px;
      }

      .diff {
        grid-template-columns: 1fr;
      }

      .diff pre {
        background: #fbfdff;
        border: 1px solid var(--line);
        color: #102033;
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        max-height: 310px;
      }

      .receipt-panel {
        grid-column: 1 / -1;
        padding: 0;
      }

      .receipt-toolbar {
        align-items: center;
        border-bottom: 1px solid var(--line);
        display: flex;
        gap: 10px;
        justify-content: space-between;
        padding: 10px 14px;
      }

      .receipt-shell {
        display: grid;
        grid-template-columns: minmax(360px, 1fr) minmax(360px, 1fr) minmax(320px, 0.9fr);
      }

      .receipt-section {
        min-width: 0;
        padding: 14px;
      }

      .receipt-section + .receipt-section {
        border-left: 1px solid var(--line);
      }

      .signer-list,
      .verify-list {
        display: grid;
        gap: 8px;
      }

      .signer-row,
      .verify-row {
        align-items: center;
        border: 1px solid var(--line);
        border-radius: 8px;
        display: grid;
        gap: 8px;
        grid-template-columns: 28px minmax(0, 1fr) auto;
        padding: 9px;
      }

      @keyframes itemIn {
        from {
          opacity: 0;
          transform: translateY(8px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }

      @media (prefers-reduced-motion: reduce) {
        *,
        *::before,
        *::after {
          animation-duration: 1ms !important;
          scroll-behavior: auto !important;
          transition-duration: 1ms !important;
        }
      }

      @media (max-width: 1100px) {
        .hero,
        .grid,
        .receipt-shell {
          grid-template-columns: 1fr;
        }

        .workflow-rail {
          align-items: stretch;
          display: grid;
          grid-template-columns: 1fr;
        }

        .rail-stepper {
          flex-wrap: wrap;
          justify-content: start;
        }

        .step {
          width: auto;
        }

        .receipt-section + .receipt-section {
          border-left: 0;
          border-top: 1px solid var(--line);
        }
      }

      @media (max-width: 720px) {
        .shell {
          padding: 14px;
        }

        .hero {
          grid-template-columns: 1fr;
          padding: 18px;
        }

        .brand-row {
          align-items: flex-start;
        }

        .header-meta {
          display: grid;
          font-size: 12px;
          gap: 10px;
          grid-template-columns: auto minmax(0, 1fr);
          justify-content: start;
        }

        .header-meta > span {
          min-width: 0;
        }

        .header-meta .meta-code {
          display: inline-block;
          max-width: 150px;
          overflow: hidden;
          text-overflow: ellipsis;
          vertical-align: bottom;
          white-space: nowrap;
        }

        h1 {
          font-size: 24px;
        }

        .diff {
          grid-template-columns: 1fr;
        }
      }
    </style>
  </head>
  <body>
    <main class="shell" data-testid="approval-trace-app">
      <section class="hero">
        <div class="brand-row">
          <svg class="cloud-mark" viewBox="0 0 48 32" aria-hidden="true">
            <path fill="currentColor" d="M15.4 25.5h27.8c2.4 0 4.3-1.8 4.3-4.1 0-2.2-1.8-4.1-4-4.1-.5 0-1 .1-1.5.3C40.5 10.5 34.1 5 26.5 5c-7.2 0-13.3 5-14.9 11.7-.6-.2-1.3-.3-2-.3A7.4 7.4 0 0 0 2.3 24c0 .5.4.9.9.9h8.2c.7-3.9 4.1-6.9 8.2-6.9h3.8c.7 0 1.2.5 1.2 1.2s-.5 1.2-1.2 1.2h-3.8a5.9 5.9 0 0 0-5.8 5.1Z"/>
          </svg>
          <div>
            <h1>Cloudflare Agent Trace</h1>
            <p class="sub">Incoming alert to autonomous triage to human review to signed MCP execution.</p>
          </div>
        </div>
        <div class="header-meta">
          <span class="meta-pill"><span class="dot ok"></span>Live run</span>
          <span>Run ID <span class="meta-code" id="runIdLabel">pending</span></span>
          <span>Region <span class="meta-code">IAD</span></span>
          <span>Started <span id="startedLabel">waiting</span></span>
        </div>
      </section>

      <section class="workflow-rail" id="workflowRail" aria-live="polite">
        <div class="rail-main">
          <span class="dot pending" id="statusDot"></span>
          <div>
            <strong id="statusTitle">Loading triggered workflow</strong>
            <p id="statusDetail">The demo starts at the incoming alert and shows the autonomous work before the human review gate.</p>
          </div>
        </div>
        <div class="rail-stepper" id="workflowSteps">
          <span class="step active" data-step="trigger"><span class="step-index">1</span><span class="step-copy"><strong>Trigger</strong><span>Incoming alert</span></span></span>
          <span class="step" data-step="autonomous"><span class="step-index">2</span><span class="step-copy"><strong>Autonomous triage</strong><span>Context and policy</span></span></span>
          <span class="step" data-step="halt"><span class="step-index">3</span><span class="step-copy"><strong>Human review halted</strong><span>Awaiting review</span></span></span>
          <span class="step" data-step="resume"><span class="step-index">4</span><span class="step-copy"><strong>MCP execution resumed</strong><span>Pending approval</span></span></span>
          <span class="step" data-step="audit"><span class="step-index">5</span><span class="step-copy"><strong>Audit ready</strong><span>Pending</span></span></span>
        </div>
      </section>

      <section class="grid">
        <div class="panel">
          <h2>Trigger and progress</h2>
          <div class="trigger-card">
            <div class="trigger-source">
              <svg width="26" height="26" viewBox="0 0 24 24" aria-hidden="true">
                <path fill="#111827" d="M12 .5A12 12 0 0 0 8.2 21.9c.6.1.8-.3.8-.6v-2.1c-3.3.7-4-1.4-4-1.4-.6-1.4-1.4-1.8-1.4-1.8-1.1-.8.1-.8.1-.8 1.2.1 1.9 1.3 1.9 1.3 1.1 1.9 2.9 1.3 3.6 1 .1-.8.4-1.3.8-1.6-2.7-.3-5.5-1.3-5.5-5.9 0-1.3.5-2.4 1.3-3.3-.1-.3-.6-1.6.1-3.3 0 0 1-.3 3.4 1.2a11.5 11.5 0 0 1 6.2 0C17.6 2 18.6 2.3 18.6 2.3c.7 1.7.2 3 .1 3.3.8.9 1.3 2 1.3 3.3 0 4.6-2.8 5.6-5.5 5.9.5.4.9 1.1.9 2.2v3.3c0 .3.2.7.8.6A12 12 0 0 0 12 .5Z"/>
              </svg>
              <span>GitHub issue webhook</span>
              <span class="pill">Verified</span>
            </div>
            <div class="trigger-details">
              <div class="detail-row"><span>Repository</span><strong>cloudflare/agents-demo</strong></div>
              <div class="detail-row"><span>Issue</span><strong>#482 Add rate limit to /v1/report</strong></div>
              <div class="detail-row"><span>Event</span><strong>issues.opened</strong></div>
              <div class="detail-row"><span>Received</span><strong id="receivedLabel">waiting</strong></div>
            </div>
          </div>
          <div id="answer" class="metric-row">
            <p class="empty">Waiting for the incoming alert.</p>
          </div>
          <div class="prompt">
            <textarea id="prompt">A GitHub issue webhook reported that /v1/report needs rate limiting before the next traffic spike.</textarea>
            <label class="toggle">
              <input id="simulateError" type="checkbox" />
              Simulate repository file change after approval
            </label>
            <div class="actions">
              <button class="primary" id="create">Replay prior trigger</button>
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
            <p class="empty">The workflow has not reached human review yet.</p>
          </div>
        </div>

        <div class="panel">
          <h2>Signed trace</h2>
          <div id="timeline" class="timeline">
            <p class="empty">Signed records will appear here as the workflow runs.</p>
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
        <div class="panel receipt-panel">
          <div class="receipt-toolbar">
            <h2 style="margin: 0;">Receipt inspector</h2>
            <span class="pill">JSON pretty</span>
          </div>
          <div class="receipt-shell">
            <div class="receipt-section json" id="receipts">
              <p class="empty">Open a receipt to inspect the record and Merkle proof.</p>
            </div>
            <div class="receipt-section" id="receiptSummary">
              <p class="empty">Summary appears after a signed record is selected.</p>
            </div>
            <div class="receipt-section" id="verification">
              <div class="verify-list">
                <div class="verify-row"><span class="pill">LOG</span><div><strong>Verify in Cloudflare Integrity Log</strong><span class="empty">Check inclusion and consistency proof</span></div><span class="event-action">Pending</span></div>
                <div class="verify-row"><span class="pill">SIG</span><div><strong>Verify receipt signature</strong><span class="empty">Validate signer and record hashes</span></div><span class="event-action">Pending</span></div>
                <div class="verify-row"><span class="pill">GET</span><div><strong>Download transparency proof</strong><span class="empty">CT-style proof for this receipt</span></div><span class="event-action">Pending</span></div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>

    <script type="module">
      let currentRun = null;
      let busy = false;
      let currentStep = 'trigger';
      let autoStarted = false;

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
      const runIdLabel = document.querySelector('#runIdLabel');
      const startedLabel = document.querySelector('#startedLabel');
      const receivedLabel = document.querySelector('#receivedLabel');
      const receiptSummaryEl = document.querySelector('#receiptSummary');
      const verificationEl = document.querySelector('#verification');

      const bootStages = [
        {
          key: 'trigger',
          title: 'Trigger received',
          detail: 'GitHub issue webhook opened the run and supplied the initial Workers route alert.',
          step: 'trigger',
        },
        {
          key: 'context',
          title: 'Context gathered',
          detail: 'The agent loaded repository, issue, and route context before planning a change.',
          step: 'autonomous',
        },
        {
          key: 'policy',
          title: 'Policy and intent analysis',
          detail: 'The agent classified the request as a repository write that must stop for review.',
          step: 'autonomous',
        },
        {
          key: 'proposal',
          title: 'Proposed action generated',
          detail: 'The agent prepared a write_file payload, diff, risk note, and payload hash.',
          step: 'autonomous',
        },
        {
          key: 'halt',
          title: 'Human review halted',
          detail: 'The workflow stopped before MCP execution and is waiting for a signed decision.',
          step: 'halt',
        },
      ];

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

      function sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
      }

      function escapeHtml(value) {
        return String(value)
          .replaceAll('&', '&amp;')
          .replaceAll('<', '&lt;')
          .replaceAll('>', '&gt;')
          .replaceAll('"', '&quot;')
          .replaceAll("'", '&#39;');
      }

      function nowTime(offsetMs = 0) {
        return new Date(Date.now() + offsetMs).toISOString().slice(11, 19) + ' UTC';
      }

      function renderBootProgress(activeIndex) {
        const rows = bootStages.map((stage, index) => {
          const done = index < activeIndex;
          const active = index === activeIndex;
          const halted = stage.key === 'halt' && active;
          return \`
            <div class="progress-item \${halted ? 'halted' : ''}">
              <span class="dot \${done ? 'ok' : active ? 'pending' : 'pending'}"></span>
              <div>
                <strong>\${stage.title}</strong>
                <span>\${stage.detail}</span>
              </div>
              <span class="progress-time">\${done || active ? nowTime(index * 900) : '-'}</span>
            </div>
          \`;
        }).join('');
        answerEl.innerHTML = '<div class="progress-list">' + rows + '</div>';
        const activeStage = bootStages[activeIndex] ?? bootStages[bootStages.length - 1];
        setStatus(activeStage.title, activeStage.key === 'halt' ? 'pending' : 'ok', activeStage.detail, activeStage.step);
        if (activeStage.key !== 'halt') {
          proposalEl.innerHTML = \`
            <div class="run-state">
              <strong>\${activeStage.title}</strong>
              <span>The agent has not reached the human review gate yet.</span>
            </div>
          \`;
        }
        timelineEl.innerHTML = \`
          <button class="event selected" type="button">
            <span class="event-head"><strong>\${activeStage.key === 'trigger' ? 'trigger.received' : 'agent.' + activeStage.key}</strong><span class="pill">agent</span></span>
            <span class="hash">record pending</span>
            <span class="value">\${activeStage.detail}</span>
          </button>
        \`;
      }

      function updateControls(activeLabel = '') {
        const hasRun = currentRun !== null;
        const hasPendingApproval = currentRun?.status === 'pending_approval';
        const canSetFailureMode = !hasRun || hasPendingApproval;
        createButton.disabled = busy || hasRun;
        createButton.textContent = busy && activeLabel === 'create' ? 'Running trigger...' : 'Replay prior trigger';
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
              detail: 'The signed diagnostic record explains the changed repository file.',
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
        const diff = payload.diff ?? pretty({ before, after });
        const disabled = run.status !== 'pending_approval';
        const state = runStateCopy(run);
        proposalEl.innerHTML = \`
          <div class="run-state \${run.status === 'pending_approval' ? 'halt' : run.status === 'succeeded' ? 'ok' : ''}">
            <strong>\${state.title}</strong>
            <span>\${state.detail}</span>
          </div>
          <div class="metric">
            <span class="label">Proposed action</span>
            <span class="value"><span class="pill">\${payload.operation ?? 'write_file'}</span> \${body.action ?? 'No action'}</span>
          </div>
          <div class="metric">
            <span class="label">Target</span>
            <span class="value"><span class="meta-code">\${payload.target_file ?? 'missing'}</span></span>
          </div>
          <div class="metric">
            <span class="label">Risk</span>
            <span class="value">\${body.risk ?? 'requires_human_approval'}</span>
          </div>
          <div class="diff">
            <div>
              <span class="label">Diff (unified)</span>
              <pre>\${escapeHtml(diff)}</pre>
            </div>
          </div>
          <div class="metric">
            <span class="label">Payload hash</span>
            <span class="hash">\${body.proposed_payload_hash ?? 'missing'}</span>
          </div>
          <div class="actions">
            <button class="primary" id="approve" \${disabled ? 'disabled' : ''}>Approve and resume</button>
            <button class="danger" id="reject" \${disabled ? 'disabled' : ''}>Reject</button>
            <button class="secondary" id="requestChanges" \${disabled ? 'disabled' : ''}>Request changes</button>
          </div>
        \`;
        document.querySelector('#approve')?.addEventListener('click', async () => {
          await transition({
            title: 'Agent resumed',
            detail: 'The human approval is signed. The action MCP is applying the approved file update.',
            step: 'resume',
            activeLabel: 'approve',
            fn: async () => post('/api/runs/' + run.run_id + '/approve', {
              reason: 'Payload matches the issue scope and expected Cloudflare repository target.',
              simulate_error: simulateErrorInput.checked,
            }),
          });
        });
        document.querySelector('#reject')?.addEventListener('click', async () => {
          await transition({
            title: 'Signing rejection',
            detail: 'The human decision is being signed. No execution will run.',
            step: 'halt',
            activeLabel: 'reject',
            fn: async () => post('/api/runs/' + run.run_id + '/reject', {
              reason: 'This repository file update should not be applied.',
            }),
          });
        });
        document.querySelector('#requestChanges')?.addEventListener('click', async () => {
          await transition({
            title: 'Requesting changes',
            detail: 'The human decision is being signed as a no-execute review outcome.',
            step: 'halt',
            activeLabel: 'reject',
            fn: async () => post('/api/runs/' + run.run_id + '/reject', {
              reason: 'The reviewer requested a smaller repository file update.',
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
            title: 'Trigger received',
            detail: labels.has('trigger') ? 'GitHub issue webhook or scheduled follow-up woke the agent.' : 'Waiting for trigger.',
            done: labels.has('trigger'),
          },
          {
            title: 'Context gathered',
            detail: labels.has('proposal') ? 'Repository, issue, and Workers route context loaded.' : 'Waiting for context.',
            done: labels.has('proposal'),
          },
          {
            title: 'Policy and intent analysis',
            detail: labels.has('proposal') ? 'Repository writes require human review before MCP execution.' : 'Waiting for policy analysis.',
            done: labels.has('proposal'),
          },
          {
            title: 'Proposed action generated',
            detail: labels.has('proposal') ? 'Agent prepared a write_file payload, diff, risk note, and payload hash.' : 'Agent has not planned yet.',
            done: labels.has('proposal'),
          },
          {
            title: run.status === 'pending_approval' ? 'Human review halted' : 'Human review recorded',
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
                <span class="progress-time">\${row.done || row.halted ? nowTime(0) : '-'}</span>
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
        const signers = [
          { name: 'Agent', detail: 'agents/triage@1.4.2', status: run.records.some((record) => record.signer === 'agent') ? 'Signed' : 'Pending' },
          { name: 'Human', detail: 'reviewer@example.com', status: run.records.some((record) => record.signer === 'human') ? 'Signed' : 'Pending' },
          { name: 'Action MCP', detail: 'github.write@2.3.1', status: run.records.some((record) => record.signer === 'action_mcp') ? 'Signed' : 'Pending' },
        ];
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
        \`).join('') + \`
          <div class="signer-list">
            \${signers.map((signer) => \`
              <div class="signer-row">
                <span class="pill">\${signer.name.slice(0, 1)}</span>
                <div><strong>\${signer.name}</strong><span class="empty">\${signer.detail}</span></div>
                <span class="pill">\${signer.status}</span>
              </div>
            \`).join('')}
          </div>
        \`
          : '<p class="empty">No signed records yet.</p>';
        timelineEl.querySelectorAll('.event').forEach((button) => {
          button.addEventListener('click', () => {
            const record = run.records.find((item) => item.record_hash === button.dataset.hash);
            timelineEl.querySelectorAll('.event').forEach((item) => item.classList.remove('selected'));
            button.classList.add('selected');
            receiptsEl.innerHTML = '<pre>' + pretty(record) + '</pre>';
            receiptSummaryEl.innerHTML = \`
              <div class="metric-row">
                <div class="metric"><span class="label">Selected record</span><span class="value">\${record?.label ?? 'missing'}</span></div>
                <div class="metric"><span class="label">Signer</span><span class="value">\${record?.signer ?? 'missing'}</span></div>
                <div class="metric"><span class="label">Record hash</span><span class="hash">\${record?.record_hash ?? 'missing'}</span></div>
                <div class="metric"><span class="label">Proof status</span><span class="value">\${record?.proof ? 'public proof included' : 'local proof disabled or pending'}</span></div>
              </div>
            \`;
            verificationEl.querySelectorAll('.event-action').forEach((item) => {
              item.textContent = record?.proof ? 'Ready' : 'Local';
            });
          });
        });
      }

      function render(run) {
        currentRun = run;
        runIdLabel.textContent = run.run_id;
        const started = run.records[0]?.record?.timestamp
          ? new Date(run.records[0].record.timestamp).toISOString().replace('T', ' ').slice(0, 19) + ' UTC'
          : 'pending';
        startedLabel.textContent = started;
        receivedLabel.textContent = started;
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
        await startTriggeredRun();
      });

      async function startTriggeredRun() {
        if (busy) return;
        try {
          setBusy(true, 'create');
          currentRun = null;
          runIdLabel.textContent = 'pending';
          startedLabel.textContent = nowTime(0);
          receivedLabel.textContent = nowTime(0);
          receiptsEl.innerHTML = '<p class="empty">Open a receipt to inspect the record and Merkle proof.</p>';
          receiptSummaryEl.innerHTML = '<p class="empty">Summary appears after a signed record is selected.</p>';
          verificationEl.querySelectorAll('.event-action').forEach((item) => {
            item.textContent = 'Pending';
          });
          const runPromise = post('/api/runs', {
            prompt: promptInput.value,
          });
          for (let index = 0; index < bootStages.length; index += 1) {
            renderBootProgress(index);
            await sleep(index === bootStages.length - 1 ? 260 : 520);
          }
          const run = await runPromise;
          render(run);
        } catch (error) {
          setStatus('Workflow error', 'error', 'The request failed before the trace could complete.', currentStep);
          receiptsEl.innerHTML = '<pre>' + escapeHtml(String(error?.message ?? error)) + '</pre>';
        } finally {
          setBusy(false);
        }
      }

      resetButton.addEventListener('click', () => {
        if (busy) return;
        currentRun = null;
        runIdLabel.textContent = 'pending';
        startedLabel.textContent = 'waiting';
        receivedLabel.textContent = 'waiting';
        proposalEl.innerHTML = '<p class="empty">Run the trigger to see the agent\\'s proposal, exact payload, diff, risk, and approval controls.</p>';
        answerEl.innerHTML = '<p class="empty">No active run.</p>';
        timelineEl.innerHTML = '<p class="empty">Signed records will appear here as the workflow runs.</p>';
        receiptsEl.innerHTML = '<p class="empty">Open a receipt to inspect the record and Merkle proof.</p>';
        receiptSummaryEl.innerHTML = '<p class="empty">Summary appears after a signed record is selected.</p>';
        verificationEl.querySelectorAll('.event-action').forEach((item) => {
          item.textContent = 'Pending';
        });
        setStatus('Ready for incoming alert', 'pending', 'Run the prior trigger to start autonomous triage before the human review gate.', 'trigger');
        updateControls();
      });

      updateControls();
      if (!autoStarted) {
        autoStarted = true;
        requestAnimationFrame(() => {
          startTriggeredRun();
        });
      }
    </script>
  </body>
</html>`
}
