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
        --bg: #f5f7fb;
        --panel: #ffffff;
        --panel-strong: #101827;
        --line: #d8dee8;
        --line-strong: #aeb8c7;
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
        font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Inter", "Segoe UI", sans-serif;
        max-width: 100%;
        overflow-x: hidden;
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

      .progress-item > div > span {
        display: none;
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
        flex: 0 0 auto;
        font-size: 12px;
        font-weight: 750;
        min-height: 24px;
        padding: 4px 8px;
        white-space: nowrap;
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

      button.event-action,
      a.event-action {
        align-items: center;
        background: transparent;
        border: 0;
        color: var(--blue);
        display: inline-flex;
        font: inherit;
        font-size: 12px;
        font-weight: 750;
        justify-content: flex-end;
        padding: 0;
        text-decoration: none;
        white-space: nowrap;
      }

      button.event-action:not(:disabled),
      a.event-action {
        cursor: pointer;
      }

      button.event-action:disabled {
        color: var(--muted);
        cursor: not-allowed;
      }

      .event-action.verified {
        color: var(--green);
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

      .github-mark {
        color: #111827;
        display: block;
        flex: 0 0 auto;
        height: 25px;
        overflow: visible;
        width: 25px;
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
        transition: background-color 160ms ease, color 160ms ease;
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
        display: block;
        min-width: 0;
        max-width: 100%;
        overflow: hidden;
        grid-template-columns: 1fr;
        width: 100%;
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

        .header-meta > span:nth-child(3) {
          margin-left: 0;
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

      /* Reference-driven polish pass: compact Cloudflare-style operations UI. */
      :root {
        --bg: #f6f8fb;
        --panel: #ffffff;
        --line: #d8e0eb;
        --line-strong: #b8c4d3;
        --text: #101623;
        --muted: #5d687a;
        --blue: #0969da;
        --green: #078861;
        --amber: #c76a00;
        --orange: #f38020;
        --red: #c52233;
        --ink: #1d2737;
        --soft: #f4f7fb;
        --soft-blue: #edf5ff;
        --shadow: 0 14px 34px rgba(18, 27, 42, 0.08);
        --shadow-tight: 0 8px 18px rgba(18, 27, 42, 0.045);
      }

      body {
        background: #fff;
        font-size: 14px;
      }

      .shell {
        margin: 0 auto;
        max-width: 1536px;
        padding: 0 0 0;
        width: 100%;
      }

      .hero {
        background: #fff;
        border-color: var(--line);
        border-radius: 8px;
        display: flex;
        gap: 22px;
        justify-content: flex-start;
        margin-bottom: 8px;
        min-height: 62px;
        overflow: visible;
        padding: 10px 28px;
        position: relative;
        z-index: 30;
      }

      .hero::after {
        content: none;
      }

      .cloud-mark {
        height: 32px;
        width: 54px;
      }

      .brand-row {
        gap: 16px;
      }

      .hero h1 {
        color: var(--text);
        font-size: 21px;
        font-weight: 780;
        margin: 0;
      }

      .hero .sub {
        display: none;
      }

      .header-meta {
        flex: 1 1 auto;
        gap: 18px;
        justify-content: flex-start;
        position: relative;
      }

      .header-meta > span:nth-child(3) {
        margin-left: auto;
      }

      .header-meta > span {
        white-space: nowrap;
      }

      .header-meta .meta-code {
        display: inline-block;
        max-width: 268px;
        overflow: hidden;
        text-overflow: ellipsis;
        vertical-align: middle;
        white-space: nowrap;
      }

      .run-id-meta {
        align-items: center;
        display: inline-flex;
        gap: 7px;
      }

      .run-id-meta .copy-icon {
        height: 16px;
        width: 16px;
      }

      .run-mode-wrap {
        display: inline-flex;
        position: relative;
        white-space: nowrap;
      }

      .meta-pill {
        gap: 8px;
      }

      button.meta-pill {
        cursor: pointer;
        font: inherit;
      }

      button.meta-pill:hover,
      button.meta-pill:focus-visible,
      button.meta-pill[aria-expanded="true"] {
        border-color: #b8c8f6;
        color: var(--blue);
        outline: 0;
      }

      .meta-pill.live-run .menu-chevron {
        color: #475569;
        height: 12px;
        margin-left: -2px;
        transition: transform 160ms ease;
        width: 12px;
      }

      .meta-pill.live-run[aria-expanded="true"] .menu-chevron {
        transform: rotate(180deg);
      }

      .region-status-dot {
        background: var(--green);
        border-radius: 999px;
        display: inline-block;
        height: 8px;
        margin-left: 6px;
        vertical-align: 1px;
        width: 8px;
      }

      .header-menu {
        align-items: center;
        background: #fff;
        border: 1px solid var(--line);
        border-radius: 999px;
        color: var(--ink);
        display: inline-flex;
        height: 32px;
        justify-content: center;
        padding: 0;
        width: 32px;
      }

      .header-menu:hover,
      .header-menu:focus-visible,
      .header-menu[aria-expanded="true"] {
        border-color: #b8c8f6;
        color: var(--blue);
        outline: 0;
      }

      .header-menu svg {
        height: 16px;
        width: 16px;
      }

      .header-actions-menu {
        background: #fff;
        border: 1px solid var(--line);
        border-radius: 8px;
        box-shadow: 0 14px 32px rgba(18, 27, 42, 0.16);
        display: grid;
        min-width: 178px;
        padding: 5px;
        position: absolute;
        right: 0;
        top: 42px;
        z-index: 1000;
      }

      .run-mode-menu {
        background: #fff;
        border: 1px solid var(--line);
        border-radius: 8px;
        box-shadow: 0 14px 32px rgba(18, 27, 42, 0.16);
        display: grid;
        left: 0;
        min-width: 178px;
        padding: 5px;
        position: absolute;
        top: 40px;
        z-index: 1000;
      }

      .header-actions-menu[hidden] {
        display: none;
      }

      .run-mode-menu[hidden] {
        display: none;
      }

      .header-actions-menu button,
      .header-actions-menu a,
      .run-mode-menu button {
        align-items: center;
        background: transparent;
        border-radius: 6px;
        color: var(--ink);
        display: flex;
        font-size: 12px;
        font-weight: 700;
        min-height: 30px;
        padding: 7px 9px;
        text-align: left;
        text-decoration: none;
        white-space: nowrap;
      }

      .header-actions-menu button:hover,
      .header-actions-menu button:focus-visible,
      .header-actions-menu a:hover,
      .header-actions-menu a:focus-visible,
      .run-mode-menu button:hover,
      .run-mode-menu button:focus-visible {
        background: #f4f7fb;
        outline: 0;
      }

      .run-mode-menu button[aria-checked="true"] {
        color: var(--green);
      }

      .meta-pill,
      .meta-code {
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.8);
      }

      .workflow-rail {
        background: transparent;
        border: 0;
        box-shadow: none;
        gap: 16px;
        grid-template-columns: 1fr;
        margin-bottom: 6px;
        min-height: 72px;
        padding: 0 30px 0;
      }

      .rail-main {
        clip: rect(0 0 0 0);
        clip-path: inset(50%);
        height: 1px;
        overflow: hidden;
        position: absolute;
        white-space: nowrap;
        width: 1px;
      }

      .rail-main .dot {
        height: 10px;
        margin-top: 3px;
        width: 10px;
      }

      .rail-main strong {
        font-size: 15px;
      }

      .rail-main p {
        font-size: 13px;
      }

      .rail-stepper {
        align-items: center;
        display: grid;
        gap: 16px;
        grid-template-columns: minmax(126px, 1fr) minmax(196px, 1.18fr) minmax(236px, 1.12fr) minmax(242px, 1.36fr) minmax(142px, 0.9fr);
        position: relative;
        width: 100%;
      }

      .step {
        align-items: center;
        background: transparent;
        border: 1px solid transparent;
        color: var(--ink);
        display: grid;
        gap: 10px;
        grid-template-columns: 38px minmax(0, 1fr);
        min-height: 64px;
        min-width: 0;
        padding: 6px 0;
        position: relative;
      }

      .step:not(:last-child)::after {
        background-image: repeating-linear-gradient(
          to right,
          #c5cfdb 0,
          #c5cfdb 4px,
          transparent 4px,
          transparent 7px
        );
        content: "";
        height: 2px;
        left: 54px;
        position: absolute;
        right: -16px;
        top: 31px;
        width: auto;
        z-index: 0;
      }

      .step.done:not(:last-child)::after {
        background: var(--green);
      }

      .step.active,
      .step.halted,
      .step.error {
        background: transparent;
        border-color: transparent;
        box-shadow: none;
      }

      .step.halted {
        background: #fff8ed;
        border-color: #f3a64e;
        border-radius: 8px;
        color: var(--ink);
        min-height: 58px;
        padding: 6px 10px;
        width: auto;
      }

      .step.halted:not(:last-child)::after {
        left: calc(100% + 1px);
        right: -16px;
        width: auto;
      }

      .step.done {
        background: transparent;
        border-color: transparent;
        color: var(--green);
      }

      .step.done .step-copy {
        color: var(--ink);
      }

      .step-index {
        background: #fff;
        flex: 0 0 auto;
        font-size: 14px;
        font-weight: 800;
        height: 38px;
        width: 38px;
        z-index: 1;
      }

      .step.done .step-index {
        color: #fff;
        font-size: 0;
        position: relative;
      }

      .step.done .step-index::after {
        content: "";
        background: currentColor;
        height: 22px;
        left: 50%;
        mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='M3.5 8.2 6.5 11 12 4.8' fill='none' stroke='black' stroke-linecap='round' stroke-linejoin='round' stroke-width='2.1'/%3E%3C/svg%3E") center / contain no-repeat;
        -webkit-mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='M3.5 8.2 6.5 11 12 4.8' fill='none' stroke='black' stroke-linecap='round' stroke-linejoin='round' stroke-width='2.1'/%3E%3C/svg%3E") center / contain no-repeat;
        position: absolute;
        top: 50%;
        transform: translate(-50%, -50%);
        width: 22px;
      }

      .step.halted .step-index {
        font-size: 0;
        position: relative;
      }

      .step.halted .step-index::before,
      .step.halted .step-index::after {
        background: #fff;
        border-radius: 2px;
        content: "";
        height: 15px;
        position: absolute;
        top: 50%;
        transform: translateY(-50%);
        width: 4px;
      }

      .step.halted .step-index::before {
        left: 13px;
      }

      .step.halted .step-index::after {
        right: 13px;
      }

      .step-copy strong {
        font-size: 14px;
        line-height: 1.15;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .step-copy span {
        font-size: 12px;
        line-height: 1.25;
      }

      .step-copy {
        background: #fff;
        display: grid;
        gap: 3px;
        justify-self: start;
        max-width: 100%;
        min-width: 0;
        padding: 0 4px;
        position: relative;
        width: max-content;
        z-index: 1;
      }

      .step.halted .step-copy {
        background: #fff8ed;
      }

      .step.done .step-copy,
      .step.active .step-copy,
      .step.error .step-copy {
        background: #fff;
      }

      .step[data-step="halt"] .step-copy strong {
        display: block;
        font-size: 14px;
        font-weight: 850;
        line-height: 1.1;
      }

      .step[data-step="halt"] .step-copy .step-number-label,
      .step[data-step="halt"] .step-copy [data-step-title] {
        display: inline;
        margin-top: 0;
      }

      .step[data-step="halt"] .step-copy .step-meta-line {
        align-items: center;
        display: flex;
        gap: 8px;
        line-height: 1;
        margin-top: 0;
        min-width: 0;
      }

      .step[data-step="halt"] [data-step-time="halt"] {
        white-space: nowrap;
      }

      .step-badge {
        background: #fff0dc;
        border: 1px solid #ffd09a;
        border-radius: 999px;
        color: #a44900;
        display: inline-flex;
        flex: 0 0 auto;
        font-size: 8px;
        font-weight: 850;
        line-height: 1;
        margin-left: 0;
        padding: 3px 6px;
        text-transform: uppercase;
        vertical-align: 1px;
        white-space: nowrap;
      }

      .step[data-step="halt"] .step-copy .step-badge {
        color: #a44900;
        font-size: 8px;
        font-weight: 850;
        line-height: 1;
        margin-top: 0;
      }

      .step-badge[hidden] {
        display: none;
      }

      .step-copy strong [data-step-title] {
        display: inline;
      }

      .step.halted + .step .step-index {
        border-color: var(--blue);
        color: var(--blue);
      }

      .step-badge.approved {
        background: #e9f8ef;
        border-color: #b9e5cb;
        color: #047857;
      }

      .step-badge.rejected {
        background: #fff1f2;
        border-color: #fecdd3;
        color: #be123c;
      }

      .step-badge.requested {
        background: #fff8ed;
        border-color: #ffd09a;
        color: #a44900;
      }

      @media (min-width: 1451px) {
        .workflow-rail {
          padding: 0 9px 0 51px;
        }

        .rail-stepper {
          grid-template-columns: 272px 244px 370px minmax(250px, 1fr) 200px;
        }

        .step.halted {
          width: 331px;
        }

        .step[data-step="halt"] .step-copy .step-meta-line {
          gap: 16px;
        }

        .step-badge,
        .step[data-step="halt"] .step-copy .step-badge {
          font-size: 10px;
          padding: 3px 4px;
        }
      }

      .grid {
        gap: 10px;
        align-items: start;
        grid-template-columns: minmax(318px, 363px) minmax(500px, 610px) minmax(340px, 523px);
        justify-content: center;
        margin: 0 10px;
      }

      .grid > .panel {
        height: 618px;
        overflow: auto;
        scrollbar-gutter: stable;
      }

      .panel {
        border-color: var(--line);
        border-radius: 8px;
        box-shadow: 0 6px 16px rgba(18, 27, 42, 0.035);
        padding: 0;
      }

      .panel::before {
        content: none;
      }

      .panel h2 {
        align-items: center;
        border-bottom: 1px solid var(--line);
        color: var(--ink);
        display: flex;
        font-size: 11.5px;
        font-weight: 800;
        gap: 7px;
        justify-content: flex-start;
        letter-spacing: 0.035em;
        margin: 0;
        min-height: 38px;
        padding: 0 14px;
      }

      .grid > .panel:first-child > h2 {
        display: flex;
      }

      .heading-pill {
        background: #fff0dc;
        border: 1px solid #ffd09a;
        border-radius: 999px;
        color: #a44900;
        font-size: 11px;
        font-weight: 800;
        letter-spacing: 0;
        padding: 3px 7px;
        text-transform: none;
      }

      .heading-pill.green {
        background: #e8f7ef;
        border-color: #b9e5cb;
        color: var(--green);
      }

      .trigger-card {
        margin: 0;
        padding: 14px 16px 15px;
      }

      .trigger-card .section-label {
        font-size: 14px;
        letter-spacing: 0;
        margin-bottom: 0;
        text-transform: none;
      }

      .trigger-source {
        font-size: 14px;
      }

      .trigger-details {
        gap: 8px;
        margin-top: 2px;
      }

      .detail-row {
        grid-template-columns: 88px minmax(0, 1fr);
      }

      #answer,
      .prompt,
      .proposal,
      .timeline,
      .value-props {
        padding: 14px 16px;
      }

      .proposal,
      .timeline {
        padding-left: 12px;
        padding-right: 12px;
      }

      .proposal {
        display: grid;
        gap: 10px;
        min-width: 0;
        overflow: hidden;
      }

      .prompt {
        border-top: 1px solid var(--line);
      }

      .prompt.compact {
        display: none;
      }

      .panel > .links {
        display: none;
      }

      .visually-hidden {
        clip: rect(0 0 0 0);
        clip-path: inset(50%);
        height: 1px;
        overflow: hidden;
        position: absolute;
        white-space: nowrap;
        width: 1px;
      }

      .control-strip {
        align-items: center;
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        justify-content: space-between;
      }

      .section-label {
        color: var(--ink);
        display: block;
        font-size: 12px;
        font-weight: 850;
        letter-spacing: 0.04em;
        margin-bottom: 4px;
        text-transform: uppercase;
      }

      textarea {
        min-height: 86px;
      }

      .metric-row {
        gap: 8px;
      }

      .metric {
        background: #f8fafc;
        border-color: #dce4ee;
        gap: 5px;
        padding: 8px 10px;
      }

      .proposal .metric {
        align-items: center;
        background: transparent;
        border: 0;
        border-radius: 0;
        column-gap: 10px;
        grid-template-columns: max-content minmax(0, 1fr);
        padding: 0;
      }

      .proposal .metric .label {
        color: var(--ink);
        font-size: 13px;
        letter-spacing: 0;
        text-transform: none;
        white-space: nowrap;
      }

      .proposal .metric .value {
        align-items: center;
        display: flex;
        gap: 8px;
        min-width: 0;
      }

      .label {
        letter-spacing: 0.04em;
      }

      .progress-list {
        gap: 0;
        padding-left: 0;
      }

      .progress-list::before {
        background: linear-gradient(180deg, #078861 0 68%, #cfd8e5 68% 100%);
        bottom: 18px;
        content: "";
        left: 9px;
        position: absolute;
        top: 18px;
        width: 2px;
      }

      .progress-item {
        animation-duration: 180ms;
        background: transparent;
        border: 0;
        border-radius: 0;
        column-gap: 9px;
        grid-template-columns: 20px minmax(0, 1fr) auto;
        padding: 9px 0;
        position: relative;
      }

      .progress-item .dot {
        align-items: center;
        border: 0;
        border-radius: 999px;
        box-shadow: none;
        box-sizing: border-box;
        display: inline-flex;
        height: 16px;
        justify-content: center;
        justify-self: center;
        margin-left: 0;
        position: relative;
        width: 16px;
        z-index: 1;
      }

      .dot.future {
        background: #fff;
      }

      .progress-item .dot.future {
        border: 1.5px solid #a8b4c3;
        box-shadow: none;
      }

      .progress-item.halted {
        background: transparent;
      }

      .progress-item.halted strong {
        color: #9a4a00;
      }

      .progress-item.proposal .dot.ok {
        background: var(--blue);
      }

      .progress-item:not(.proposal) .dot.ok {
        background: var(--green);
        color: #fff;
        font-size: 0;
      }

      .progress-item:not(.proposal) .dot.ok::after {
        content: "";
        background: currentColor;
        height: 10px;
        mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='M3.5 8.2 6.5 11 12 4.8' fill='none' stroke='black' stroke-linecap='round' stroke-linejoin='round' stroke-width='2.1'/%3E%3C/svg%3E") center / contain no-repeat;
        -webkit-mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='M3.5 8.2 6.5 11 12 4.8' fill='none' stroke='black' stroke-linecap='round' stroke-linejoin='round' stroke-width='2.1'/%3E%3C/svg%3E") center / contain no-repeat;
        position: absolute;
        width: 10px;
      }

      .progress-item.halted .dot.pending {
        background: var(--orange);
        font-size: 0;
      }

      .progress-item.halted .dot.pending::before,
      .progress-item.halted .dot.pending::after {
        background: #fff;
        border-radius: 1px;
        content: "";
        height: 8px;
        position: absolute;
        top: 50%;
        transform: translateY(-50%);
        width: 2px;
      }

      .progress-item.halted .dot.pending::before {
        left: 5px;
      }

      .progress-item.halted .dot.pending::after {
        right: 5px;
      }

      .run-state {
        background: #f8fafc;
        border-color: #dce4ee;
      }

      .proposal > .run-state.proposal-state {
        display: none;
      }

      .run-state.halt {
        background: #fff8ed;
        border-color: #f3a64e;
        box-shadow: inset 3px 0 0 var(--orange);
      }

      .diff-head {
        align-items: center;
        display: flex;
        gap: 10px;
        justify-content: space-between;
        margin-bottom: 6px;
        max-width: 100%;
        min-width: 0;
        width: 100%;
      }

      .diff-tools {
        color: var(--muted);
        display: flex;
        font-size: 12px;
        gap: 8px;
        flex: 0 0 auto;
        white-space: nowrap;
      }

      .diff-tools select,
      .diff-tools button {
        background: transparent;
        border: 0;
        border-radius: 6px;
        color: var(--muted);
        font-size: 12px;
        font-weight: 650;
        min-height: 24px;
        padding: 2px 4px;
      }

      .diff-tools select:hover,
      .diff-tools select:focus-visible,
      .diff-tools button:hover,
      .diff-tools button:focus-visible,
      .diff-tools button[aria-pressed="true"] {
        background: #f4f7fb;
        color: var(--ink);
        outline: 0;
      }

      .diff pre {
        font-size: 10px;
        line-height: 13.4px;
        max-height: 313px;
      }

      .diff-code {
        background: #fbfdff;
        border: 1px solid var(--line);
        border-radius: 8px;
        box-sizing: border-box;
        color: #102033;
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        font-size: 10px;
        line-height: 13.4px;
        max-height: 313px;
        max-width: 100%;
        height: 298px;
        overflow: auto;
        padding: 8px 0;
        width: 100%;
      }

      .diff-line {
        align-items: start;
        column-gap: 8px;
        display: grid;
        grid-template-columns: 22px minmax(0, 1fr);
        min-height: 13.4px;
        min-width: 0;
        padding: 0 12px;
        width: auto;
      }

      .diff-line-no {
        color: #94a3b8;
        font-variant-numeric: tabular-nums;
        text-align: right;
        user-select: none;
      }

      .diff-line-text {
        min-width: 0;
        white-space: pre;
      }

      .diff-code.wrap .diff-line-text {
        overflow-wrap: anywhere;
        white-space: pre-wrap;
      }

      .diff-line.add {
        background: #e9f8ef;
        color: #0b5138;
      }

      .diff-line.remove {
        background: #fff1f2;
        color: #8f1d2d;
      }

      .diff-line.meta {
        color: #667085;
      }

      .risk-bar {
        align-items: center;
        background: #fff;
        border: 1px solid #ffd09a;
        border-radius: 8px;
        display: grid;
        gap: 8px;
        grid-template-columns: auto auto minmax(0, 1fr) minmax(42px, auto);
        min-width: 0;
        padding: 8px 10px;
      }

      .risk-icon {
        color: var(--orange);
        display: inline-flex;
        height: 16px;
        width: 16px;
      }

      .risk-icon svg {
        height: 16px;
        width: 16px;
      }

      .risk-level {
        background: #fff0dc;
        border: 1px solid #ffd09a;
        border-radius: 999px;
        color: #a44900;
        font-size: 12px;
        font-weight: 800;
        padding: 2px 7px;
      }

      .risk-bar .value {
        font-size: 12px;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .risk-details-toggle {
        align-items: center;
        background: transparent;
        border: 0;
        color: var(--muted);
        cursor: pointer;
        display: inline-flex;
        font-size: 12px;
        gap: 4px;
        padding: 0;
        white-space: nowrap;
      }

      .risk-details-toggle:hover,
      .risk-details-toggle:focus-visible {
        color: var(--blue);
        outline: 0;
        text-decoration: underline;
      }

      .risk-details {
        background: #fffaf3;
        border: 1px solid #ffd09a;
        border-radius: 8px;
        color: var(--ink);
        display: grid;
        font-size: 12px;
        gap: 5px;
        line-height: 1.35;
        margin-top: -2px;
        padding: 8px 10px;
      }

      .risk-details[hidden] {
        display: none;
      }

      .primary,
      .secondary,
      .danger {
        align-items: center;
        display: flex;
        justify-content: center;
        min-height: 58px;
        padding: 10px;
        position: relative;
        text-align: left;
      }

      .actions {
        display: grid;
        grid-template-columns: minmax(190px, 1.08fr) repeat(2, minmax(0, 1fr));
        gap: 12px;
        margin-top: 6px;
        min-width: 0;
      }

      .button-content {
        align-items: center;
        display: inline-flex;
        gap: 8px;
        justify-content: center;
        max-width: 100%;
        min-width: 0;
      }

      .action-copy {
        box-sizing: border-box;
        display: grid;
        gap: 2px;
        justify-items: start;
        max-width: 100%;
        min-width: 0;
        padding: 0;
        text-align: left;
        width: auto;
      }

      .action-copy small {
        color: inherit;
        display: block;
        font-size: 9px;
        font-weight: 650;
        justify-self: start;
        line-height: 1.15;
        opacity: 0.78;
        overflow: visible;
        overflow-wrap: anywhere;
        text-overflow: clip;
        white-space: normal;
      }

      .button-label {
        display: block;
        font-size: 12px;
        font-weight: 850;
        justify-self: start;
        line-height: 1.12;
        white-space: nowrap;
      }

      .primary .button-label {
        font-size: 12px;
      }

      .primary .action-copy small {
        font-size: 9px;
        letter-spacing: 0;
        overflow: visible;
        text-overflow: clip;
        white-space: normal;
      }

      .primary {
        background: #078861;
        box-shadow: 0 10px 22px rgba(7, 136, 97, 0.18);
      }

      .secondary {
        background: #fff;
      }

      .danger {
        background: #fff;
      }

      .button-icon {
        align-self: center;
        align-items: center;
        border-radius: 999px;
        display: inline-flex;
        flex: 0 0 18px;
        height: 18px;
        justify-content: center;
        line-height: 0;
        margin-left: 0;
        margin-top: 0;
        position: static;
        width: 18px;
      }

      .button-icon svg {
        display: block;
        height: 14px;
        width: 14px;
      }

      .primary .button-icon {
        border: 0;
        color: #fff;
      }

      .danger .button-icon {
        border: 1.5px solid currentColor;
        color: var(--red);
      }

      .secondary .button-icon {
        border: 1px solid #cbd5e1;
        border-radius: 6px;
        color: #334155;
      }

      @media (min-width: 1451px) {
        .primary,
        .secondary,
        .danger {
          padding-left: 10px;
          padding-right: 10px;
        }

        .action-copy {
          max-width: 100%;
          width: auto;
        }

        .action-copy small,
        .primary .action-copy small {
          white-space: nowrap;
        }
      }

      .primary .action-copy,
      .danger .action-copy,
      .secondary .action-copy {
        align-self: center;
      }

      .record-timeline {
        display: grid;
        gap: 0;
        position: relative;
      }

      .record-timeline::before {
        background: #cfd8e5;
        bottom: 26px;
        content: "";
        left: 9px;
        position: absolute;
        top: 24px;
        width: 2px;
      }

      .event,
      .event-future {
        align-items: center;
        animation-duration: 180ms;
        background: transparent;
        border: 0;
        border-radius: 0;
        display: grid;
        gap: 7px;
        grid-template-columns: 20px 54px minmax(0, 1fr) minmax(82px, 120px);
        min-height: 44px;
        min-width: 0;
        padding: 4px 0;
      }

      .event {
        grid-template-columns: 20px 54px minmax(0, 1fr) minmax(82px, 112px) 14px;
      }

      .event:hover,
      .event:focus-visible,
      .event.selected {
        background: #fff7ec;
        border-color: transparent;
        box-shadow: none;
        outline: 0;
      }

      .event-future.selected {
        background: #fff7ec;
      }

      .event-time {
        color: var(--muted);
        font-size: 12px;
        padding-top: 4px;
      }

      .event-marker {
        align-items: center;
        background: var(--green);
        border: 0;
        border-radius: 999px;
        box-shadow: none;
        box-sizing: border-box;
        color: #fff;
        display: inline-flex;
        font-size: 10px;
        height: 18px;
        justify-content: center;
        justify-self: center;
        margin-top: 3px;
        position: relative;
        width: 18px;
        z-index: 1;
      }

      .event-marker.done::after {
        content: "";
        background: currentColor;
        height: 11px;
        mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='M3.5 8.2 6.5 11 12 4.8' fill='none' stroke='black' stroke-linecap='round' stroke-linejoin='round' stroke-width='2.1'/%3E%3C/svg%3E") center / contain no-repeat;
        -webkit-mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='M3.5 8.2 6.5 11 12 4.8' fill='none' stroke='black' stroke-linecap='round' stroke-linejoin='round' stroke-width='2.1'/%3E%3C/svg%3E") center / contain no-repeat;
        position: absolute;
        width: 11px;
      }

      .event-marker.pending {
        background: var(--orange);
        font-size: 0;
      }

      .event-marker.pending::before,
      .event-marker.pending::after {
        background: #fff;
        border-radius: 1px;
        content: "";
        height: 8px;
        position: absolute;
        top: 50%;
        transform: translateY(-50%);
        width: 2px;
      }

      .event-marker.pending::before {
        left: 6px;
      }

      .event-marker.pending::after {
        right: 6px;
      }

      .event-marker.future {
        background: #fff;
        border: 1.5px solid #a8b4c3;
        box-shadow: none;
      }

      .event-copy {
        display: grid;
        gap: 2px;
        min-width: 0;
      }

      .event-copy strong {
        font-size: 11.5px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .event-copy .value {
        color: var(--muted);
        font-size: 10.5px;
        line-height: 1.25;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .event-future strong,
      .event-future .value,
      .event-future .event-time {
        color: #7a8497;
      }

      .event-hash {
        align-self: center;
        color: #44536a;
        font-size: 11px;
        max-width: 132px;
        min-width: 0;
        overflow: hidden;
        overflow-wrap: normal;
        text-align: right;
        text-overflow: ellipsis;
        white-space: nowrap;
        word-break: normal;
      }

      .event-cue {
        align-self: center;
        color: #6b778c;
        display: inline-flex;
        height: 14px;
        justify-content: center;
        opacity: 0.85;
        width: 14px;
      }

      .event-cue::before {
        border-right: 1.5px solid currentColor;
        border-top: 1.5px solid currentColor;
        content: "";
        height: 6px;
        margin-top: 3px;
        transform: rotate(45deg);
        width: 6px;
      }

      .trace-section-label {
        color: var(--ink);
        display: block;
        font-size: 13px;
        font-weight: 800;
        margin: 0 0 8px;
      }

      .trace-header-meta {
        align-items: center;
        display: flex;
        gap: 7px;
        margin-left: auto;
        min-width: 0;
        font-size: 11px;
        letter-spacing: 0;
        text-transform: none;
        white-space: nowrap;
      }

      .trace-id {
        display: inline-block;
        max-width: 116px;
        overflow: hidden;
        text-overflow: ellipsis;
        vertical-align: middle;
        white-space: nowrap;
      }

      .signer-list,
      .trace-integrity {
        border-top: 1px solid var(--line);
        margin-top: 14px;
        padding-top: 9px;
      }

      .signer-list {
        gap: 0;
        margin-top: 14px;
      }

      .signer-list .trace-section-label {
        margin-bottom: 8px;
      }

      .signer-row {
        background: #fff;
        border-radius: 0;
        gap: 7px;
        grid-template-columns: 24px 78px minmax(88px, 1fr) minmax(52px, auto) minmax(58px, 92px) 16px;
        min-height: 31px;
        padding: 3px 8px;
        box-shadow: none;
      }

      .signer-row + .signer-row {
        border-top: 0;
      }

      .signer-list .signer-row:first-of-type {
        border-radius: 7px 7px 0 0;
      }

      .signer-list .signer-row:last-child {
        border-radius: 0 0 7px 7px;
      }

      .signer-row > * {
        min-width: 0;
      }

      .signer-row strong,
      .signer-row .empty {
        align-self: center;
      }

      .signer-row strong {
        font-size: 12px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .signer-row .empty {
        font-size: 12px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .signer-row .empty,
      .verify-row .empty {
        display: block;
      }

      .signer-icon {
        align-items: center;
        border-radius: 7px;
        display: inline-flex;
        height: 22px;
        justify-content: center;
        width: 22px;
      }

      .signer-icon svg {
        height: 15px;
        width: 15px;
      }

      .signer-icon.agent {
        background: #e8f2ff;
        color: #0969da;
      }

      .signer-icon.human {
        background: #fff3df;
        color: #c76a00;
      }

      .signer-icon.mcp {
        background: #e9f7ef;
        color: #078861;
      }

      .signer-status {
        border-color: #c7d6e8;
        font-size: 11px;
        min-height: 20px;
        padding: 2px 6px;
        justify-self: end;
      }

      .signer-status.signed {
        background: #edf5ff;
        color: #0969da;
      }

      .signer-status.pending {
        background: #fff0dc;
        border-color: #ffd09a;
        color: #a44900;
      }

      .signer-status.pending.mcp {
        background: #e9f8ef;
        border-color: #b9e5cb;
        color: #078861;
      }

      .signature-slot {
        align-self: center;
        color: var(--muted);
        font-size: 11px;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .signature-slot .hash {
        display: inline-block;
        font-size: 10px;
        max-width: 100%;
        overflow: hidden;
        text-overflow: ellipsis;
        vertical-align: bottom;
        white-space: nowrap;
      }

      .copy-icon {
        align-self: center;
        background: transparent;
        border: 0;
        color: var(--muted);
        display: inline-flex;
        height: 14px;
        justify-self: end;
        padding: 0;
        width: 14px;
      }

      button.copy-icon {
        cursor: pointer;
      }

      button.copy-icon:disabled {
        cursor: not-allowed;
        opacity: 0.45;
      }

      .copy-icon[data-copy-state="copied"] {
        color: var(--green);
      }

      .copy-icon svg {
        height: 14px;
        width: 14px;
      }

      .integrity-list {
        display: grid;
        gap: 7px;
      }

      .integrity-row {
        display: grid;
        font-size: 12px;
        gap: 8px;
        grid-template-columns: 94px minmax(0, 1fr) 16px;
        min-width: 0;
      }

      .integrity-row strong {
        color: var(--ink);
        font-weight: 700;
      }

      .integrity-row .hash {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .integrity-row .value {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .integrity-row.proof-row {
        grid-template-columns: 94px minmax(0, 1fr) auto;
      }

      .trace-integrity .event-action {
        justify-self: end;
        white-space: nowrap;
      }

      .verify-row {
        background: #fff;
      }

      .receipt-grid {
        display: block;
        margin-top: 10px;
        padding: 0;
      }

      .receipt-panel {
        grid-column: auto;
        min-height: 248px;
        scroll-margin-top: 12px;
      }

      .receipt-toolbar {
        align-items: center;
        display: flex;
        gap: 12px;
        justify-content: flex-start;
        min-height: 38px;
        padding: 0 14px;
      }

      .receipt-toolbar h2 {
        border-bottom: 0;
        min-height: auto;
        padding: 0;
      }

      .receipt-controls {
        align-items: center;
        display: flex;
        gap: 8px;
      }

      .receipt-controls .label {
        color: var(--ink);
        font-size: 12px;
        letter-spacing: 0;
        text-transform: none;
      }

      .receipt-format {
        appearance: auto;
        background: #fff;
        border: 1px solid var(--line);
        border-radius: 6px;
        color: var(--ink);
        font: inherit;
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        font-size: 12px;
        height: 26px;
        max-width: 156px;
        padding: 0 6px;
      }

      .icon-button {
        align-items: center;
        background: #fff;
        border: 1px solid var(--line);
        border-radius: 6px;
        color: var(--ink);
        display: inline-flex;
        font-size: 12px;
        font-weight: 700;
        gap: 7px;
        height: 26px;
        justify-content: center;
        padding: 0 9px;
      }

      .icon-button:disabled {
        color: var(--muted);
        cursor: not-allowed;
        opacity: 0.55;
      }

      .icon-button:not(:disabled) {
        cursor: pointer;
      }

      .icon-button:not(:disabled):hover,
      .icon-button:not(:disabled):focus-visible {
        border-color: #b9c6d6;
        box-shadow: 0 0 0 3px rgba(9, 105, 218, 0.08);
        outline: 0;
      }

      .icon-button[data-copy-state="copied"] {
        border-color: #b9e5cb;
        color: var(--green);
      }

      .icon-button.square {
        width: 28px;
        padding: 0;
      }

      .icon-button svg {
        height: 14px;
        width: 14px;
      }

      .receipt-shell {
        grid-template-columns: minmax(360px, 520px) minmax(320px, 458px) minmax(360px, 1fr);
      }

      .receipt-section {
        padding: 10px 14px;
      }

      .json pre {
        background: #fff;
        border: 1px solid var(--line);
        color: #102033;
        font-size: 12px;
        line-height: 1.38;
        max-height: 194px;
        overflow: auto;
        padding: 6px 10px;
        position: relative;
      }

      .json-line {
        display: grid;
        grid-template-columns: 24px minmax(0, 1fr);
      }

      .json-line-number {
        color: #94a3b8;
        padding-right: 10px;
        text-align: right;
        user-select: none;
      }

      .json-line-code {
        min-width: 0;
        white-space: pre;
      }

      .receipt-tabs {
        border-bottom: 1px solid var(--line);
        display: flex;
        gap: 34px;
        margin: -10px -14px 8px;
        padding: 0 26px;
      }

      .receipt-tab {
        background: transparent;
        border: 0;
        color: var(--ink);
        cursor: pointer;
        font-size: 12px;
        font-weight: 700;
        min-height: 30px;
        padding: 0;
        position: relative;
      }

      .receipt-tab.active::after {
        background: var(--orange);
        bottom: -1px;
        content: "";
        height: 2px;
        left: 0;
        position: absolute;
        right: 0;
      }

      .record-details-grid {
        display: grid;
        gap: 8px;
      }

      .record-details-grid .summary-row {
        grid-template-columns: 118px minmax(0, 1fr) auto;
      }

      .record-details-grid .summary-row .value {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .receipt-summary-grid,
      .verification-list {
        display: grid;
        gap: 6px;
      }

      .summary-row {
        display: grid;
        font-size: 12px;
        gap: 6px;
        grid-template-columns: 130px minmax(0, 1fr) auto;
        line-height: 1.18;
      }

      .summary-row .hash,
      .summary-row a {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .verify-row {
        border-radius: 7px;
        grid-template-columns: 34px minmax(0, 1fr) minmax(72px, auto);
        min-height: 40px;
        padding: 5px 9px;
      }

      .verify-row > div {
        min-width: 0;
      }

      .verify-icon {
        align-items: center;
        border: 1px solid;
        border-radius: 7px;
        display: inline-flex;
        height: 28px;
        justify-content: center;
        width: 28px;
      }

      .verify-icon svg {
        height: 15px;
        width: 15px;
      }

      .verify-icon.log {
        background: #fff;
        border-color: var(--line);
        color: #4b5563;
      }

      .verify-icon.sig {
        background: #fff;
        border-color: var(--line);
        color: #4b5563;
      }

      .verify-icon.get {
        background: #fff;
        border-color: var(--line);
        color: #4b5563;
      }

      .verify-row .event-action {
        align-items: center;
        background: transparent;
        border: 0;
        color: var(--blue);
        display: inline-flex;
        font-size: 12px;
        font-weight: 750;
        gap: 5px;
        justify-content: flex-end;
        min-width: 0;
        padding: 0;
        text-decoration: none;
        white-space: nowrap;
      }

      .verify-row .event-action:disabled {
        color: var(--muted);
        cursor: not-allowed;
      }

      .verify-row .event-action svg {
        height: 13px;
        width: 13px;
      }

      .verify-row .event-action.verified {
        color: var(--green);
      }

      .verify-row .event-action.failed {
        color: var(--red);
      }

      .verification-result {
        background: #fbfdff;
        border: 1px solid var(--line);
        border-radius: 8px;
        display: grid;
        gap: 7px;
        margin-top: 10px;
        padding: 9px 10px;
      }

      .verification-result.checking {
        background: #f7fbff;
        border-color: #cfe0f8;
      }

      .verification-result.failed {
        background: #fff7f7;
        border-color: #ffc9c9;
      }

      .verification-step {
        align-items: center;
        display: grid;
        font-size: 12px;
        gap: 7px;
        grid-template-columns: 16px minmax(0, 1fr);
      }

      .verification-step > div {
        display: grid;
        gap: 2px;
        min-width: 0;
      }

      .verification-step strong {
        display: block;
        font-size: 12px;
        line-height: 1.25;
      }

      .verification-step span:last-child {
        color: var(--muted);
        display: block;
        line-height: 1.25;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .verification-dot {
        align-items: center;
        border: 1px solid #c9d5e5;
        border-radius: 999px;
        display: inline-flex;
        height: 14px;
        justify-content: center;
        width: 14px;
      }

      .verification-dot.checking {
        animation: verifyPulse 900ms ease-in-out infinite;
        background: var(--blue);
        border-color: var(--blue);
        box-shadow: 0 0 0 3px rgba(9, 105, 218, 0.12);
      }

      .verification-dot.ok {
        background: var(--green);
        border-color: var(--green);
        color: #fff;
      }

      .verification-dot.ok::after {
        content: "";
        border: solid currentColor;
        border-width: 0 1.5px 1.5px 0;
        height: 6px;
        transform: rotate(45deg) translate(-1px, -1px);
        width: 3px;
      }

      .verification-dot.fail {
        background: var(--red);
        border-color: var(--red);
        color: #fff;
      }

      .verification-dot.fail::before {
        content: "";
        background: currentColor;
        height: 8px;
        transform: rotate(45deg);
        width: 1.5px;
      }

      .risk-heading {
        align-items: center;
        color: var(--ink);
        display: flex;
        font-size: 12px;
        font-weight: 750;
        justify-content: space-between;
        margin: 2px 0 -4px;
      }

      .risk-details-toggle svg {
        height: 12px;
        width: 12px;
      }

      @keyframes verifyPulse {
        0%,
        100% {
          opacity: 0.65;
          transform: scale(0.86);
        }
        50% {
          opacity: 1;
          transform: scale(1);
        }
      }

      @media (max-width: 1450px) and (min-width: 1101px) {
        .grid {
          grid-template-columns: minmax(318px, 0.82fr) minmax(560px, 1.2fr) minmax(340px, 0.94fr);
        }

        .actions {
          gap: 10px;
          grid-template-columns: minmax(190px, 1.12fr) repeat(2, minmax(0, 1fr));
        }

        .action-copy small,
        .primary .action-copy small {
          font-size: 8px;
          white-space: nowrap;
        }

        .event,
        .event-future {
          gap: 6px;
          grid-template-columns: 18px 48px minmax(0, 1fr) minmax(66px, 92px);
        }

        .event {
          grid-template-columns: 18px 48px minmax(0, 1fr) minmax(58px, 82px) 12px;
        }

        .record-timeline::before {
          left: 8px;
        }

        .event-hash {
          max-width: 92px;
        }

        .signer-row {
          gap: 5px;
          grid-template-columns: 22px 72px minmax(0, 1fr) minmax(46px, auto) minmax(30px, 44px) 12px;
          padding: 4px 6px;
        }

        .signer-icon {
          height: 20px;
          width: 20px;
        }

        .signer-icon svg {
          height: 13px;
          width: 13px;
        }

        .signer-row strong,
        .signer-row .empty {
          font-size: 11px;
        }

        .signature-slot {
          font-size: 10px;
        }
      }

      @media (max-width: 1100px) {
        .workflow-rail,
        .rail-stepper,
        .grid,
        .receipt-shell {
          grid-template-columns: 1fr;
        }

        .step:not(:last-child)::after {
          content: none;
        }

        .rail-stepper {
          gap: 8px;
        }
      }

      @media (max-width: 720px) {
        .hero {
          align-items: flex-start;
          flex-direction: column;
          gap: 12px;
        }

        .header-meta {
          grid-template-columns: 1fr;
          width: 100%;
        }

        .header-meta > span:nth-child(3) {
          margin-left: 0;
        }

        .event {
          grid-template-columns: 20px 48px minmax(0, 1fr);
        }

        .event-hash {
          grid-column: 3;
          justify-self: start;
        }

        .event-cue {
          display: none;
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
          <span class="run-mode-wrap">
            <button class="meta-pill live-run" id="runModeMenu" type="button" aria-label="Run mode" aria-controls="runModeActions" aria-expanded="false" aria-haspopup="menu"><span class="dot ok"></span><span>Live run</span><svg class="menu-chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="m5 6 3 3 3-3" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.7"/></svg></button>
            <div class="run-mode-menu" id="runModeActions" role="menu" hidden>
              <button type="button" role="menuitemradio" aria-checked="true" data-run-mode-action="live">Live run</button>
              <button type="button" role="menuitem" data-run-mode-action="open-json">Open trace JSON</button>
              <button type="button" role="menuitem" data-run-mode-action="reset">Reset demo</button>
            </div>
          </span>
          <span class="run-id-meta">Run ID <span class="meta-code" id="runIdLabel">pending</span><button class="copy-icon" type="button" aria-label="Copy run ID" data-copy-source="#runIdLabel" disabled><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 5V3.5A1.5 1.5 0 0 1 6.5 2h5A1.5 1.5 0 0 1 13 3.5v5A1.5 1.5 0 0 1 11.5 10H10v1.5A1.5 1.5 0 0 1 8.5 13h-5A1.5 1.5 0 0 1 2 11.5v-5A1.5 1.5 0 0 1 3.5 5H5Zm1.5 0h2A1.5 1.5 0 0 1 10 6.5v2h1.5V3.5h-5V5Zm-3 1.5v5h5v-5h-5Z" fill="currentColor"/></svg></button></span>
          <span>Region <span class="meta-code">IAD</span><span class="region-status-dot" aria-hidden="true"></span></span>
          <span>Started <span id="startedLabel">waiting</span></span>
          <button class="header-menu" id="headerMenu" type="button" aria-label="More run actions" aria-controls="headerActions" aria-expanded="false" aria-haspopup="menu"><svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="3.5" cy="8" r="1.25" fill="currentColor"/><circle cx="8" cy="8" r="1.25" fill="currentColor"/><circle cx="12.5" cy="8" r="1.25" fill="currentColor"/></svg></button>
          <div class="header-actions-menu" id="headerActions" role="menu" hidden>
            <button type="button" role="menuitem" data-header-action="copy-link">Copy run link</button>
            <button type="button" role="menuitem" data-header-action="open-json">Open trace JSON</button>
            <button type="button" role="menuitem" data-header-action="reset">Reset demo</button>
          </div>
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
          <span class="step active" data-step="trigger"><span class="step-index">1</span><span class="step-copy"><strong>1. Trigger</strong><span data-step-time="trigger">Pending</span></span></span>
          <span class="step" data-step="autonomous"><span class="step-index">2</span><span class="step-copy"><strong>2. Autonomous triage</strong><span data-step-time="autonomous">Pending</span></span></span>
          <span class="step" data-step="halt"><span class="step-index">3</span><span class="step-copy"><strong><span class="step-number-label">3. </span><span data-step-title="halt">Human review halted</span></strong><span class="step-meta-line"><span data-step-time="halt">Pending</span><span class="step-badge" data-step-badge="halt">Awaiting review</span></span></span></span>
          <span class="step" data-step="resume"><span class="step-index">4</span><span class="step-copy"><strong>4. MCP execution resumed</strong><span data-step-time="resume">Pending</span></span></span>
          <span class="step" data-step="audit"><span class="step-index">5</span><span class="step-copy"><strong>5. Audit ready</strong><span data-step-time="audit">Pending</span></span></span>
        </div>
      </section>

      <section class="grid">
        <div class="panel">
          <h2>Trigger &amp; progress</h2>
          <div class="trigger-card">
            <span class="section-label">Prior trigger</span>
            <div class="trigger-source">
              <svg class="github-mark" viewBox="-1 -1 18 18" aria-hidden="true">
                <path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82A7.65 7.65 0 0 1 8 3.87c.68 0 1.36.09 2 .26 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z"/>
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
          <div id="answer">
            <p class="empty">Waiting for the incoming alert.</p>
          </div>
          <div class="prompt compact">
            <textarea class="visually-hidden" id="prompt">A GitHub issue webhook reported that /v1/report needs rate limiting before the next traffic spike.</textarea>
            <div class="control-strip">
              <label class="toggle">
                <input id="simulateError" type="checkbox" />
                Simulate repository file change after approval
              </label>
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
          <h2>Human review (required) <span class="heading-pill" id="reviewStatePill">Waiting</span></h2>
          <div id="proposal" class="proposal">
            <p class="empty">The workflow has not reached human review yet.</p>
          </div>
        </div>

        <div class="panel">
          <h2>Signed trace <span class="heading-pill green">Verifiable</span><span class="trace-header-meta">Trace ID <span class="meta-code trace-id" id="traceIdLabel">pending</span><button class="copy-icon" type="button" aria-label="Copy trace ID" data-copy-source="#traceIdLabel" disabled><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 5V3.5A1.5 1.5 0 0 1 6.5 2h5A1.5 1.5 0 0 1 13 3.5v5A1.5 1.5 0 0 1 11.5 10H10v1.5A1.5 1.5 0 0 1 8.5 13h-5A1.5 1.5 0 0 1 2 11.5v-5A1.5 1.5 0 0 1 3.5 5H5Zm1.5 0h2A1.5 1.5 0 0 1 10 6.5v2h1.5V3.5h-5V5Zm-3 1.5v5h5v-5h-5Z" fill="currentColor"/></svg></button></span></h2>
          <div id="timeline" class="timeline">
            <p class="empty">Signed records will appear here as the workflow runs.</p>
          </div>
        </div>
      </section>

      <section class="receipt-grid">
        <div class="panel receipt-panel">
          <div class="receipt-toolbar">
            <h2>Receipt inspector</h2>
            <div class="receipt-controls">
              <span class="label">Format</span>
              <select class="receipt-format" id="receiptFormat" aria-label="Receipt format">
                <option value="pretty">JSON (pretty)</option>
                <option value="compact">JSON (compact)</option>
              </select>
              <button class="icon-button square" id="copyReceipt" type="button" aria-label="Copy receipt" disabled>
                <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 5V3.5A1.5 1.5 0 0 1 6.5 2h5A1.5 1.5 0 0 1 13 3.5v5A1.5 1.5 0 0 1 11.5 10H10v1.5A1.5 1.5 0 0 1 8.5 13h-5A1.5 1.5 0 0 1 2 11.5v-5A1.5 1.5 0 0 1 3.5 5H5Zm1.5 0h2A1.5 1.5 0 0 1 10 6.5v2h1.5V3.5h-5V5Zm-3 1.5v5h5v-5h-5Z" fill="currentColor"/></svg>
              </button>
              <button class="icon-button" id="downloadReceipt" type="button" aria-label="Download receipt" disabled>
                <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2v7m0 0 3-3m-3 3L5 6M3 12.5h10" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.6"/></svg>
                Download receipt
              </button>
            </div>
          </div>
          <div class="receipt-shell">
            <div class="receipt-section json" id="receipts">
              <p class="empty">View signed record and proof after the first trace record is selected.</p>
            </div>
            <div class="receipt-section" id="receiptSummary">
              <p class="empty">Summary appears after a signed record is selected.</p>
            </div>
            <div class="receipt-section" id="verification">
              <span class="trace-section-label">Verification</span>
              <div class="verify-list">
                <div class="verify-row"><span class="verify-icon log" aria-hidden="true"><svg viewBox="0 0 16 16"><path d="M5.2 7V5.2a2.8 2.8 0 1 1 5.6 0V7M4 7h8v6.5H4V7Zm4 3v1.4" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"/></svg></span><div><strong>Verify in Cloudflare Integrity Log</strong><span class="empty">Check inclusion and consistency proof</span></div><button class="event-action" type="button" disabled>Pending</button></div>
                <div class="verify-row"><span class="verify-icon sig" aria-hidden="true"><svg viewBox="0 0 16 16"><path d="M5 8.5 7 10l4-4.5M3.5 2.5h9v11h-9v-11Z" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"/></svg></span><div><strong>Verify receipt signature</strong><span class="empty">Validate signer and record hashes</span></div><button class="event-action" type="button" disabled>Pending</button></div>
                <div class="verify-row"><span class="verify-icon get" aria-hidden="true"><svg viewBox="0 0 16 16"><path d="M8 2.5v6m0 0 2.5-2.5M8 8.5 5.5 6M3 12.5h10" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"/></svg></span><div><strong>Download transparency proof</strong><span class="empty">CT-style proof for this receipt</span></div><button class="event-action" type="button" disabled>Pending</button></div>
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
      let autoFollow = true;
      let stageDisplayTimes = {};
      let selectedReceiptRecord = null;
      let selectedReceiptView = 'record';
      let selectedReceiptFormat = 'pretty';

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
      const reviewStatePill = document.querySelector('#reviewStatePill');
      const traceIdLabel = document.querySelector('#traceIdLabel');
      const copyReceiptButton = document.querySelector('#copyReceipt');
      const downloadReceiptButton = document.querySelector('#downloadReceipt');
      const receiptFormatSelect = document.querySelector('#receiptFormat');
      const headerMenuButton = document.querySelector('#headerMenu');
      const headerActionsMenu = document.querySelector('#headerActions');
      const runModeButton = document.querySelector('#runModeMenu');
      const runModeActionsMenu = document.querySelector('#runModeActions');

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

      const bootDisplayOffsets = {
        trigger: 0,
        context: 1200,
        policy: 2600,
        proposal: 4800,
        halt: 6200,
      };

      const recordDisplayOffsets = {
        trigger: 0,
        triage: 1200,
        proposal: 4800,
        approval: 6200,
        rejection: 6200,
        change_request: 6200,
        preview: 7400,
        execution: 8600,
        outcome: 9800,
        handoff: 11200,
      };

      const progressDisplayOffsets = {
        trigger: 0,
        context: 1200,
        policy: 2600,
        proposal: 4800,
        halt: 6200,
        resume: 8600,
        audit: 11200,
      };

      function renderSteps(step, kind = 'pending') {
        currentStep = step;
        const order = ['trigger', 'autonomous', 'halt', 'resume', 'audit'];
        const activeIndex = order.indexOf(step);
        workflowSteps.querySelectorAll('.step').forEach((item) => {
          const itemIndex = order.indexOf(item.dataset.step);
          item.className = 'step';
          const activeDone = kind === 'ok' && itemIndex === activeIndex;
          if (itemIndex < activeIndex || activeDone) item.classList.add('done');
          if (item.dataset.step === step && !activeDone) {
            item.classList.add(step === 'halt' ? 'halted' : kind === 'error' ? 'error' : 'active');
          }
        });
        updateHaltStepState();
        updateStepTimes();
      }

      function updateStepTimes(run = currentRun) {
        const trigger = run?.records.find((record) => record.label === 'trigger');
        const triage = run?.records.find((record) => record.label === 'triage');
        const proposal = run?.records.find((record) => record.label === 'proposal');
        const decision = run?.records.find((record) => record.label === 'approval' || record.label === 'rejection' || record.label === 'change_request');
        const triggerTime = stageDisplayTimes.trigger ?? (trigger ? displayRecordTime(trigger, 'trigger') + ' UTC' : 'Pending');
        const triageTime = stageDisplayTimes.context ?? (triage ? displayRecordTime(triage, 'triage') + ' UTC' : 'Pending');
        const proposalTime = stageDisplayTimes.proposal ?? (proposal ? displayRecordTime(proposal, 'proposal') + ' UTC' : 'Pending');
        const haltRecord = decision ?? proposal;
        const haltLabel = decision?.label ?? 'approval';
        const haltTime = stageDisplayTimes.halt ?? (haltRecord ? displayRecordTime(haltRecord, haltLabel) + ' UTC' : proposalTime);
        const execution = run?.records.find((record) => record.label === 'execution');
        const handoff = run?.records.find((record) => record.label === 'handoff');
        const stepTimes = {
          trigger: triggerTime,
          autonomous: triageTime,
          halt: haltTime,
          resume: execution ? displayRecordTime(execution, 'execution') + ' UTC' : 'Pending',
          audit: handoff ? displayRecordTime(handoff, 'handoff') + ' UTC' : 'Pending',
        };
        Object.entries(stepTimes).forEach(([key, value]) => {
          const target = workflowSteps.querySelector('[data-step-time="' + key + '"]');
          if (target) target.textContent = value;
        });
      }

      function updateHaltStepState(run = currentRun) {
        const title = workflowSteps.querySelector('[data-step-title="halt"]');
        const badge = workflowSteps.querySelector('[data-step-badge="halt"]');
        const haltStep = workflowSteps.querySelector('[data-step="halt"]');
        if (!title || !badge) return;
        badge.classList.remove('approved', 'rejected', 'requested');
        badge.hidden = false;
        if (!run) {
          title.textContent = 'Human review halted';
          badge.textContent = 'Awaiting review';
          badge.hidden = !haltStep?.classList.contains('halted');
          return;
        }
        if (run.status === 'pending_approval') {
          title.textContent = 'Human review halted';
          badge.textContent = 'Awaiting review';
          return;
        }
        if (run.status === 'rejected') {
          title.textContent = 'Human review rejected';
          badge.textContent = 'Rejected';
          badge.classList.add('rejected');
          return;
        }
        if (run.status === 'changes_requested') {
          title.textContent = 'Changes requested';
          badge.textContent = 'Needs revision';
          badge.classList.add('requested');
          return;
        }
        if (run.status === 'approved' || run.status === 'executing') {
          title.textContent = 'Human review approved';
          badge.textContent = 'Resuming';
          badge.classList.add('approved');
          return;
        }
        title.textContent = 'Human review approved';
        badge.textContent = 'Approved';
        badge.classList.add('approved');
      }

      function setStatus(title, kind = 'pending', detail = '', step = currentStep) {
        statusDot.className = 'dot ' + kind;
        statusTitle.textContent = title;
        statusDetail.textContent = detail || 'The workflow is waiting for the next action.';
        renderSteps(step, kind);
        if (reviewStatePill) {
          reviewStatePill.textContent = step === 'halt' ? 'Paused' : step === 'resume' ? 'Running' : step === 'audit' && kind === 'error' ? 'Needs review' : step === 'audit' ? 'Ready' : 'Waiting';
          reviewStatePill.textContent = reviewStatePill.textContent.toUpperCase();
          reviewStatePill.classList.toggle('green', step === 'audit' && kind === 'ok');
        }
      }

      function sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
      }

      function followElement(target, block = 'nearest') {
        if (!target || !autoFollow) return;
        const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        requestAnimationFrame(() => {
          target.scrollIntoView({
            behavior: reduceMotion ? 'auto' : 'smooth',
            block,
            inline: 'nearest',
          });
        });
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

      function displayRecordTime(record, label = record?.label, fallbackIndex = 0) {
        const offset = recordDisplayOffsets[label] ?? fallbackIndex * 1000;
        return formatRecordTime(record, offset);
      }

      function progressKeyForTitle(title) {
        if (title === 'Trigger received') return 'trigger';
        if (title === 'Context gathered') return 'context';
        if (title === 'Policy and intent analysis') return 'policy';
        if (title === 'Proposed action generated') return 'proposal';
        if (title === 'Human review halted' || title === 'Human review recorded') return 'halt';
        if (title === 'Agent resumed through MCP') return 'resume';
        if (title === 'Audit ready') return 'audit';
        return '';
      }

      function progressDisplayTime(run, title, active) {
        const key = progressKeyForTitle(title);
        if (key && stageDisplayTimes[key]) return stageDisplayTimes[key];
        if (!active) return '-';
        const record = progressRecordFor(run, title);
        return formatRecordTime(record, progressDisplayOffsets[key] ?? recordDisplayOffsets[record?.label ?? key] ?? 0) + ' UTC';
      }

      function formatRecordTime(record, offsetMs = 0) {
        const timestamp = record?.record?.timestamp;
        if (timestamp) return new Date(new Date(timestamp).getTime() + offsetMs).toISOString().slice(11, 19);
        return new Date(Date.now() + offsetMs).toISOString().slice(11, 19);
      }

      function bootRecordFor(key, run = currentRun) {
        if (!run) return null;
        if (key === 'trigger') return run.records.find((record) => record.label === 'trigger');
        if (key === 'context') return run.records.find((record) => record.label === 'triage');
        if (key === 'proposal' || key === 'halt') return run.records.find((record) => record.label === 'proposal');
        return null;
      }

      function renderBootTimeline(activeIndex, run = currentRun) {
        const activeStage = bootStages[activeIndex] ?? bootStages[bootStages.length - 1];
        const reached = (key) => bootStages.findIndex((stage) => stage.key === key) <= activeIndex;
        const bootRows = [
          {
            key: 'trigger',
            name: 'trigger.received',
            detail: 'GitHub issue webhook',
            time: stageDisplayTimes.trigger,
            marker: reached('trigger') ? 'done' : 'future',
            selected: activeStage.key === 'trigger',
          },
          {
            key: 'context',
            name: 'triage.completed',
            detail: 'Intent: add rate limiting',
            time: stageDisplayTimes.context ?? stageDisplayTimes.policy,
            marker: reached('context') ? 'done' : 'future',
            selected: ['context', 'policy'].includes(activeStage.key),
          },
          {
            key: 'proposal',
            name: 'proposal.generated',
            detail: 'write_file proposal',
            time: stageDisplayTimes.proposal,
            marker: reached('proposal') ? 'done' : 'future',
            selected: activeStage.key === 'proposal',
          },
          {
            key: 'halt',
            name: 'human.review.halted',
            detail: 'Awaiting human decision',
            time: stageDisplayTimes.halt,
            marker: reached('halt') ? 'pending' : 'future',
            selected: activeStage.key === 'halt',
          },
          {
            key: 'mcp',
            name: 'mcp.execution.resumed',
            detail: reached('halt') ? 'Pending approval' : 'Waiting for human review',
            time: '-',
            marker: 'future',
            selected: false,
          },
          {
            key: 'audit',
            name: 'audit.ready',
            detail: 'Pending',
            time: '-',
            marker: 'future',
            selected: false,
          },
        ];
        const bootSigners = [
          { kind: 'agent', name: 'Agent', detail: 'agents/triage@1.4.2', signer: 'agent', status: reached('proposal') ? 'Signed' : 'Pending', className: reached('proposal') ? 'signed' : 'pending mcp', sig: reached('proposal') && run ? signerSignature(run, 'agent') : '-' },
          { kind: 'human', name: 'Human', detail: 'alice@example.com', status: 'Pending', className: 'pending', sig: '-' },
          { kind: 'mcp', name: 'Action MCP', detail: 'github.write@2.3.1', status: 'Pending', className: 'pending mcp', sig: '-' },
        ];
        const merkleRoot = reached('trigger') ? run?.records[0]?.record_hash ?? '' : '';
        const logHash = reached('context') ? run?.records[1]?.record_hash ?? '' : '';
        timelineEl.innerHTML = \`
          <span class="trace-section-label">Record timeline</span>
          <div class="record-timeline">
            \${bootRows.map((row) => {
              const record = bootRecordFor(row.key, run);
              const time = row.time ?? (record ? displayRecordTime(record, record.label) + ' UTC' : '');
              const hash = row.marker === 'future' ? '-' : record ? recordDisplayId(record.record_hash) : 'pending';
              return \`
              <div class="event-future \${row.selected ? 'selected' : ''}">
                <span class="event-marker \${row.marker}"></span>
                <span class="event-time">\${time ? time.slice(0, 8) : '-'}</span>
                <span class="event-copy">
                  <strong>\${row.name}</strong>
                  <span class="value">\${row.detail}</span>
                </span>
                <span class="event-hash hash">\${hash}</span>
              </div>
            \`;
            }).join('')}
          </div>
          <div class="signer-list">
            <span class="trace-section-label">Signers</span>
            \${bootSigners.map((signer) => \`
              <div class="signer-row">
                \${signerIcon(signer.kind)}
                <strong>\${signer.name}</strong>
                <span class="empty">\${signer.detail}</span>
                <span class="pill signer-status \${signer.className}">\${signer.status}</span>
                <span class="signature-slot">Sig: <span class="hash">\${signer.sig}</span></span>\${copyIcon(run && signer.signer ? signerRecordHash(run, signer.signer) : '', signer.name + ' signature')}
              </div>
            \`).join('')}
          </div>
          <div class="trace-integrity">
            <span class="trace-section-label">Trace integrity</span>
            <div class="integrity-list">
              <div class="integrity-row"><strong>Merkle root</strong><span class="hash">\${merkleRoot || 'pending'}</span>\${copyIcon(merkleRoot, 'Merkle root')}</div>
              <div class="integrity-row"><strong>Log hash</strong><span class="hash">\${logHash || 'pending'}</span>\${copyIcon(logHash, 'log hash')}</div>
              <div class="integrity-row proof-row"><strong>Proof status</strong><span class="value">\${merkleRoot ? 'Signed records available' : 'Waiting for first signed record'}</span><span></span></div>
            </div>
          </div>
        \`;
      }

      function renderBootProgress(activeIndex, run = currentRun) {
        const rows = bootStages.map((stage, index) => {
          const done = index < activeIndex;
          const active = index === activeIndex;
          const halted = stage.key === 'halt' && active;
          if ((done || active) && !stageDisplayTimes[stage.key]) stageDisplayTimes[stage.key] = nowTime(bootDisplayOffsets[stage.key] ?? index * 1000);
          return \`
            <div class="progress-item \${halted ? 'halted' : ''} \${stage.key === 'proposal' ? 'proposal' : ''}">
              <span class="dot \${done ? 'ok' : active ? 'pending' : 'future'}"></span>
              <div>
                <strong>\${stage.title}</strong>
                <span>\${stage.detail}</span>
              </div>
              <span class="progress-time">\${done || active ? stageDisplayTimes[stage.key] : '-'}</span>
            </div>
          \`;
        }).join('');
        answerEl.innerHTML = '<span class="section-label">Agent progress</span><div class="progress-list">' + rows + '</div>';
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
        renderBootTimeline(activeIndex, run);
        followElement(answerEl.querySelectorAll('.progress-item')[activeIndex], 'nearest');
        if (activeStage.key === 'halt') followElement(proposalEl, 'nearest');
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
        const requestChanges = document.querySelector('#requestChanges');
        if (approve) {
          approve.disabled = busy || !hasPendingApproval;
          const label = approve.querySelector('.button-label');
          if (label) label.textContent = busy && activeLabel === 'approve' ? 'Resuming agent...' : 'Approve & resume';
        }
        if (reject) {
          reject.disabled = busy || !hasPendingApproval;
          const label = reject.querySelector('.button-label');
          if (label) label.textContent = busy && activeLabel === 'reject' ? 'Rejecting...' : 'Reject';
        }
        if (requestChanges) {
          requestChanges.disabled = busy || !hasPendingApproval;
          const label = requestChanges.querySelector('.button-label');
          if (label) label.textContent = busy && activeLabel === 'request' ? 'Requesting...' : 'Request changes';
        }
        updateHeaderMenuControls();
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
        const normalized = String(hash).replace(/^sha256:/, '');
        return normalized.slice(0, 18) + '...' + normalized.slice(-8);
      }

      function recordDisplayId(hash) {
        if (!hash) return '-';
        return 'rec_' + hash.replace('sha256:', '').slice(0, 12).toUpperCase() + '...';
      }

      function timelineDetail(entry, run) {
        if (entry.label === 'trigger') return 'GitHub issue webhook';
        if (entry.label === 'triage') return 'Intent: add rate limiting';
        if (entry.label === 'proposal') return 'write_file proposal';
        if (entry.label === 'approval') return 'Human approved payload';
        if (entry.label === 'rejection') return 'Human rejected payload';
        if (entry.label === 'change_request') return 'Human requested revision';
        if (entry.label === 'preview') return 'MCP preview completed';
        if (entry.label === 'execution') return run.status === 'failed' ? 'MCP execution attempted' : 'MCP execution resumed';
        if (entry.label === 'outcome') return run.status === 'failed' ? 'Diagnostic outcome signed' : 'Repository update signed';
        if (entry.label === 'handoff') return 'Audit handoff ready';
        return entry.informed_by.length ? 'Linked to prior signed record' : 'Genesis record';
      }

      function timelineLabel(entry, run) {
        if (entry.label === 'trigger') return 'trigger.received';
        if (entry.label === 'triage') return 'triage.completed';
        if (entry.label === 'proposal') return 'proposal.generated';
        if (entry.label === 'approval') return 'human.approval.signed';
        if (entry.label === 'rejection') return 'human.rejection.signed';
        if (entry.label === 'change_request') return 'human.change_request.signed';
        if (entry.label === 'preview') return 'mcp.preview.completed';
        if (entry.label === 'execution') return 'mcp.execution.resumed';
        if (entry.label === 'outcome') return run.status === 'failed' ? 'diagnostic.signed' : 'repository.update.signed';
        if (entry.label === 'handoff') return 'audit.ready';
        return entry.label;
      }

      function futureTraceRows(run) {
        const labels = new Set(run.trace_packet.timeline.map((entry) => entry.label));
        const rows = [];
        if (!labels.has('approval') && !labels.has('rejection') && !labels.has('change_request')) {
          const proposal = run.records.find((record) => record.label === 'proposal');
          rows.push({
            name: 'human.review.halted',
            detail: 'Awaiting human decision',
            marker: 'pending',
            record: proposal,
            displayLabel: 'approval',
            hash: proposal?.record_hash,
          });
        }
        if (!labels.has('execution')) {
          rows.push({ name: 'mcp.execution.resumed', detail: 'Pending approval', marker: 'future' });
        }
        if (!labels.has('handoff')) {
          rows.push({ name: 'audit.ready', detail: 'Pending', marker: 'future' });
        }
        return rows;
      }

      function signerIcon(kind) {
        if (kind === 'human') {
          return '<span class="signer-icon human"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8a7 7 0 0 1 14 0" fill="currentColor"/></svg></span>';
        }
        if (kind === 'mcp') {
          return '<span class="signer-icon mcp"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3h6v4h4v6h-4v4H9v-4H5V7h4V3Z" fill="currentColor"/></svg></span>';
        }
        return '<span class="signer-icon agent"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 4h8v3h3v9a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4V7h3V4Zm2 0v3h4V4h-4Zm-1 9a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Zm6 0a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Zm-5 3h4v-2h-4v2Z" fill="currentColor"/></svg></span>';
      }

      function signerSignature(run, signer) {
        const record = run.records.find((item) => item.signer === signer);
        if (!record) return '-';
        const hash = record.record_hash.replace('sha256:', '');
        return hash.slice(0, 10) + '...' + hash.slice(-4);
      }

      function signerRecordHash(run, signer) {
        return run.records.find((item) => item.signer === signer)?.record_hash ?? '';
      }

      function signerStatusClass(signer) {
        const status = signer.status.toLowerCase();
        return status + (signer.kind === 'mcp' ? ' mcp' : '');
      }

      function traceIdFromRunId(runId) {
        return 'trc_' + String(runId).replaceAll('-', '').toUpperCase().slice(0, 18);
      }

      function traceIdForRun(run) {
        return run.trace_packet?.trace_id ?? traceIdFromRunId(run.run_id);
      }

      function copyIcon(value = '', label = 'value') {
        const normalized = String(value ?? '');
        const disabled = !normalized || normalized === '-' || normalized === 'pending';
        return '<button class="copy-icon" type="button" aria-label="Copy ' + escapeHtml(label) + '" data-copy-value="' + escapeHtml(normalized) + '" ' + (disabled ? 'disabled' : '') + '><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 5V3.5A1.5 1.5 0 0 1 6.5 2h5A1.5 1.5 0 0 1 13 3.5v5A1.5 1.5 0 0 1 11.5 10H10v1.5A1.5 1.5 0 0 1 8.5 13h-5A1.5 1.5 0 0 1 2 11.5v-5A1.5 1.5 0 0 1 3.5 5H5Zm1.5 0h2A1.5 1.5 0 0 1 10 6.5v2h1.5V3.5h-5V5Zm-3 1.5v5h5v-5h-5Z" fill="currentColor"/></svg></button>';
      }

      function visibleDiffLines(diff, context = '3') {
        const lines = String(diff).split('\\n');
        if (context === 'all') return lines;
        const contextLines = Number.parseInt(context, 10);
        if (!Number.isFinite(contextLines)) return lines;
        let shownContextAfterChange = 0;
        return lines.filter((line) => {
          const changed = (line.startsWith('+') && !line.startsWith('+++'))
            || (line.startsWith('-') && !line.startsWith('---'))
            || line.startsWith('@@');
          if (changed) {
            shownContextAfterChange = 0;
            return true;
          }
          shownContextAfterChange += 1;
          return shownContextAfterChange <= contextLines;
        });
      }

      function renderDiff(diff, context = '3') {
        return visibleDiffLines(diff, context).map((line, index) => {
          const kind = line.startsWith('+') && !line.startsWith('+++')
            ? 'add'
            : line.startsWith('-') && !line.startsWith('---')
              ? 'remove'
              : line.startsWith('@@')
                ? 'meta'
                : '';
          return '<span class="diff-line ' + kind + '"><span class="diff-line-no">' + String(index + 1) + '</span><span class="diff-line-text">' + escapeHtml(line) + '</span></span>';
        }).join('');
      }

      function progressRecordFor(run, rowTitle) {
        if (rowTitle === 'Trigger received') return run.records.find((record) => record.label === 'trigger');
        if (rowTitle === 'Context gathered' || rowTitle === 'Policy and intent analysis') {
          return run.records.find((record) => record.label === 'triage');
        }
        if (rowTitle === 'Proposed action generated') return run.records.find((record) => record.label === 'proposal');
        if (rowTitle === 'Human review halted' || rowTitle === 'Human review recorded' || rowTitle === 'Human review feedback sent') {
          return run.records.find((record) => record.label === 'approval' || record.label === 'rejection' || record.label === 'change_request')
            ?? run.records.find((record) => record.label === 'proposal');
        }
        if (rowTitle === 'Agent resumed through MCP') return run.records.find((record) => record.label === 'execution');
        if (rowTitle === 'Audit ready') {
          return run.records.find((record) => record.label === 'handoff')
            ?? run.records.find((record) => record.label === 'outcome')
            ?? run.records.find((record) => record.label === 'rejection');
        }
        return run.records.find((record) => record.label === 'proposal');
      }

      function progressRowClass(row) {
        const key = progressKeyForTitle(row.title);
        return [
          row.halted ? 'halted' : '',
          key === 'proposal' ? 'proposal' : '',
        ].filter(Boolean).join(' ');
      }

      function pretty(value) {
        return JSON.stringify(value, null, 2);
      }

      function formatReceiptJson(value, format = selectedReceiptFormat) {
        return format === 'compact' ? JSON.stringify(value) : pretty(value);
      }

      function renderReceiptJson(value) {
        return '<pre>' + formatReceiptJson(value).split('\\n').map((line, index) => (
          '<span class="json-line"><span class="json-line-number">' + String(index + 1) + '</span><span class="json-line-code">' + escapeHtml(line) + '</span></span>'
        )).join('') + '</pre>';
      }

      function traceReceiptPayload(run = currentRun) {
        if (!run) return null;
        const createdAt = run.records[0]?.record?.timestamp
          ? new Date(run.records[0].record.timestamp).toISOString()
          : null;
        return {
          trace_id: traceIdForRun(run),
          run_id: run.run_id,
          status: run.status === 'pending_approval' ? 'human_review_halted' : run.status,
          current_step: run.status === 'pending_approval' || run.status === 'changes_requested' ? 3 : ['succeeded', 'failed', 'rejected'].includes(run.status) ? 5 : 4,
          created_at: createdAt,
          records: run.trace_packet.timeline.map((entry) => {
            const record = run.records.find((item) => item.record_hash === entry.record_hash);
            return {
              record_id: recordDisplayId(entry.record_hash),
              timestamp: record?.record?.timestamp ? new Date(record.record.timestamp).toISOString() : null,
              event: entry.event,
              label: entry.label,
              record_hash: entry.record_hash,
            };
          }),
        };
      }

      async function writeClipboard(text) {
        const value = String(text ?? '');
        if (!value) return false;
        try {
          await navigator.clipboard.writeText(value);
          return true;
        } catch {
          const textarea = document.createElement('textarea');
          textarea.value = value;
          textarea.setAttribute('readonly', '');
          textarea.style.position = 'fixed';
          textarea.style.left = '-9999px';
          document.body.appendChild(textarea);
          textarea.select();
          const copied = document.execCommand('copy');
          textarea.remove();
          return copied;
        }
      }

      function markCopied(button) {
        button.dataset.copyState = 'copied';
        window.setTimeout(() => {
          delete button.dataset.copyState;
        }, 1200);
      }

      function downloadJson(filename, value) {
        const blob = new Blob([formatReceiptJson(value)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
      }

      function receiptFileName(record = selectedReceiptRecord) {
        const label = record?.label ?? 'record';
        const hash = String(record?.record_hash ?? 'pending').replace('sha256:', '').slice(0, 12);
        return 'cloudflare-trace-' + label + '-' + hash + '.json';
      }

      function selectedReceiptPayload(record = selectedReceiptRecord) {
        if (!record || !currentRun) return null;
        if (selectedReceiptView === 'trace') return traceReceiptPayload(currentRun);
        return {
          trace_id: traceIdForRun(currentRun),
          run_id: currentRun.run_id,
          status: currentRun.status,
          selected_record: record,
        };
      }

      function proofTargetForRun(run = currentRun) {
        if (!run) return '';
        return run.trace_packet.handoff?.public_context_url ?? '/api/runs/' + run.run_id;
      }

      function verifyIcon(kind) {
        const icons = {
          log: '<svg viewBox="0 0 16 16"><path d="M5.2 7V5.2a2.8 2.8 0 1 1 5.6 0V7M4 7h8v6.5H4V7Zm4 3v1.4" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"/></svg>',
          sig: '<svg viewBox="0 0 16 16"><path d="M5 8.5 7 10l4-4.5M3.5 2.5h9v11h-9v-11Z" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"/></svg>',
          get: '<svg viewBox="0 0 16 16"><path d="M8 2.5v6m0 0 2.5-2.5M8 8.5 5.5 6M3 12.5h10" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"/></svg>',
        };
        return '<span class="verify-icon ' + kind + '" aria-hidden="true">' + (icons[kind] ?? icons.log) + '</span>';
      }

      function actionGlyph(kind = 'external') {
        if (kind === 'download') return '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2.5v6m0 0 2.5-2.5M8 8.5 5.5 6M3 12.5h10" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.6"/></svg>';
        if (kind === 'check') return '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.2 6.5 11 12 4.8" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.9"/></svg>';
        return '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6.5 3.5h6v6M12.5 3.5 6 10M4 5v8h8" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"/></svg>';
      }

      function verificationRowsMarkup(run = currentRun, record = selectedReceiptRecord) {
        if (!run || !record) {
          return '<span class="trace-section-label">Verification</span><div class="verify-list">'
            + '<div class="verify-row">' + verifyIcon('log') + '<div><strong>Verify in Cloudflare Integrity Log</strong><span class="empty">Check inclusion and consistency proof</span></div><button class="event-action" type="button" disabled>Pending</button></div>'
            + '<div class="verify-row">' + verifyIcon('sig') + '<div><strong>Verify receipt signature</strong><span class="empty">Validate signer and record hashes</span></div><button class="event-action" type="button" disabled>Pending</button></div>'
            + '<div class="verify-row">' + verifyIcon('get') + '<div><strong>Download transparency proof</strong><span class="empty">CT-style proof for this receipt</span></div><button class="event-action" type="button" disabled>Pending</button></div>'
            + '</div>';
        }
        const proofUrl = proofTargetForRun(run);
        return '<span class="trace-section-label">Verification</span><div class="verify-list">'
          + '<div class="verify-row">' + verifyIcon('log') + '<div><strong>Verify in Cloudflare Integrity Log</strong><span class="empty">Check inclusion and consistency proof</span></div><a class="event-action" href="' + escapeHtml(proofUrl) + '" target="_blank" rel="noreferrer">View proof ' + actionGlyph('external') + '</a></div>'
          + '<div class="verify-row">' + verifyIcon('sig') + '<div><strong>Verify receipt signature</strong><span class="empty">Validate signer and record hashes</span></div><button class="event-action" type="button" data-verify-receipt>Verify ' + actionGlyph('external') + '</button></div>'
          + '<div class="verify-row">' + verifyIcon('get') + '<div><strong>Download transparency proof</strong><span class="empty">CT-style proof for this receipt</span></div><button class="event-action" type="button" data-download-receipt>Download ' + actionGlyph('download') + '</button></div>'
          + '</div>';
      }

      function verificationCheckingMarkup(record = selectedReceiptRecord) {
        return '<div class="verification-result checking" id="verificationResult" role="status">'
          + '<div class="verification-step"><span class="verification-dot checking"></span><div><strong>Verifying receipt</strong><span>Checking ' + escapeHtml(shortHash(record?.record_hash)) + '</span></div></div>'
          + '<div class="verification-step"><span class="verification-dot"></span><div><strong>Record hash</strong><span>Waiting for Worker verifier</span></div></div>'
          + '<div class="verification-step"><span class="verification-dot"></span><div><strong>Signature</strong><span>Waiting for Ed25519 check</span></div></div>'
          + '</div>';
      }

      function verificationResultMarkup(result, record = selectedReceiptRecord) {
        const ok = Boolean(result?.ok);
        const hashOk = Boolean(result?.hash_ok);
        const signatureOk = Boolean(result?.signature_ok);
        return '<div class="verification-result ' + (ok ? '' : 'failed') + '" id="verificationResult" role="status">'
          + '<div class="verification-step"><span class="verification-dot ' + (hashOk ? 'ok' : 'fail') + '"></span><div><strong>Record hash ' + (hashOk ? 'matches' : 'mismatch') + '</strong><span>' + escapeHtml(shortHash(result?.record_hash ?? record?.record_hash)) + '</span></div></div>'
          + '<div class="verification-step"><span class="verification-dot ' + (signatureOk ? 'ok' : 'fail') + '"></span><div><strong>Signature ' + (signatureOk ? 'valid' : 'failed') + '</strong><span>Creator key ' + escapeHtml(shortHash(result?.creator_key ?? record?.record?.creator_key)) + '</span></div></div>'
          + '<div class="verification-step"><span class="verification-dot ' + (ok ? 'ok' : 'fail') + '"></span><div><strong>' + (ok ? 'Receipt verified' : 'Verification failed') + '</strong><span>Checked by the Cloudflare Worker verifier just now</span></div></div>'
          + '</div>';
      }

      function updateTraceHeaderCopy() {
        const traceButton = document.querySelector('[data-copy-source="#traceIdLabel"]');
        if (traceButton) traceButton.disabled = !traceIdLabel.textContent || traceIdLabel.textContent === 'pending';
        const runButton = document.querySelector('[data-copy-source="#runIdLabel"]');
        if (runButton) runButton.disabled = !runIdLabel.textContent || runIdLabel.textContent === 'pending';
      }

      function setHeaderMenuOpen(open) {
        if (!headerMenuButton || !headerActionsMenu) return;
        headerMenuButton.setAttribute('aria-expanded', String(open));
        headerActionsMenu.hidden = !open;
      }

      function setRunModeMenuOpen(open) {
        if (!runModeButton || !runModeActionsMenu) return;
        runModeButton.setAttribute('aria-expanded', String(open));
        runModeActionsMenu.hidden = !open;
      }

      function updateHeaderMenuControls() {
        if (!headerActionsMenu) return;
        document.querySelectorAll('[data-header-action="open-json"], [data-header-action="reset"], [data-run-mode-action="open-json"], [data-run-mode-action="reset"]').forEach((button) => {
          button.disabled = !currentRun || busy;
        });
      }

      function renderVerificationActions(run = currentRun, record = selectedReceiptRecord) {
        verificationEl.innerHTML = verificationRowsMarkup(run, record);
      }

      async function verifySelectedReceipt(button) {
        const record = selectedReceiptRecord;
        if (!record) return;
        button.disabled = true;
        button.innerHTML = 'Verifying...';
        button.classList.remove('verified', 'failed');
        const existingResult = verificationEl.querySelector('#verificationResult');
        if (existingResult) existingResult.remove();
        verificationEl.insertAdjacentHTML('beforeend', verificationCheckingMarkup(record));
        followElement(verificationEl.querySelector('#verificationResult'), 'nearest');
        try {
          await sleep(850);
          const result = await post('/api/verify-record', {
            record: record.record,
            expected_hash: record.record_hash,
          });
          const ok = Boolean(result?.ok);
          const resultEl = verificationEl.querySelector('#verificationResult');
          if (resultEl) resultEl.outerHTML = verificationResultMarkup(result, record);
          followElement(verificationEl.querySelector('#verificationResult'), 'nearest');
          button.innerHTML = (ok ? 'Verified ' : 'Check failed ') + actionGlyph(ok ? 'check' : 'external');
          button.classList.toggle('verified', ok);
          button.classList.toggle('failed', !ok);
        } catch (error) {
          const resultEl = verificationEl.querySelector('#verificationResult');
          const failed = {
            ok: false,
            hash_ok: false,
            signature_ok: false,
            record_hash: record.record_hash,
            creator_key: record.record?.creator_key,
          };
          if (resultEl) resultEl.outerHTML = verificationResultMarkup(failed, record);
          const failedText = escapeHtml(String(error?.message ?? error));
          verificationEl.insertAdjacentHTML('beforeend', '<p class="empty">' + failedText + '</p>');
          button.innerHTML = 'Check failed ' + actionGlyph('external');
          button.classList.add('failed');
        } finally {
          button.disabled = false;
        }
      }

      function updateReceiptControls(record = selectedReceiptRecord) {
        const hasRecord = Boolean(record);
        if (copyReceiptButton) copyReceiptButton.disabled = !hasRecord;
        if (downloadReceiptButton) downloadReceiptButton.disabled = !hasRecord;
      }

      function selectedReceiptJsonPayload() {
        if (!selectedReceiptRecord || !currentRun) return null;
        return selectedReceiptView === 'trace'
          ? traceReceiptPayload(currentRun)
          : selectedReceiptRecord;
      }

      function rerenderSelectedReceiptJson() {
        const payload = selectedReceiptJsonPayload();
        if (payload) receiptsEl.innerHTML = renderReceiptJson(payload);
      }

      function clearReceiptInspector() {
        selectedReceiptRecord = null;
        selectedReceiptView = 'record';
        receiptsEl.innerHTML = '<p class="empty">View signed record and proof after the first trace record is selected.</p>';
        receiptSummaryEl.innerHTML = '<p class="empty">Summary appears after a signed record is selected.</p>';
        renderVerificationActions(null, null);
        updateReceiptControls(null);
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
          case 'changes_requested':
            return {
              title: 'Revision requested before execution',
              detail: 'The human feedback is signed. The agent must revise the payload before MCP execution can resume.',
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
        if (run.status === 'changes_requested') {
          setStatus('Changes requested', 'pending', 'The human feedback is signed. MCP execution remains blocked until the agent revises the proposal.', 'halt');
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
          <div class="run-state proposal-state \${run.status === 'pending_approval' ? 'halt' : run.status === 'succeeded' ? 'ok' : ''}">
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
          <div class="diff" data-context-lines="3">
            <div>
              <div class="diff-head">
                <span class="label">Diff (unified)</span>
                <span class="diff-tools">
                  <label>Context <select id="diffContext" aria-label="Diff context"><option value="3">3 lines</option><option value="6">6 lines</option><option value="all">All</option></select></label>
                  <button type="button" id="diffWrapToggle" aria-pressed="false">Wrap</button>
                </span>
              </div>
              <div class="diff-code">\${renderDiff(diff, '3')}</div>
            </div>
          </div>
          <div class="risk-heading">Risk assessment</div>
          <div class="risk-bar">
            <span class="risk-icon"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.5 15 14H1L8 1.5Zm0 4v4m0 2.5h.01" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.7"/></svg></span>
            <span class="risk-level">Medium</span>
            <span class="value">\${body.risk ?? 'requires_human_approval'}</span>
            <button class="risk-details-toggle" id="riskDetailsToggle" type="button" aria-expanded="false" aria-controls="riskDetails">Details <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m5 6 3 3 3-3" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.7"/></svg></button>
          </div>
          <div class="risk-details" id="riskDetails" hidden>
            <strong>Human review gate</strong>
            <span>This proposal changes repository code for a production Workers route. The agent must halt before the action MCP writes the file.</span>
            <span>Approval signs the exact payload hash, connector id, and target file before execution resumes.</span>
          </div>
          <div class="actions">
            <button class="primary" id="approve" aria-label="Approve and resume" \${disabled ? 'disabled' : ''}><span class="button-content"><span class="button-icon"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.2 6.5 11 12 4.8" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"/></svg></span><span class="action-copy"><span class="button-label">Approve &amp; resume</span><small>Allow MCP execution to continue</small></span></span></button>
            <button class="danger" id="reject" aria-label="Reject" \${disabled ? 'disabled' : ''}><span class="button-content"><span class="button-icon"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4.5 4.5 7 7m0-7-7 7" fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="2"/></svg></span><span class="action-copy"><span class="button-label">Reject</span><small>Cancel this proposed action</small></span></span></button>
            <button class="secondary" id="requestChanges" aria-label="Request changes" \${disabled ? 'disabled' : ''}><span class="button-content"><span class="button-icon"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4h8v6H7l-3 3V4Z" fill="none" stroke="currentColor" stroke-linejoin="round" stroke-width="1.5"/></svg></span><span class="action-copy"><span class="button-label">Request changes</span><small>Send feedback to agent</small></span></span></button>
          </div>
        \`;
        document.querySelector('#riskDetailsToggle')?.addEventListener('click', (event) => {
          const button = event.currentTarget;
          const details = document.querySelector('#riskDetails');
          if (!details) return;
          const expanded = button.getAttribute('aria-expanded') === 'true';
          button.setAttribute('aria-expanded', String(!expanded));
          details.hidden = expanded;
        });
        document.querySelector('#diffWrapToggle')?.addEventListener('click', (event) => {
          const button = event.currentTarget;
          const code = document.querySelector('.diff-code');
          const pressed = button.getAttribute('aria-pressed') === 'true';
          button.setAttribute('aria-pressed', String(!pressed));
          code?.classList.toggle('wrap', !pressed);
        });
        document.querySelector('#diffContext')?.addEventListener('change', (event) => {
          const context = event.currentTarget.value;
          const diffRoot = document.querySelector('.diff');
          const code = document.querySelector('.diff-code');
          const wrap = document.querySelector('#diffWrapToggle')?.getAttribute('aria-pressed') === 'true';
          diffRoot?.setAttribute('data-context-lines', context);
          if (code) {
            code.innerHTML = renderDiff(diff, context);
            code.classList.toggle('wrap', wrap);
          }
        });
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
            detail: 'The reviewer feedback is being signed. The agent will need to revise before MCP execution.',
            step: 'halt',
            activeLabel: 'request',
            fn: async () => post('/api/runs/' + run.run_id + '/request-changes', {
              feedback: 'The reviewer requested a smaller repository file update.',
            }),
          });
        });
        updateControls();
      }

      function renderAnswer(run) {
        const answer = run.trace_packet.answer;
        const publicUrl = run.trace_packet.handoff?.public_context_url;
        const auditReady = ['succeeded', 'failed', 'rejected'].includes(run.status);
        const changesRequested = run.status === 'changes_requested';
        const showReviewResult = auditReady || changesRequested;
        const labels = new Set(run.records.map((record) => record.label));
        const stageRows = [
          {
            title: 'Trigger received',
            detail: labels.has('trigger') ? 'GitHub issue webhook or scheduled follow-up woke the agent.' : 'Waiting for trigger.',
            done: labels.has('trigger'),
          },
          {
            title: 'Context gathered',
            detail: labels.has('triage') ? 'Repository, issue, and Workers route context loaded.' : 'Waiting for context.',
            done: labels.has('triage'),
          },
          {
            title: 'Policy and intent analysis',
            detail: labels.has('triage') ? 'Repository writes require human review before MCP execution.' : 'Waiting for policy analysis.',
            done: labels.has('triage'),
          },
          {
            title: 'Proposed action generated',
            detail: labels.has('proposal') ? 'Agent prepared a write_file payload, diff, risk note, and payload hash.' : 'Agent has not planned yet.',
            done: labels.has('proposal'),
          },
          {
            title: run.status === 'pending_approval' ? 'Human review halted' : changesRequested ? 'Human review feedback sent' : 'Human review recorded',
            detail: answer.decision ? 'Decision: ' + answer.decision : 'Execution is stopped until a human signs approval, rejection, or feedback.',
            done: Boolean(answer.decision),
            halted: run.status === 'pending_approval',
          },
          {
            title: answer.executed ? 'Agent resumed through MCP' : changesRequested ? 'Revision requested' : 'Resume not started',
            detail: answer.executed ? 'The action MCP ran only after approval.' : changesRequested ? 'MCP execution stays blocked while the agent revises.' : 'Rejected or waiting for approval.',
            done: answer.executed,
          },
          {
            title: auditReady ? 'Audit ready' : changesRequested ? 'Revision pending' : 'Audit assembling',
            detail: auditReady
              ? 'Public log context and trace JSON are ready.'
              : changesRequested
                ? 'Signed feedback is in the trace; terminal audit waits for a revised proposal.'
              : 'Receipts appear as the run progresses; terminal audit waits for a decision.',
            done: auditReady,
          },
        ];
        answerEl.innerHTML = \`
          <span class="section-label">Agent progress</span>
          <div class="progress-list">
            \${stageRows.map((row) => \`
              <div class="progress-item \${progressRowClass(row)}">
                <span class="dot \${row.done ? 'ok' : row.halted ? 'pending' : 'future'}"></span>
                <div>
                  <strong>\${row.title === 'Resume not started' ? 'MCP execution (pending)' : row.title === 'Audit assembling' ? 'Audit ready (pending)' : row.title}</strong>
                  <span>\${row.detail}</span>
                </div>
                <span class="progress-time">\${progressDisplayTime(run, row.title, row.done || row.halted)}</span>
              </div>
            \`).join('')}
          </div>
          \${showReviewResult ? \`
            <div class="metric-row">
              <div class="metric">
                <span class="label">\${changesRequested ? 'Review result' : 'Execution result'}</span>
                <span class="value">\${changesRequested ? 'changes requested' : answer.executed ? answer.outcome : 'not run'}</span>
              </div>
              <div class="metric">
                <span class="label">\${changesRequested ? 'Next step' : 'Changed rows'}</span>
                <span class="value">\${changesRequested ? 'agent revision' : answer.changed.length ? answer.changed.join(', ') : 'none'}</span>
              </div>
            </div>
          \` : ''}
          \${auditReady && publicUrl ? '<div class="links"><a href="' + publicUrl + '">Public log context</a><a href="/api/runs/' + run.run_id + '">Trace JSON</a></div>' : ''}
        \`;
      }

      function renderTimeline(run) {
        const signers = [
          { kind: 'agent', name: 'Agent', detail: 'agents/triage@1.4.2', signer: 'agent', status: run.records.some((record) => record.signer === 'agent') ? 'Signed' : 'Pending' },
          { kind: 'human', name: 'Human', detail: 'alice@example.com', signer: 'human', status: run.records.some((record) => record.signer === 'human') ? 'Signed' : 'Pending' },
          { kind: 'mcp', name: 'Action MCP', detail: 'github.write@2.3.1', signer: 'action_mcp', status: run.records.some((record) => record.signer === 'action_mcp') ? 'Signed' : 'Pending' },
        ];
        timelineEl.innerHTML = run.trace_packet.timeline.length
          ? \`
          <span class="trace-section-label">Record timeline</span>
          <div class="record-timeline">
            \${run.trace_packet.timeline.map((entry, index) => {
              const record = run.records.find((item) => item.record_hash === entry.record_hash);
              const isPendingHuman = false;
              return \`
                <button class="event" data-hash="\${entry.record_hash}" data-label="\${entry.label}">
                  <span class="event-marker \${isPendingHuman ? 'pending' : 'done'}"></span>
                  <span class="event-time">\${displayRecordTime(record, entry.label, index)}</span>
                  <span class="event-copy">
                    <strong>\${timelineLabel(entry, run)}</strong>
                    <span class="value">\${timelineDetail(entry, run)}</span>
                  </span>
                  <span class="event-hash hash">\${recordDisplayId(entry.record_hash)}</span>
                  <span class="event-cue" aria-hidden="true"></span>
                </button>
              \`;
            }).join('')}
            \${futureTraceRows(run).map((row) => \`
              <div class="event-future \${row.marker === 'pending' ? 'selected' : ''}">
                <span class="event-marker \${row.marker}"></span>
                <span class="event-time">\${row.record ? displayRecordTime(row.record, row.displayLabel) : '-'}</span>
                <span class="event-copy">
                  <strong>\${row.name}</strong>
                  <span class="value">\${row.detail}</span>
                </span>
                <span class="event-hash hash">\${row.hash ? recordDisplayId(row.hash) : '-'}</span>
              </div>
            \`).join('')}
          </div>
          <div class="signer-list">
            <span class="trace-section-label">Signers</span>
            \${signers.map((signer) => \`
              <div class="signer-row">
                \${signerIcon(signer.kind)}
                <strong>\${signer.name}</strong>
                <span class="empty">\${signer.detail}</span>
                <span class="pill signer-status \${signerStatusClass(signer)}">\${signer.status}</span>
                <span class="signature-slot">Sig: <span class="hash">\${signerSignature(run, signer.signer)}</span></span>\${copyIcon(signerRecordHash(run, signer.signer), signer.name + ' signature')}
              </div>
            \`).join('')}
          </div>
          <div class="trace-integrity">
            <span class="trace-section-label">Trace integrity</span>
            <div class="integrity-list">
              <div class="integrity-row"><strong>Merkle root</strong><span class="hash">\${run.records[0]?.record_hash ?? 'pending'}</span>\${copyIcon(run.records[0]?.record_hash ?? '', 'Merkle root')}</div>
              <div class="integrity-row"><strong>Log hash</strong><span class="hash">\${run.records[1]?.record_hash ?? 'pending'}</span>\${copyIcon(run.records[1]?.record_hash ?? '', 'log hash')}</div>
              <div class="integrity-row proof-row"><strong>Proof status</strong><span class="value">Included in Cloudflare Integrity Log</span><a class="event-action" href="\${run.trace_packet.handoff?.public_context_url ?? '/api/runs/' + run.run_id}" target="_blank" rel="noreferrer">View proof</a></div>
            </div>
          </div>
        \`
          : '<p class="empty">No signed records yet.</p>';
        const bindReceiptTabs = (record) => {
          receiptSummaryEl.querySelectorAll('[data-receipt-tab]').forEach((button) => {
            button.addEventListener('click', () => {
              renderReceiptSummary(record, button.dataset.receiptTab);
            });
          });
        };
        const renderReceiptSummary = (record, activeTab = 'summary') => {
          const signedRecords = signers.filter((signer) => signer.status === 'Signed').length;
          const pendingSignatures = signers.filter((signer) => signer.status === 'Pending').length;
          const logEntry = run.trace_packet.handoff?.public_context_url ?? '/api/runs/' + run.run_id;
          const tabMarkup = \`
            <div class="receipt-tabs" role="tablist" aria-label="Receipt inspector views">
              <button class="receipt-tab \${activeTab === 'summary' ? 'active' : ''}" type="button" role="tab" aria-selected="\${activeTab === 'summary' ? 'true' : 'false'}" data-receipt-tab="summary">Summary</button>
              <button class="receipt-tab \${activeTab === 'details' ? 'active' : ''}" type="button" role="tab" aria-selected="\${activeTab === 'details' ? 'true' : 'false'}" data-receipt-tab="details">Record details</button>
            </div>
          \`;
          if (activeTab === 'details') {
            receiptSummaryEl.innerHTML = tabMarkup + \`
              <div class="record-details-grid">
                <div class="summary-row"><span>Record label</span><strong>\${record.label}</strong><span></span></div>
                <div class="summary-row"><span>Signer</span><strong>\${record.signer}</strong><span></span></div>
                <div class="summary-row"><span>Tool</span><span class="value">\${record.record.tool_name ?? 'observation'}</span><span></span></div>
                <div class="summary-row"><span>Timestamp</span><span class="value">\${displayRecordTime(record, record.label) + ' UTC'} / \${record.record.timestamp} ms</span><span></span></div>
                <div class="summary-row"><span>Record hash</span><span class="hash">\${shortHash(record.record_hash)}</span>\${copyIcon(record.record_hash, 'record hash')}</div>
                <div class="summary-row"><span>Chain root</span><span class="hash">\${shortHash(record.record.chain_root)}</span>\${copyIcon(record.record.chain_root, 'chain root')}</div>
                <div class="summary-row"><span>Context ID</span><span class="hash">\${record.record.context_id}</span>\${copyIcon(record.record.context_id, 'context ID')}</div>
                <div class="summary-row"><span>Informed by</span><span class="value">\${record.informed_by?.length ?? record.record.informed_by?.length ?? 0} linked record(s)</span><span></span></div>
              </div>
            \`;
            bindReceiptTabs(record);
            return;
          }
          receiptSummaryEl.innerHTML = \`
            \${tabMarkup}
            <div class="receipt-summary-grid">
              <div class="summary-row"><span>Total records</span><strong>\${run.records.length}</strong><span></span></div>
              <div class="summary-row"><span>Signed records</span><strong>\${signedRecords}</strong><span></span></div>
              <div class="summary-row"><span>Pending signatures</span><strong>\${pendingSignatures}</strong><span></span></div>
              <div class="summary-row"><span>Merkle root</span><span class="hash">\${shortHash(run.records[0]?.record_hash)}</span>\${copyIcon(run.records[0]?.record_hash ?? '', 'Merkle root')}</div>
              <div class="summary-row"><span>Log entry</span><a href="\${logEntry}">cl_\${traceIdForRun(run).slice(4, 20)}</a><span></span></div>
              <div class="summary-row"><span>Log timestamp</span><strong>\${displayRecordTime(record, record.label) + ' UTC'}</strong><span></span></div>
              <div class="summary-row"><span>Retention</span><strong>30 days (default)</strong><span></span></div>
            </div>
          \`;
          bindReceiptTabs(record);
        };
        const selectRecord = (record, options = {}) => {
          selectedReceiptRecord = record;
          selectedReceiptView = options.showTrace ? 'trace' : 'record';
          receiptsEl.innerHTML = renderReceiptJson(selectedReceiptJsonPayload());
          renderReceiptSummary(record);
          renderVerificationActions(run, record);
          updateReceiptControls(record);
        };
        timelineEl.querySelectorAll('.event').forEach((button) => {
          button.addEventListener('click', () => {
            const record = run.records.find((item) => item.record_hash === button.dataset.hash);
            timelineEl.querySelectorAll('.event').forEach((item) => item.classList.remove('selected'));
            button.classList.add('selected');
            selectRecord(record);
          });
        });
        const preferredLabel = run.status === 'pending_approval' ? 'proposal' : run.status === 'changes_requested' ? 'change_request' : run.status === 'rejected' ? 'rejection' : run.status === 'failed' ? 'outcome' : 'handoff';
        const preferredButton = timelineEl.querySelector(\`.event[data-label="\${preferredLabel}"]\`) ?? timelineEl.querySelector('.event');
        if (preferredButton) {
          timelineEl.querySelectorAll('.event').forEach((item) => item.classList.remove('selected'));
          if (run.status !== 'pending_approval') preferredButton.classList.add('selected');
          const preferredRecord = run.records.find((item) => item.record_hash === preferredButton.dataset.hash);
          if (preferredRecord) selectRecord(preferredRecord, { showTrace: true });
        }
      }

      function applyRunHeader(run) {
        currentRun = run;
        runIdLabel.textContent = run.run_id;
        traceIdLabel.textContent = traceIdForRun(run);
        updateTraceHeaderCopy();
        const started = run.records[0]?.record?.timestamp
          ? new Date(run.records[0].record.timestamp).toISOString().replace('T', ' ').slice(0, 19) + ' UTC'
          : 'pending';
        startedLabel.textContent = started;
        receivedLabel.textContent = started;
        updateControls();
      }

      function render(run) {
        stageDisplayTimes = {};
        applyRunHeader(run);
        renderProposal(run);
        renderAnswer(run);
        renderTimeline(run);
        setStatusForRun(run);
        updateStepTimes(run);
        updateControls();
        if (run.status === 'pending_approval') {
          followElement(document.querySelector('#approve'), 'nearest');
        } else if (['succeeded', 'failed', 'rejected'].includes(run.status)) {
          followElement(document.querySelector('.receipt-panel'), 'start');
        }
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

      document.addEventListener('click', async (event) => {
        const target = event.target;
        const menuButton = target.closest?.('#headerMenu');
        if (menuButton) {
          setRunModeMenuOpen(false);
          setHeaderMenuOpen(menuButton.getAttribute('aria-expanded') !== 'true');
          return;
        }

        const runModeTrigger = target.closest?.('#runModeMenu');
        if (runModeTrigger) {
          setHeaderMenuOpen(false);
          setRunModeMenuOpen(runModeTrigger.getAttribute('aria-expanded') !== 'true');
          return;
        }

        const runModeAction = target.closest?.('[data-run-mode-action]');
        if (runModeAction && !runModeAction.disabled) {
          const action = runModeAction.dataset.runModeAction;
          setRunModeMenuOpen(false);
          if (action === 'open-json' && currentRun) {
            window.open('/api/runs/' + currentRun.run_id, '_blank', 'noreferrer');
            return;
          }
          if (action === 'reset') {
            resetButton.click();
            return;
          }
          return;
        }

        const menuAction = target.closest?.('[data-header-action]');
        if (menuAction && !menuAction.disabled) {
          const action = menuAction.dataset.headerAction;
          setHeaderMenuOpen(false);
          if (action === 'copy-link') {
            if (await writeClipboard(window.location.href)) markCopied(menuAction);
            return;
          }
          if (action === 'open-json' && currentRun) {
            window.open('/api/runs/' + currentRun.run_id, '_blank', 'noreferrer');
            return;
          }
          if (action === 'reset') {
            resetButton.click();
            return;
          }
        }

        if (headerActionsMenu && !target.closest?.('#headerActions')) {
          setHeaderMenuOpen(false);
        }

        if (runModeActionsMenu && !target.closest?.('#runModeActions')) {
          setRunModeMenuOpen(false);
        }

        const copyButton = target.closest?.('[data-copy-value], [data-copy-source], #copyReceipt');
        if (copyButton && !copyButton.disabled) {
          const source = copyButton.dataset.copySource
            ? document.querySelector(copyButton.dataset.copySource)?.textContent
            : null;
          const payload = copyButton.id === 'copyReceipt'
            ? selectedReceiptPayload()
            : null;
          const value = payload ? formatReceiptJson(payload) : source ?? copyButton.dataset.copyValue ?? '';
          if (await writeClipboard(value)) markCopied(copyButton);
          return;
        }

        const verifyButton = target.closest?.('[data-verify-receipt]');
        if (verifyButton && !verifyButton.disabled && selectedReceiptRecord) {
          await verifySelectedReceipt(verifyButton);
          return;
        }

        const downloadButton = target.closest?.('[data-download-receipt], #downloadReceipt');
        if (downloadButton && !downloadButton.disabled && selectedReceiptRecord) {
          const payload = selectedReceiptPayload();
          if (payload) downloadJson(receiptFileName(selectedReceiptRecord), payload);
        }
      });

      createButton.addEventListener('click', async () => {
        await startTriggeredRun();
      });

      receiptFormatSelect?.addEventListener('change', () => {
        selectedReceiptFormat = receiptFormatSelect.value;
        rerenderSelectedReceiptJson();
      });

      async function startTriggeredRun() {
        if (busy) return;
        try {
          setBusy(true, 'create');
          const runId = crypto.randomUUID();
          currentRun = null;
          selectedReceiptRecord = null;
          selectedReceiptView = 'record';
          stageDisplayTimes = {};
          runIdLabel.textContent = runId;
          traceIdLabel.textContent = traceIdFromRunId(runId);
          updateTraceHeaderCopy();
          startedLabel.textContent = nowTime(0);
          receivedLabel.textContent = nowTime(0);
          clearReceiptInspector();
          renderBootProgress(0);
          const run = await post('/api/runs', {
            run_id: runId,
            prompt: promptInput.value,
          });
          applyRunHeader(run);
          renderBootProgress(0, run);
          await sleep(1700);
          for (let index = 1; index < bootStages.length; index += 1) {
            renderBootProgress(index, run);
            await sleep(1700);
          }
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
        setHeaderMenuOpen(false);
        setRunModeMenuOpen(false);
        startTriggeredRun();
      });

      document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
          setHeaderMenuOpen(false);
          setRunModeMenuOpen(false);
        }
      });

      updateControls();
      updateTraceHeaderCopy();
      if (!autoStarted) {
        autoStarted = true;
        simulateErrorInput.checked = new URLSearchParams(window.location.search).get('simulate_error') === '1';
        let scheduledStart = false;
        const beginAutostart = () => {
          if (scheduledStart) return;
          scheduledStart = true;
          startTriggeredRun();
        };
        requestAnimationFrame(beginAutostart);
        window.setTimeout(beginAutostart, 250);
      }
    </script>
  </body>
</html>`
}
