// SPDX-License-Identifier: Apache-2.0

export function renderBrowserbaseProofApp(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <link rel="icon" href="data:," />
    <title>Browserbase WebMCP atrib proof</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f5f7fb;
        --panel: #ffffff;
        --panel-soft: #f8fafc;
        --text: #111827;
        --muted: #5d697b;
        --line: #d8e0eb;
        --line-strong: #b8c6d8;
        --blue: #2458d3;
        --blue-soft: #e8efff;
        --green: #147a54;
        --green-soft: #e8f6ef;
        --amber: #946200;
        --red: #a92835;
        --red-soft: #fff0f2;
        --stage: #070b13;
        --stage-line: rgba(203, 213, 225, 0.18);
        --stage-text: #f8fafc;
        --stage-muted: #aeb9cc;
        --shadow: 0 18px 46px rgba(17, 24, 39, 0.08);
      }
      * { box-sizing: border-box; }
      [hidden] { display: none !important; }
      body {
        background: linear-gradient(180deg, #ffffff, var(--bg) 180px);
        color: var(--text);
        font-family: "Geist", "Aptos", "SF Pro Text", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        font-variant-numeric: tabular-nums;
        -moz-osx-font-smoothing: grayscale;
        -webkit-font-smoothing: antialiased;
        margin: 0;
      }
      button,
      a {
        -webkit-tap-highlight-color: transparent;
      }
      button { cursor: pointer; font: inherit; }
      button:disabled { cursor: not-allowed; opacity: 0.56; }
      button:focus-visible,
      a:focus-visible,
      textarea:focus-visible {
        outline: 3px solid rgba(36, 88, 211, 0.34);
        outline-offset: 2px;
      }
      code {
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        font-size: 0.92em;
        overflow-wrap: anywhere;
      }
      .shell {
        margin: 0 auto;
        max-width: 1620px;
        min-height: 100dvh;
        padding: 14px 18px 18px;
      }
      .topbar,
      .meta-strip,
      .panel {
        background: rgba(255, 255, 255, 0.96);
        border: 1px solid var(--line);
        border-radius: 8px;
        box-shadow: var(--shadow);
      }
      .topbar {
        align-items: center;
        display: grid;
        gap: 14px;
        grid-template-columns: minmax(0, 1fr) auto;
        min-height: 64px;
        padding: 10px 12px 10px 16px;
      }
      .brand-line {
        align-items: center;
        display: flex;
        gap: 12px;
        min-width: 0;
      }
      .wordmark {
        color: var(--text);
        font-size: 24px;
        font-weight: 820;
        letter-spacing: -0.02em;
      }
      .divider {
        background: var(--line);
        height: 28px;
        width: 1px;
      }
      .breadcrumbs {
        align-items: center;
        color: var(--muted);
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        font-size: 14px;
        min-width: 0;
      }
      .breadcrumbs strong { color: var(--text); font-weight: 760; }
      .run-controls {
        align-items: center;
        display: flex;
        gap: 10px;
        justify-content: flex-end;
      }
      .control-label {
        border: 1px solid var(--line);
        border-radius: 8px;
        color: var(--text);
        font-size: 13px;
        font-weight: 760;
        min-height: 40px;
        padding: 11px 14px;
      }
      .segmented {
        background: #fff;
        border: 1px solid var(--line);
        border-radius: 8px;
        display: inline-flex;
        overflow: hidden;
      }
      .segmented button {
        background: transparent;
        border: 0;
        border-left: 1px solid var(--line);
        color: var(--text);
        font-size: 13px;
        font-weight: 780;
        min-height: 44px;
        min-width: 96px;
        padding: 0 14px;
      }
      .segmented button:first-child { border-left: 0; }
      .segmented button.active {
        background: var(--green-soft);
        box-shadow: inset 0 0 0 1px #7fc69e;
        color: var(--green);
      }
      .primary-action {
        background: var(--blue);
        border: 1px solid var(--blue);
        border-radius: 8px;
        color: #fff;
        font-weight: 780;
        min-height: 44px;
        padding: 0 16px;
      }
      .secondary-action {
        background: #fff;
        border: 1px solid var(--line-strong);
        border-radius: 8px;
        color: var(--text);
        font-size: 13px;
        font-weight: 760;
        min-height: 44px;
        padding: 0 11px;
      }
      .meta-strip {
        align-items: center;
        display: grid;
        gap: 8px;
        grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
        margin-top: 10px;
        min-height: 42px;
        padding: 8px 12px;
      }
      .meta-item {
        border-right: 1px solid var(--line);
        color: var(--muted);
        display: flex;
        gap: 8px;
        min-width: 0;
        padding-right: 14px;
        white-space: normal;
      }
      .meta-item:last-child { border-right: 0; }
      .meta-item strong { color: var(--text); }
      .status-pill,
      .tag {
        align-items: center;
        border-radius: 999px;
        display: inline-flex;
        font-size: 12px;
        font-weight: 780;
        min-height: 26px;
        padding: 5px 9px;
        width: fit-content;
      }
      .status-pill.ready,
      .status-pill.accepted,
      .tag.ok {
        background: var(--green-soft);
        border: 1px solid #b6dfc9;
        color: var(--green);
      }
      .status-pill.running,
      .tag.pending {
        background: var(--blue-soft);
        border: 1px solid #bbccfb;
        color: var(--blue);
      }
      .status-pill.failed,
      .tag.err {
        background: var(--red-soft);
        border: 1px solid #f0b8c0;
        color: var(--red);
      }
      .workbench {
        align-items: start;
        display: grid;
        gap: 12px;
        grid-template-columns: minmax(760px, 1fr) minmax(360px, 390px);
        margin-top: 14px;
      }
      .panel { min-width: 0; padding: 0; }
      .panel-head {
        align-items: center;
        border-bottom: 1px solid var(--line);
        display: flex;
        gap: 10px;
        justify-content: space-between;
        min-height: 48px;
        padding: 11px 14px;
      }
      h1, h2, h3, p { margin-top: 0; }
      h1,
      h2,
      h3,
      .event-title,
      .fact strong {
        text-wrap: balance;
      }
      h2 { font-size: 15px; letter-spacing: 0; line-height: 1.25; margin: 0; }
      p {
        color: var(--muted);
        font-size: 13px;
        line-height: 1.45;
        margin-bottom: 0;
        text-wrap: pretty;
      }
      .browser-shell {
        background: var(--stage);
        border: 1px solid var(--stage-line);
        border-radius: 8px;
        box-shadow: 0 30px 80px rgba(2, 6, 23, 0.24);
        display: grid;
        gap: 10px;
        margin: 14px;
        overflow: hidden;
        padding: 12px;
      }
      .stage-strip {
        align-items: center;
        color: var(--stage-muted);
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        justify-content: space-between;
        min-height: 34px;
      }
      .stage-kicker,
      .stage-flow {
        align-items: center;
        border: 1px solid var(--stage-line);
        border-radius: 999px;
        display: inline-flex;
        font-size: 12px;
        font-weight: 780;
        min-height: 30px;
        padding: 0 10px;
      }
      .stage-kicker {
        background: rgba(36, 88, 211, 0.18);
        color: var(--stage-text);
      }
      .stage-flow {
        background: rgba(255, 255, 255, 0.06);
        max-width: 100%;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .browser-chrome {
        background: #f4f7fb;
        border: 1px solid var(--line);
        border-radius: 8px 8px 0 0;
        display: grid;
        gap: 8px;
        padding: 10px;
      }
      .browser-row { align-items: center; display: flex; gap: 8px; }
      .dot { border-radius: 999px; display: inline-block; height: 10px; width: 10px; }
      .dot.red { background: #e45a6a; }
      .dot.amber { background: #e5a029; }
      .dot.green { background: #31a36c; }
      .tab {
        align-items: center;
        background: #fff;
        border: 1px solid var(--line);
        border-radius: 8px;
        display: inline-flex;
        font-size: 12px;
        font-weight: 760;
        min-height: 30px;
        min-width: 190px;
        padding: 0 10px;
      }
      .address {
        background: #fff;
        border: 1px solid var(--line);
        border-radius: 999px;
        color: #334155;
        flex: 1;
        font-size: 12px;
        overflow: hidden;
        padding: 7px 11px;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .target-frame {
        --visual-x: 12%;
        --visual-x-px: 0px;
        --visual-y: 12%;
        --visual-y-px: 0px;
        background: #fff;
        border: 1px solid var(--line);
        border-top: 0;
        border-radius: 0 0 8px 8px;
        height: 760px;
        overflow: hidden;
        position: relative;
        width: 100%;
      }
      .target-frame iframe {
        border: 0;
        height: 100%;
        transition: transform 520ms cubic-bezier(0.22, 1, 0.36, 1);
        width: 100%;
      }
      .target-frame.is-playing iframe,
      .target-frame.has-replay iframe {
        transform: scale(1.025);
      }
      .media-strip {
        align-items: center;
        background: #fff;
        border-left: 1px solid var(--line);
        border-right: 1px solid var(--line);
        display: flex;
        gap: 8px;
        justify-content: space-between;
        padding: 8px 10px;
      }
      .media-copy {
        align-items: center;
        color: #475569;
        display: inline-flex;
        flex-wrap: wrap;
        font-size: 12px;
        font-weight: 720;
        gap: 8px;
        min-width: 0;
      }
      .media-note {
        color: #64748b;
        font-weight: 650;
        max-width: 360px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .media-tabs {
        background: var(--panel-soft);
        border: 1px solid var(--line);
        border-radius: 8px;
        display: inline-flex;
        overflow: hidden;
      }
      .media-tab {
        align-items: center;
        background: transparent;
        border: 0;
        border-left: 1px solid var(--line);
        color: var(--muted);
        cursor: pointer;
        display: inline-flex;
        font-size: 12px;
        font-weight: 780;
        min-height: 32px;
        padding: 0 10px;
      }
      .media-tab:first-child { border-left: 0; }
      .media-tab.active {
        background: #fff;
        color: var(--blue);
      }
      .media-tab.unavailable {
        color: #94a3b8;
      }
      .media-tab:focus-visible {
        box-shadow: inset 0 0 0 2px rgba(36, 88, 211, 0.32);
        outline: none;
      }
      .visual-state {
        align-items: center;
        color: var(--muted);
        display: inline-flex;
        font-size: 12px;
        font-weight: 760;
        gap: 8px;
        min-width: 0;
      }
      .media-actions {
        align-items: center;
        display: inline-flex;
        flex-wrap: wrap;
        gap: 8px;
        justify-content: flex-end;
      }
      .media-link {
        align-items: center;
        background: #fff;
        border: 1px solid var(--line);
        border-radius: 8px;
        color: var(--blue);
        display: inline-flex;
        font-size: 12px;
        font-weight: 780;
        min-height: 44px;
        padding: 0 10px;
        text-decoration: none;
      }
      .media-link:hover { border-color: rgba(36, 88, 211, 0.36); }
      .pulse-dot {
        background: var(--blue);
        border-radius: 999px;
        box-shadow: 0 0 0 5px rgba(36, 88, 211, 0.12);
        display: inline-block;
        height: 9px;
        width: 9px;
      }
      .visual-overlay {
        inset: 0;
        pointer-events: none;
        position: absolute;
      }
      .visual-spotlight {
        background:
          radial-gradient(circle at var(--visual-x) var(--visual-y), rgba(36, 88, 211, 0.16), transparent 16%),
          radial-gradient(circle at var(--visual-x) var(--visual-y), rgba(15, 23, 42, 0), rgba(15, 23, 42, 0.12) 54%);
        inset: 0;
        opacity: 0;
        position: absolute;
        transition: opacity 160ms ease, background 520ms cubic-bezier(0.22, 1, 0.36, 1);
        z-index: 1;
      }
      .target-frame.is-playing .visual-spotlight,
      .target-frame.has-replay .visual-spotlight {
        opacity: 1;
      }
      .visual-cursor {
        filter: drop-shadow(0 8px 14px rgba(15, 23, 42, 0.26));
        height: 52px;
        left: 0;
        opacity: 0;
        position: absolute;
        top: 0;
        transform: translate(calc(var(--visual-x-px) - 2px), calc(var(--visual-y-px) - 2px));
        transition:
          transform 520ms cubic-bezier(0.22, 1, 0.36, 1),
          opacity 160ms ease;
        width: 42px;
        z-index: 3;
      }
      .target-frame.is-playing .visual-cursor,
      .target-frame.has-replay .visual-cursor {
        opacity: 1;
      }
      .visual-cursor::before {
        background: #fff;
        clip-path: polygon(0 0, 0 100%, 32% 74%, 48% 100%, 64% 91%, 49% 65%, 84% 65%);
        content: "";
        display: block;
        height: 52px;
        position: relative;
        width: 42px;
        z-index: 2;
      }
      .visual-cursor::after {
        background: #111827;
        clip-path: polygon(0 0, 0 100%, 32% 74%, 48% 100%, 64% 91%, 49% 65%, 84% 65%);
        content: "";
        display: block;
        height: 58px;
        left: -3px;
        position: absolute;
        top: -3px;
        width: 48px;
        z-index: 1;
      }
      .click-ring {
        border: 2px solid rgba(36, 88, 211, 0.82);
        border-radius: 999px;
        height: 86px;
        left: 0;
        opacity: 0;
        position: absolute;
        top: 0;
        transform: translate(var(--visual-x-px), var(--visual-y-px)) translate(-50%, -50%) scale(0.66);
        transition:
          transform 520ms cubic-bezier(0.22, 1, 0.36, 1),
          opacity 160ms ease;
        width: 86px;
        z-index: 2;
      }
      .target-frame.clicking .click-ring {
        animation: click-ring 720ms ease;
      }
      .target-frame.blocked .click-ring {
        border-color: rgba(169, 40, 53, 0.78);
        opacity: 0.8;
        transform: translate(var(--visual-x-px), var(--visual-y-px)) translate(-50%, -50%) scale(0.84);
      }
      .action-callout {
        background: rgba(7, 11, 19, 0.9);
        border: 1px solid rgba(255, 255, 255, 0.16);
        border-radius: 999px;
        box-shadow: 0 14px 36px rgba(15, 23, 42, 0.2);
        color: #fff;
        font-size: 12px;
        font-weight: 820;
        left: 0;
        max-width: min(320px, calc(100% - 32px));
        opacity: 0;
        overflow: hidden;
        padding: 8px 11px;
        position: absolute;
        text-overflow: ellipsis;
        top: 0;
        transform: translate(calc(var(--visual-x-px) + 28px), calc(var(--visual-y-px) + 16px));
        transition:
          transform 520ms cubic-bezier(0.22, 1, 0.36, 1),
          opacity 160ms ease,
          border-color 160ms ease;
        white-space: nowrap;
        z-index: 4;
      }
      .target-frame.is-playing .action-callout,
      .target-frame.has-replay .action-callout {
        opacity: 1;
      }
      .target-frame.blocked .action-callout {
        border-color: rgba(240, 184, 192, 0.72);
      }
      .visual-caption {
        background: rgba(7, 11, 19, 0.92);
        border: 1px solid rgba(255, 255, 255, 0.14);
        border-radius: 8px;
        box-shadow: 0 22px 56px rgba(2, 6, 23, 0.28);
        color: #fff;
        display: grid;
        gap: 6px;
        max-width: min(440px, calc(100% - 40px));
        padding: 14px 16px;
        position: absolute;
        right: 18px;
        top: 18px;
        width: max-content;
        z-index: 5;
      }
      .visual-caption strong {
        font-size: 18px;
        line-height: 1.25;
      }
      .visual-caption span {
        color: #cbd5e1;
        font-size: 14px;
        line-height: 1.35;
        text-wrap: pretty;
      }
      .visual-progress {
        background: rgba(203, 213, 225, 0.45);
        border-radius: 999px;
        bottom: 0;
        height: 5px;
        left: 0;
        overflow: hidden;
        position: absolute;
        right: 0;
      }
      .visual-progress-bar {
        background: var(--blue);
        height: 100%;
        transform: scaleX(0);
        transform-origin: left center;
        transition: transform 360ms ease;
      }
      .visual-footnotes {
        align-items: center;
        border-top: 1px solid var(--line);
        color: var(--muted);
        display: flex;
        flex-wrap: wrap;
        font-size: 12px;
        gap: 8px;
        justify-content: space-between;
        padding: 10px 14px;
        text-wrap: pretty;
      }
      @keyframes click-ring {
        0% { opacity: 0; transform: translate(var(--visual-x-px), var(--visual-y-px)) translate(-50%, -50%) scale(0.48); }
        30% { opacity: 1; transform: translate(var(--visual-x-px), var(--visual-y-px)) translate(-50%, -50%) scale(0.84); }
        100% { opacity: 0; transform: translate(var(--visual-x-px), var(--visual-y-px)) translate(-50%, -50%) scale(1.35); }
      }
      .workflow-summary {
        border-top: 1px solid var(--line);
        display: none;
        gap: 10px;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        padding: 14px;
      }
      .fact {
        background: var(--panel-soft);
        border: 1px solid var(--line);
        border-radius: 8px;
        display: grid;
        gap: 4px;
        min-width: 0;
        padding: 10px;
      }
      .fact span,
      .timeline-meta,
      .field-label {
        color: var(--muted);
        font-size: 12px;
        font-weight: 760;
      }
      .fact strong {
        font-size: 13px;
        min-width: 0;
        overflow-wrap: anywhere;
      }
      .timeline {
        display: grid;
        max-height: 790px;
        overflow: auto;
        padding: 12px 14px 0;
        position: relative;
      }
      .timeline::before {
        background: var(--line);
        bottom: 18px;
        content: "";
        left: 27px;
        position: absolute;
        top: 24px;
        width: 2px;
      }
      .event {
        align-items: start;
        background: transparent;
        border: 0;
        display: grid;
        gap: 10px;
        grid-template-columns: 28px 74px minmax(0, 1fr) auto;
        min-width: 0;
        padding: 8px 0;
        position: relative;
      }
      .event-marker {
        align-items: center;
        background: #fff;
        border: 2px solid var(--line-strong);
        border-radius: 999px;
        color: var(--muted);
        display: inline-flex;
        font-size: 11px;
        font-weight: 780;
        height: 24px;
        justify-content: center;
        position: relative;
        width: 24px;
        z-index: 1;
      }
      .event.ok .event-marker { background: var(--green); border-color: var(--green); color: #fff; }
      .event.pending .event-marker { background: var(--blue); border-color: var(--blue); color: #fff; }
      .event.err .event-marker { background: var(--red); border-color: var(--red); color: #fff; }
      .event-copy { display: grid; gap: 4px; min-width: 0; }
      .event-title { font-size: 13px; font-weight: 820; }
      .event-detail {
        color: #334155;
        font-size: 12px;
        line-height: 1.36;
        overflow-wrap: anywhere;
      }
      .event-hash {
        color: var(--muted);
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        font-size: 12px;
        overflow-wrap: anywhere;
      }
      .links { align-items: start; display: grid; gap: 6px; }
      .links a {
        align-items: center;
        color: var(--blue);
        display: inline-flex;
        font-size: 12px;
        font-weight: 760;
        min-height: 44px;
        padding: 0;
        text-decoration: none;
      }
      .empty {
        border: 1px dashed var(--line-strong);
        border-radius: 8px;
        color: var(--muted);
        margin: 14px;
        padding: 24px;
        text-align: center;
      }
      .json-panel {
        border-top: 1px solid var(--line);
        display: grid;
        gap: 10px;
        padding: 14px;
      }
      pre {
        background: #111827;
        border-radius: 8px;
        color: #f9fafb;
        font-size: 12px;
        line-height: 1.45;
        margin: 0;
        max-height: 260px;
        overflow: auto;
        padding: 12px;
        white-space: pre-wrap;
      }
      .primary-action,
      .secondary-action,
      .segmented button,
      .media-link,
      .links a {
        transition-duration: 160ms;
        transition-property: background-color, border-color, box-shadow, color, transform;
        transition-timing-function: cubic-bezier(0.22, 1, 0.36, 1);
      }
      .primary-action:not(:disabled):active,
      .secondary-action:not(:disabled):active,
      .segmented button:not(:disabled):active,
      .media-link:active {
        transform: scale(0.97);
      }
      @media (prefers-reduced-motion: reduce) {
        *,
        *::before,
        *::after {
          animation-duration: 0.001ms !important;
          animation-iteration-count: 1 !important;
          scroll-behavior: auto !important;
          transition-duration: 0.001ms !important;
        }
      }
      @media (max-width: 1120px) {
        .topbar,
        .workbench { grid-template-columns: 1fr; }
        .run-controls { justify-content: stretch; }
        .segmented { flex: 1; }
        .segmented button,
        .primary-action { flex: 1; }
        .meta-strip { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        .target-frame { height: 640px; }
      }
      @media (max-width: 720px) {
        .shell { padding: 10px; }
        .brand-line,
        .run-controls { display: grid; }
        .divider { display: none; }
        .workflow-summary {
          display: grid;
          grid-template-columns: 1fr;
        }
        .meta-strip { grid-template-columns: 1fr; }
        .meta-item { border-right: 0; }
        .browser-shell { margin: 10px; }
        .target-frame { height: 1380px; }
        .stage-strip { align-items: stretch; display: grid; }
        .stage-flow { justify-content: center; white-space: normal; }
        .media-strip,
        .visual-footnotes { align-items: stretch; display: grid; }
        .media-tabs { width: 100%; }
        .media-tab {
          flex: 1;
          justify-content: center;
        }
        .media-actions { justify-content: stretch; }
        .media-link { justify-content: center; width: 100%; }
        .visual-caption {
          left: 8px;
          max-width: calc(100% - 16px);
          padding: 8px 10px;
          right: 8px;
          top: 8px;
          width: calc(100% - 16px);
        }
        .visual-caption strong { font-size: 15px; }
        .visual-caption span { font-size: 12px; }
        .action-callout { max-width: calc(100% - 24px); }
        .event {
          gap: 5px 8px;
          grid-template-columns: 28px minmax(0, 1fr);
        }
        .event-copy,
        .timeline-meta,
        .links { grid-column: 2; }
        .links {
          align-items: start;
          justify-items: start;
        }
      }
    </style>
  </head>
  <body>
    <main class="shell">
      <header class="topbar">
        <div class="brand-line">
          <strong class="wordmark">atrib</strong>
          <span class="divider" aria-hidden="true"></span>
          <nav class="breadcrumbs" aria-label="Workflow path">
            <span>Workflows</span><span aria-hidden="true">&gt;</span>
            <strong>Vendor renewal approval</strong><span aria-hidden="true">&gt;</span>
            <span id="runIdCrumb">Run pending</span>
          </nav>
        </div>
        <div class="run-controls">
          <span class="control-label">Policy decision</span>
          <div class="segmented" aria-label="Action policy mode">
            <button id="policyAllow" type="button" data-policy-mode="allow" aria-pressed="false">Allow</button>
            <button id="policyBlock" type="button" data-policy-mode="block" aria-pressed="false">Block</button>
            <button id="policyEscalate" type="button" data-policy-mode="escalate" aria-pressed="false">Escalate</button>
          </div>
          <button id="runButton" class="primary-action" type="button">Run proof</button>
        </div>
      </header>
      <section class="meta-strip" aria-label="Run metadata">
        <div class="meta-item"><span>Agent</span><strong>Stagehand (Browserbase)</strong></div>
        <div class="meta-item"><span>Environment</span><strong>Production-like fixture</strong></div>
        <div class="meta-item"><span>Workflow</span><strong>Vendor renewal approval</strong></div>
        <div class="meta-item"><span>Started</span><strong id="startedLabel">not started</strong></div>
        <div class="meta-item"><span>Duration</span><strong id="durationLabel">pending</strong></div>
        <div class="meta-item"><span>Status</span><strong id="statusChip" class="status-pill ready" role="status" aria-live="polite">Ready</strong></div>
      </section>
      <section class="workbench">
        <section class="panel" aria-label="Browser automation surface">
          <div class="panel-head">
            <div>
              <h2>Browserbase session</h2>
              <p>Stagehand drives the remote browser. atrib signs the moments that matter.</p>
            </div>
            <span id="modeLabel" class="tag pending">loading</span>
          </div>
          <div id="workflowPanel">
            <div class="empty">Loading workflow.</div>
          </div>
        </section>
        <aside class="panel" aria-label="atrib evidence timeline">
          <div class="panel-head">
            <div>
              <h2>atrib evidence timeline</h2>
              <p>Public records show tool names and hashes. Private browser material stays out.</p>
            </div>
            <button id="viewJsonButton" class="secondary-action" type="button" aria-controls="jsonPanel" aria-expanded="false">View JSON</button>
          </div>
          <div id="runPanel" class="timeline"></div>
          <div id="jsonPanel" class="json-panel" hidden>
            <span class="field-label">Run JSON</span>
            <pre id="jsonOutput">{}</pre>
          </div>
        </aside>
      </section>
    </main>
    <script>
      const runButton = document.getElementById('runButton');
      const runPanel = document.getElementById('runPanel');
      const workflowPanel = document.getElementById('workflowPanel');
      const modeLabel = document.getElementById('modeLabel');
      const statusChip = document.getElementById('statusChip');
      const startedLabel = document.getElementById('startedLabel');
      const durationLabel = document.getElementById('durationLabel');
      const runIdCrumb = document.getElementById('runIdCrumb');
      const policyButtons = Array.from(document.querySelectorAll('[data-policy-mode]'));
      const jsonPanel = document.getElementById('jsonPanel');
      const jsonOutput = document.getElementById('jsonOutput');
      const viewJsonButton = document.getElementById('viewJsonButton');
      let selectedPolicyMode = 'allow';
      let latestRun = null;
      let latestConfig = null;
      let selectedMediaMode = 'simulated';
      let selectedMediaKey = '';
      let visualPlaybackKey = '';
      let visualTimers = [];

      async function loadConfig() {
        const response = await fetch('/api/config');
        const config = await response.json();
        latestConfig = config;
        syncSelectedMediaMode(config.visual, 'config:' + config.mode);
        renderWorkflow(config.workflow, { visual: config.visual });
        renderPlannedTimeline(config.workflow);
        setSelectedPolicyMode((config.action_policy && config.action_policy.mode) || 'allow');
        modeLabel.textContent = config.mode + (config.public_log ? ' with public log' : ' with local log');
        renderJson(config);
        if (config.deployment_guard_issues && config.deployment_guard_issues.length > 0) {
          setStatus('Guard failed', 'failed');
          runButton.disabled = true;
          renderError(config.deployment_guard_issues.join('; '));
          return;
        }
        if (config.mode === 'live' && !config.live_ready) {
          setStatus('Missing live env', 'failed');
          runButton.disabled = true;
          return;
        }
        setStatus('Ready', 'ready');
        await loadLatestRun();
      }

      async function loadLatestRun() {
        const response = await fetch('/api/runs');
        const body = await response.json();
        if (!response.ok || !Array.isArray(body.runs) || body.runs.length === 0) return;
        const run = body.runs[0];
        renderRun(run);
        if (run.status === 'running') {
          setStatus('Running', 'running');
          const completed = await pollRun(run.run_id);
          renderRun(completed);
          setStatus(completed.status === 'accepted' ? 'Completed' : 'Failed', completed.status);
          return;
        }
        setStatus(run.status === 'accepted' ? 'Completed' : 'Failed', run.status);
      }

      async function runProof() {
        runButton.disabled = true;
        setStatus('Running', 'running');
        renderRunning();
        try {
          const response = await fetch('/api/runs', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ action_policy_mode: selectedPolicyMode }),
          });
          const body = await response.json();
          if (!response.ok || !body.run) throw new Error(body.error || body.run?.error || 'run failed');
          renderRun(body.run);
          const run = body.run.status === 'running' ? await pollRun(body.run.run_id) : body.run;
          renderRun(run);
          setStatus(run.status === 'accepted' ? 'Completed' : 'Failed', run.status);
        } catch (error) {
          renderError(error instanceof Error ? error.message : String(error));
          setStatus('Failed', 'failed');
        } finally {
          runButton.disabled = false;
        }
      }

      async function pollRun(runId) {
        const started = Date.now();
        while (Date.now() - started < 135000) {
          await delay(1000);
          const response = await fetch('/api/runs/' + encodeURIComponent(runId));
          const body = await response.json();
          if (!response.ok || !body.run) throw new Error(body.error || 'run lookup failed');
          renderRun(body.run);
          if (body.run.status !== 'running') return body.run;
        }
        throw new Error('proof run timed out');
      }

      function delay(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
      }

      function renderRun(run) {
        latestRun = run;
        if (run.visual) syncSelectedMediaMode(run.visual, run.run_id + ':' + run.status);
        if (run.workflow) renderWorkflow(run.workflow, run);
        runIdCrumb.textContent = 'Run ' + run.run_id;
        startedLabel.textContent = formatDate(run.started_at);
        durationLabel.textContent = run.finished_at ? durationLabelText(run.started_at, run.finished_at) : 'running';
        renderTimeline(evidenceEntries(run));
        renderJson(run);
        if (run.visual) startVisualPlayback(run.visual, run.run_id + ':' + run.status + ':' + run.action_policy_mode);
      }

      function renderWorkflow(workflow, run) {
        if (!workflow) {
          workflowPanel.innerHTML = '<div class="empty">Workflow unavailable.</div>';
          return;
        }
        const targetPage = workflow.target_page || {};
        const target =
          disclosedValue(workflow.target_url) === 'https://example.com' && targetPage.route
            ? window.location.origin + targetPage.route
            : disclosedValue(workflow.target_url);
        const visual = (run && run.visual) || (latestConfig && latestConfig.visual);
        workflowPanel.innerHTML =
          '<div class="browser-shell">' +
          '<div class="stage-strip"><span class="stage-kicker">Stagehand on Browserbase</span><span class="stage-flow">remote browser | observe | gate | click | replay</span></div>' +
          '<div class="browser-chrome">' +
          '<div class="browser-row"><span class="dot red"></span><span class="dot amber"></span><span class="dot green"></span><span class="tab">Vendor portal</span></div>' +
          '<div class="browser-row"><span class="address">' + escapeHtml(target) + '</span></div>' +
          '</div>' +
          renderMediaStrip(visual) +
          '<div id="targetFrameShell" class="target-frame">' +
          '<iframe id="targetFrame" src="' +
          escapeHtml((targetPage.route || '/target') + '?embedded=1') +
          '" title="Agent-ready WebMCP target"></iframe>' +
          '<div class="visual-overlay" aria-hidden="true">' +
          '<span class="visual-spotlight"></span>' +
          '<span id="visualCursor" class="visual-cursor"></span>' +
          '<span id="clickRing" class="click-ring"></span>' +
          '<span id="visualActionCallout" class="action-callout">Ready</span>' +
          '<div class="visual-caption"><strong id="visualCaptionTitle">Ready for browser playback</strong><span id="visualCaptionText">' +
          escapeHtml(visual ? visual.media.note : 'The browser playback follows the signed proof sequence.') +
          '</span><div class="visual-progress"><span id="visualProgressBar" class="visual-progress-bar"></span></div></div>' +
          '</div></div>' +
          '<div class="visual-footnotes"><span>' +
          escapeHtml(visual ? visual.media.note : 'No visual state loaded yet.') +
          '</span><button id="replayVisual" class="secondary-action" type="button">Replay motion</button></div>' +
          '</div>' +
          '<div class="workflow-summary">' +
          '<div class="fact"><span>Target shape</span><strong>' +
          escapeHtml((targetPage.shape || 'webapp') + ' with ' + (targetPage.native_webmcp_api || 'document.modelContext')) +
          '</strong></div>' +
          '<div class="fact"><span>Boundary</span><strong>' +
          escapeHtml(targetPage.boundary || 'hash-only browser evidence') +
          '</strong></div>' +
          '<div class="fact"><span>Stagehand steps</span><strong>' +
          escapeHtml((workflow.stagehand_steps || []).map((step) => step.primitive + ':' + stepState(step.tool, run).label).join(' -> ')) +
          '</strong></div>' +
          '</div>';
        if (visual) setVisualIdle(visual);
      }

      function renderMediaStrip(visual) {
        const media = visual && visual.media ? visual.media : null;
        const activeMode = selectedMediaMode || preferredMediaMode(visual);
        const liveAvailable = Boolean(media && media.live_view && media.live_view.available);
        const replayAvailable = Boolean(media && media.replay && media.replay.available);
        const liveLink = activeMode === 'live' && media && media.live_view && media.live_view.available && media.live_view.url
          ? '<a class="media-link" href="' + escapeHtml(media.live_view.url) + '" target="_blank" rel="noreferrer">Open Live View</a>'
          : '';
        const replayLink = activeMode === 'replay' && media && media.replay && media.replay.available && media.replay.url
          ? '<a class="media-link" href="' + escapeHtml(media.replay.url) + '" target="_blank" rel="noreferrer">Open Replay</a>'
          : '';
        const replayProxy = activeMode === 'replay' && media && media.replay && media.replay.available && media.replay.proxy_path
          ? '<a class="media-link" href="' + escapeHtml(media.replay.proxy_path) + '" target="_blank" rel="noreferrer">Replay proxy</a>'
          : '';
        const sessionHash = media && media.session && media.session.available && media.session.id_hash
          ? '<span class="media-note">session ' + escapeHtml(shortHash(media.session.id_hash)) + '</span>'
          : '';
        const selectedAvailable =
          activeMode === 'simulated' || (activeMode === 'live' && liveAvailable) || (activeMode === 'replay' && replayAvailable);
        const sourceLabel = activeMode === 'simulated'
          ? 'local playback'
          : selectedAvailable && media && media.source === 'tool-result'
            ? 'from this run'
            : selectedAvailable && media && media.source === 'env'
              ? 'operator supplied'
              : 'not exposed by run';
        const stateLabel = mediaStateLabel(activeMode, selectedAvailable);
        return '<div class="media-strip">' +
          '<div class="media-tabs" role="group" aria-label="browser media mode">' +
          mediaModeButton('live', 'Live', activeMode, liveAvailable) +
          mediaModeButton('replay', 'Replay', activeMode, replayAvailable) +
          mediaModeButton('simulated', 'Simulated', activeMode, true) +
          '</div>' +
          '<span class="media-copy"><span class="visual-state"><span class="pulse-dot" aria-hidden="true"></span><span id="visualStateLabel">' +
          escapeHtml(stateLabel) +
          '</span></span><span class="media-note">' + escapeHtml(sourceLabel) + '</span>' + sessionHash + '</span>' +
          '<span class="media-actions">' + liveLink + replayLink + replayProxy + '</span>' +
          '</div>';
      }

      function mediaModeButton(mode, label, activeMode, available) {
        const classes = ['media-tab'];
        if (activeMode === mode) classes.push('active');
        if (!available) classes.push('unavailable');
        return '<button class="' + classes.join(' ') + '" type="button" data-media-mode="' +
          escapeHtml(mode) + '" aria-pressed="' + (activeMode === mode ? 'true' : 'false') + '">' +
          escapeHtml(label) +
          '</button>';
      }

      function mediaStateLabel(mode, available) {
        if (mode === 'live') return available ? 'Live Browserbase session' : 'Live View unavailable';
        if (mode === 'replay') return available ? 'Browserbase replay' : 'Replay unavailable';
        return 'Simulated playback';
      }

      function preferredMediaMode(visual) {
        const media = visual && visual.media ? visual.media : null;
        if (!media) return 'simulated';
        if (media.primary === 'live' && media.live_view && media.live_view.available) return 'live';
        if (media.primary === 'replay' && media.replay && media.replay.available) return 'replay';
        if (media.replay && media.replay.available) return 'replay';
        if (media.live_view && media.live_view.available) return 'live';
        return 'simulated';
      }

      function syncSelectedMediaMode(visual, key) {
        const media = visual && visual.media ? visual.media : null;
        const nextKey = [
          key,
          media ? media.primary : 'none',
          media && media.session ? media.session.id_hash || '' : '',
          media && media.replay ? media.replay.proxy_path || media.replay.url || '' : '',
          media && media.live_view ? media.live_view.url_hash || media.live_view.url || '' : '',
        ].join(':');
        if (selectedMediaKey === nextKey) return;
        selectedMediaKey = nextKey;
        selectedMediaMode = preferredMediaMode(visual);
      }

      function renderPlannedTimeline(workflow) {
        const tools = workflow && workflow.atrib_receipts ? workflow.atrib_receipts.signed_tools : ['start', 'navigate', 'observe', 'act', 'extract', 'end'];
        renderTimeline(tools.map((tool, index) => ({
          status: index === 0 ? 'pending' : 'future',
          marker: String(index + 1),
          time: '-',
          title: toolLabel(tool),
          detail: index === 0 ? 'Ready to start a fresh Browserbase proof run.' : 'Waiting for prior step.',
          hash: 'pending',
          tag: tool,
          links: [],
        })));
      }

      function renderRunning() {
        renderTimeline([
          { status: 'pending', marker: '1', time: nowTime(), title: 'START - Browserbase session', detail: 'Proof run queued. Waiting for signed records.', hash: 'pending', tag: 'start', links: [] },
          { status: 'future', marker: '2', time: '-', title: 'NAVIGATE - Vendor portal', detail: 'Waiting for Browserbase session.', hash: 'pending', tag: 'navigate', links: [] },
          { status: 'future', marker: '3', time: '-', title: 'OBSERVE - Read page state', detail: 'Waiting for navigation.', hash: 'pending', tag: 'observe', links: [] },
        ]);
      }

      function setVisualIdle(visual) {
        clearVisualTimers();
        visualPlaybackKey = '';
        const shell = document.getElementById('targetFrameShell');
        const cursor = document.getElementById('visualCursor');
        const ring = document.getElementById('clickRing');
        const title = document.getElementById('visualCaptionTitle');
        const text = document.getElementById('visualCaptionText');
        const callout = document.getElementById('visualActionCallout');
        const progress = document.getElementById('visualProgressBar');
        if (!shell || !cursor || !ring || !title || !text || !callout || !progress) return;
        const event = visual.events && visual.events[0] ? visual.events[0] : null;
        shell.classList.remove('is-playing', 'clicking', 'blocked', 'has-replay');
        if (event) moveVisualCursor(event);
        setTargetStage(event ? event.step : 'idle');
        title.textContent = selectedMediaMode === 'live' ? 'Ready for Live View' : selectedMediaMode === 'replay' ? 'Ready for replay' : 'Ready for simulated playback';
        text.textContent = visual.media.note;
        callout.textContent = 'Ready';
        progress.style.transform = 'scaleX(0)';
      }

      function startVisualPlayback(visual, key) {
        if (!visual || !Array.isArray(visual.events)) return;
        if (visualPlaybackKey === key) return;
        visualPlaybackKey = key;
        clearVisualTimers();
        const shell = document.getElementById('targetFrameShell');
        const title = document.getElementById('visualCaptionTitle');
        const text = document.getElementById('visualCaptionText');
        const progress = document.getElementById('visualProgressBar');
        if (!shell || !title || !text || !progress) return;
        shell.classList.add('is-playing', 'has-replay');
        shell.classList.remove('clicking', 'blocked');
        resetTargetFrame();
        visual.events.forEach((event) => {
          visualTimers.push(window.setTimeout(() => {
            moveVisualCursor(event);
            setTargetStage(event.step);
            title.textContent = event.label;
            text.textContent = event.caption;
            const callout = document.getElementById('visualActionCallout');
            if (callout) callout.textContent = event.label;
            const pct = visual.playback_ms > 0 ? Math.min(1, event.at_ms / visual.playback_ms) : 1;
            progress.style.transform = 'scaleX(' + pct + ')';
            if (event.target_action === 'approve') {
              clickTargetApproval();
              flashClick(false);
            } else if (event.target_action === 'hold') {
              shell.classList.add('blocked');
              flashClick(true);
            }
          }, event.at_ms));
        });
        visualTimers.push(window.setTimeout(() => {
          shell.classList.remove('is-playing', 'clicking');
          progress.style.transform = 'scaleX(1)';
        }, Math.max(visual.playback_ms + 220, 900)));
      }

      function clearVisualTimers() {
        visualTimers.forEach((timer) => window.clearTimeout(timer));
        visualTimers = [];
      }

      function moveVisualCursor(event) {
        const shell = document.getElementById('targetFrameShell');
        if (!shell || !event.cursor) return;
        const xPct = Number(event.cursor.x_pct) || 0;
        const yPct = Number(event.cursor.y_pct) || 0;
        const rect = shell.getBoundingClientRect();
        shell.style.setProperty('--visual-x', String(xPct) + '%');
        shell.style.setProperty('--visual-y', String(yPct) + '%');
        shell.style.setProperty('--visual-x-px', (rect.width * xPct / 100).toFixed(1) + 'px');
        shell.style.setProperty('--visual-y-px', (rect.height * yPct / 100).toFixed(1) + 'px');
      }

      function flashClick(blocked) {
        const shell = document.getElementById('targetFrameShell');
        if (!shell) return;
        shell.classList.remove('clicking');
        void shell.offsetWidth;
        shell.classList.add('clicking');
        if (!blocked) shell.classList.remove('blocked');
      }

      function resetTargetFrame() {
        const frame = document.getElementById('targetFrame');
        try {
          const body = frame && frame.contentWindow ? frame.contentWindow.document.body : null;
          if (!body) return;
          body.dataset.approved = 'false';
          body.dataset.reviewRouted = 'false';
          body.dataset.stageStep = 'idle';
          const status = frame.contentWindow.document.getElementById('approval-status');
          if (status) status.textContent = 'pending approval';
        } catch {
          // Cross-origin Browserbase media cannot be reset from the host page.
        }
      }

      function setTargetStage(step) {
        const frame = document.getElementById('targetFrame');
        try {
          const body = frame && frame.contentWindow ? frame.contentWindow.document.body : null;
          if (body) body.dataset.stageStep = step || 'idle';
        } catch {
          // Real Browserbase Live View can be cross-origin; the visual overlay remains host-owned.
        }
      }

      function clickTargetApproval() {
        const frame = document.getElementById('targetFrame');
        try {
          const button = frame && frame.contentWindow ? frame.contentWindow.document.getElementById('approve-renewal') : null;
          if (button) button.click();
        } catch {
          // Real Browserbase Live View remains host-owned; the proof runner performs the click.
        }
      }

      function renderTimeline(entries) {
        runPanel.className = 'timeline';
        runPanel.innerHTML = entries.map((entry) =>
          '<div class="event ' + escapeHtml(entry.status) + '">' +
          '<span class="event-marker">' + escapeHtml(entry.marker) + '</span>' +
          '<span class="timeline-meta">' + escapeHtml(entry.time) + '</span>' +
          '<span class="event-copy"><span class="event-title">' + escapeHtml(entry.title) + '</span><span class="event-detail">' +
          escapeHtml(entry.detail) +
          '</span><span class="event-hash">' + escapeHtml(shortHash(entry.hash)) + '</span></span>' +
          '<span class="links">' +
          (entry.links || []).map((link) => '<a href="' + escapeHtml(link.href) + '" target="_blank" rel="noreferrer">' + escapeHtml(link.label) + '</a>').join('') +
          '<span class="tag ' + tagClass(entry.status) + '">' + escapeHtml(entry.tag) + '</span></span></div>'
        ).join('');
      }

      function evidenceEntries(run) {
        const entries = [];
        const operations = run.operations || [];
        operations.forEach((operation) => {
          entries.push(operationEntry(operation, run));
          if (operation.step === 'observe') {
            (run.action_policy?.decisions || []).forEach((decision) => entries.push(policyDecisionEntry(decision)));
          }
          if (operation.step === 'act') {
            (run.action_policy?.outcomes || []).forEach((outcome) => entries.push(policyOutcomeEntry(outcome)));
          }
        });
        if (run.action_policy?.stopped_before && !(operations || []).some((operation) => operation.step === 'act')) {
          (run.action_policy.outcomes || []).forEach((outcome) => entries.push(policyOutcomeEntry(outcome)));
        }
        if (run.status === 'failed' && run.error) {
          entries.push({ status: 'err', marker: '!', time: nowTime(), title: 'RUN FAILED', detail: run.error, hash: 'not signed', tag: 'error', links: [] });
        }
        return entries.length ? entries : [{ status: 'pending', marker: '1', time: nowTime(), title: 'Proof running', detail: 'Waiting for the first signed record.', hash: 'pending', tag: 'running', links: [] }];
      }

      function operationEntry(operation, run) {
        return {
          status: run.status === 'failed' ? 'err' : 'ok',
          marker: String((operation.log_index ?? 0) + 1),
          time: run.finished_at ? formatTime(run.finished_at) : formatTime(run.started_at),
          title: toolLabel(operation.step),
          detail: operationDetail(operation.step),
          hash: operation.record_hash,
          tag: operation.step,
          links: [
            operation.explorer_url ? { label: 'Explorer', href: operation.explorer_url } : null,
            operation.log_proof_url ? { label: 'Log proof', href: operation.log_proof_url } : null,
          ].filter(Boolean),
        };
      }

      function policyDecisionEntry(decision) {
        const content = decision.content || {};
        const verdict = String(content.decision || decision.kind || 'decision');
        return {
          status: verdict === 'allow' ? 'ok' : verdict === 'block' ? 'err' : 'pending',
          marker: 'P',
          time: 'policy',
          title: 'POLICY DECISION - ' + verdict.toUpperCase(),
          detail: Array.isArray(content.reason_codes) ? content.reason_codes.join(', ') : 'policy decision signed',
          hash: decision.record_hash,
          tag: 'policy.evaluate',
          links: [],
        };
      }

      function policyOutcomeEntry(outcome) {
        const content = outcome.content || {};
        return {
          status: content.executed ? 'ok' : 'err',
          marker: 'O',
          time: 'outcome',
          title: 'POLICY OUTCOME',
          detail: content.executed ? 'Action executed after policy allow.' : 'Action stopped before ' + (content.stopped_before || 'act') + '.',
          hash: outcome.record_hash,
          tag: 'policy.outcome',
          links: [],
        };
      }

      function renderError(message) {
        runPanel.className = '';
        runPanel.innerHTML = '<div class="empty">' + escapeHtml(message) + '</div>';
      }

      function renderJson(value) {
        jsonOutput.textContent = JSON.stringify(value, null, 2);
      }

      function toolLabel(step) {
        const labels = {
          start: 'START - Browserbase session',
          navigate: 'NAVIGATE - Vendor portal',
          observe: 'OBSERVE - Read vendor risk',
          act: 'ACT - Approve vendor renewal',
          extract: 'EXTRACT - Confirmation fields',
          end: 'END - Session cleanup',
        };
        return labels[step] || String(step).toUpperCase();
      }

      function operationDetail(step) {
        const details = {
          start: 'Browserbase session opened. Session and replay refs stay private.',
          navigate: 'The browser reached the fixed WebMCP target page.',
          observe: 'Stagehand read visible renewal state and page tool affordances.',
          act: 'The action ran only after the policy gate allowed it.',
          extract: 'Stagehand extracted confirmation status and tool names.',
          end: 'Cleanup ran and the session boundary closed.',
        };
        return details[step] || 'Signed Browserbase MCP tool call.';
      }

      function stepState(tool, run) {
        if (!run) return { label: 'ready' };
        const operations = (run.operations || []).map((operation) => operation.step);
        if (operations.includes(tool)) return { label: 'signed' };
        if (run.action_policy && run.action_policy.stopped_before === tool) return { label: 'stopped' };
        if (run.status === 'accepted') return { label: 'skipped' };
        return { label: 'pending' };
      }

      function disclosedValue(field) {
        if (!field) return 'unavailable';
        if (field.value) return field.value;
        if (field.hash) return 'private hash ' + field.hash;
        return 'private hash-only';
      }

      function setStatus(label, status) {
        statusChip.textContent = label;
        statusChip.className = 'status-pill ' + (status === 'accepted' ? 'accepted' : status === 'running' ? 'running' : status === 'failed' ? 'failed' : 'ready');
      }

      function setSelectedPolicyMode(mode) {
        selectedPolicyMode = ['allow', 'block', 'escalate'].includes(mode) ? mode : 'allow';
        policyButtons.forEach((button) => {
          const active = button.dataset.policyMode === selectedPolicyMode;
          button.classList.toggle('active', active);
          button.setAttribute('aria-pressed', active ? 'true' : 'false');
        });
      }

      function durationLabelText(start, finish) {
        const ms = Math.max(0, new Date(finish).getTime() - new Date(start).getTime());
        return String(Math.round(ms / 1000)) + 's';
      }

      function formatDate(value) {
        if (!value) return 'not started';
        return new Date(value).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
      }

      function formatTime(value) {
        if (!value) return '-';
        return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      }

      function nowTime() {
        return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      }

      function shortHash(hash) {
        if (!hash || hash === 'pending' || hash === 'not signed') return hash || 'pending';
        const normalized = String(hash).replace(/^sha256:/, '');
        return 'sha256:' + normalized.slice(0, 12) + '...' + normalized.slice(-8);
      }

      function tagClass(status) {
        if (status === 'ok') return 'ok';
        if (status === 'err') return 'err';
        return 'pending';
      }

      function escapeHtml(value) {
        return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
      }

      runButton.addEventListener('click', runProof);
      workflowPanel.addEventListener('click', (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;
        if (target.dataset.mediaMode) {
          selectedMediaMode = target.dataset.mediaMode;
          const sourceRun = latestRun || (latestConfig ? { workflow: latestConfig.workflow, visual: latestConfig.visual } : null);
          if (sourceRun && sourceRun.workflow) renderWorkflow(sourceRun.workflow, sourceRun);
          return;
        }
        if (target.id !== 'replayVisual') return;
        const visual = latestRun && latestRun.visual ? latestRun.visual : latestConfig && latestConfig.visual;
        if (visual) startVisualPlayback(visual, 'manual:' + Date.now());
      });
      policyButtons.forEach((button) => {
        button.addEventListener('click', () => setSelectedPolicyMode(button.dataset.policyMode || 'allow'));
      });
      viewJsonButton.addEventListener('click', () => {
        jsonPanel.hidden = !jsonPanel.hidden;
        viewJsonButton.textContent = jsonPanel.hidden ? 'View JSON' : 'Hide JSON';
        viewJsonButton.setAttribute('aria-expanded', jsonPanel.hidden ? 'false' : 'true');
        if (latestRun) renderJson(latestRun);
      });
      loadConfig().catch((error) => {
        setStatus('Config failed', 'failed');
        renderError(error instanceof Error ? error.message : String(error));
      });
    </script>
  </body>
</html>`;
}
