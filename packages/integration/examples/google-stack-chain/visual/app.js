const state = {
  data: null,
  selectedId: 'ap2',
  runtimeUrl: '',
  runtimeState: null,
  activeRun: null,
  runtimeCanWrite: false,
}

const nodes = {
  status: document.querySelector('#proofStatus'),
  snapshotLabel: document.querySelector('#snapshotLabel'),
  strategyText: document.querySelector('#strategyText'),
  snapshotSchema: document.querySelector('#snapshotSchema'),
  commandText: document.querySelector('#commandText'),
  copyCommand: document.querySelector('#copyCommand'),
  copyHash: document.querySelector('#copyHash'),
  chain: document.querySelector('#chain'),
  mobileTabs: document.querySelector('#mobileTabs'),
  valueList: document.querySelector('#valueList'),
  caveatList: document.querySelector('#caveatList'),
  analyticsRows: document.querySelector('#analyticsRows'),
  analyticsCaveat: document.querySelector('#analyticsCaveat'),
  selectedTitle: document.querySelector('#selectedTitle'),
  selectedHash: document.querySelector('#selectedHash'),
  parentList: document.querySelector('#parentList'),
  checkList: document.querySelector('#checkList'),
  evidenceText: document.querySelector('#evidenceText'),
  valueText: document.querySelector('#valueText'),
  protocolBadge: document.querySelector('#protocolBadge'),
  runtimeStatus: document.querySelector('#runtimeStatus'),
  runtimeReason: document.querySelector('#runtimeReason'),
  runtimeDecision: document.querySelector('#runtimeDecision'),
  runtimeRunId: document.querySelector('#runtimeRunId'),
  runtimeRecordHash: document.querySelector('#runtimeRecordHash'),
  runtimeAdkHash: document.querySelector('#runtimeAdkHash'),
  runtimeSource: document.querySelector('#runtimeSource'),
  runtimeChecks: document.querySelector('#runtimeChecks'),
  runtimePrompt: document.querySelector('#runtimePrompt'),
  startRuntimeRun: document.querySelector('#startRuntimeRun'),
  refreshRuntime: document.querySelector('#refreshRuntime'),
  writeRuntimeAnalytics: document.querySelector('#writeRuntimeAnalytics'),
  toast: document.querySelector('#toast'),
}

async function init() {
  state.data = await loadSnapshot()
  state.runtimeUrl = getRuntimeUrl()
  state.selectedId = state.data.nodes[0].id
  renderStatic()
  selectNode(state.selectedId)
  initRuntime()
}

async function loadSnapshot() {
  if (window.location.protocol === 'file:' && window.GOOGLE_STACK_PROOF_SNAPSHOT) {
    return window.GOOGLE_STACK_PROOF_SNAPSHOT
  }
  try {
    const response = await fetch('./proof-snapshot.json')
    if (!response.ok) {
      throw new Error(`Unable to load visual snapshot: ${response.status}`)
    }
    return await response.json()
  } catch (error) {
    if (window.GOOGLE_STACK_PROOF_SNAPSHOT) return window.GOOGLE_STACK_PROOF_SNAPSHOT
    throw error
  }
}

function renderStatic() {
  const data = state.data
  nodes.status.textContent = data.status
  nodes.snapshotLabel.textContent = `${data.snapshot.schema}, ${data.nodes.length} records`
  nodes.strategyText.textContent = data.strategy
  nodes.snapshotSchema.textContent = data.snapshot.schema
  nodes.commandText.textContent = data.command
  nodes.analyticsCaveat.textContent = data.analytics.caveat

  nodes.valueList.replaceChildren(
    ...data.value_add.map((item) => {
      const li = document.createElement('li')
      li.textContent = item
      return li
    }),
  )

  nodes.caveatList.replaceChildren(
    ...data.caveats.map((item) => {
      const li = document.createElement('li')
      li.textContent = item
      return li
    }),
  )

  nodes.chain.replaceChildren(...data.nodes.map(renderChainNode))
  nodes.mobileTabs.replaceChildren(...data.nodes.map(renderMobileTab))
  nodes.analyticsRows.replaceChildren(...data.analytics.rows.map(renderAnalyticsRow))

  nodes.copyCommand.addEventListener('click', () => copyText(data.command, 'Command copied'))
  nodes.copyHash.addEventListener('click', () => {
    const selected = getSelectedNode()
    copyText(selected.record_hash, 'Record hash copied')
  })

  document.querySelectorAll('.segment').forEach((button) => {
    button.addEventListener('click', () => {
      document.querySelectorAll('.segment').forEach((item) => item.classList.remove('active'))
      document
        .querySelectorAll('.segment')
        .forEach((item) => item.setAttribute('aria-pressed', 'false'))
      button.classList.add('active')
      button.setAttribute('aria-pressed', 'true')
      const view = button.dataset.view
      if (view === 'analytics') {
        scrollToSection(document.querySelector('#analyticsBand'))
      }
      if (view === 'limits') {
        scrollToSection(document.querySelector('.muted-panel'))
      }
    })
  })

  nodes.startRuntimeRun.addEventListener('click', () => startRuntimeRun(false))
  nodes.refreshRuntime.addEventListener('click', () => refreshRuntimePanel())
  nodes.writeRuntimeAnalytics.addEventListener('click', () => startRuntimeRun(true))
}

function renderChainNode(item, index) {
  const button = document.createElement('button')
  button.className = 'node'
  button.type = 'button'
  button.dataset.nodeId = item.id
  button.setAttribute('aria-label', `Inspect ${item.label}`)
  button.setAttribute('aria-pressed', 'false')
  button.innerHTML = `
    <span class="node-index">${index + 1}</span>
    <div>
      <h3>${escapeHtml(item.label)}</h3>
      <p>${escapeHtml(item.actor)}</p>
    </div>
    <code class="node-hash">${shortHash(item.record_hash)}</code>
    <p>${escapeHtml(item.evidence)}</p>
    <div class="node-footer">
      <span class="protocol-pill ${protocolClass(item.protocol)}">${escapeHtml(item.protocol)}</span>
      <span class="badge">${escapeHtml(item.verifier)}</span>
    </div>
  `
  button.addEventListener('click', () => selectNode(item.id))
  return button
}

function renderMobileTab(item) {
  const button = document.createElement('button')
  button.className = 'mobile-tab'
  button.type = 'button'
  button.dataset.nodeId = item.id
  button.textContent = item.protocol
  button.setAttribute('aria-pressed', 'false')
  button.addEventListener('click', () => selectNode(item.id))
  return button
}

function renderAnalyticsRow(row) {
  const tr = document.createElement('tr')
  const nodeId = row.node_id ?? 'ap2'
  tr.dataset.nodeId = nodeId
  tr.tabIndex = 0
  tr.setAttribute('role', 'button')
  tr.setAttribute('aria-label', `Inspect ${row.protocol} analytics row`)
  tr.innerHTML = `
    <td data-label="Protocol">${escapeHtml(row.protocol)}</td>
    <td data-label="Event" title="${escapeHtml(row.event_type)}">${escapeHtml(formatEvent(row.event_type))}</td>
    <td data-label="Agent">${escapeHtml(row.agent)}</td>
    <td data-label="Trace"><code>${escapeHtml(shortTrace(row.trace_id))}</code></td>
    <td data-label="Record"><code>${shortHash(row.atrib_record_hash)}</code></td>
  `
  tr.addEventListener('click', () => selectNode(nodeId))
  tr.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    selectNode(nodeId)
  })
  return tr
}

function initRuntime() {
  if (!state.runtimeUrl) {
    renderRuntimeUnavailable(
      'Static fallback',
      'Add ?runtime=https://your-cloud-run-url or set runtime-config.js to show live verifier state.',
    )
    return
  }
  loadRuntimeState()
}

async function loadRuntimeState() {
  if (!state.runtimeUrl) {
    initRuntime()
    return
  }
  renderRuntimePending('Checking runtime')
  try {
    const response = await fetch(`${state.runtimeUrl}/v1/runtime-state`, {
      headers: { accept: 'application/json' },
    })
    if (!response.ok) throw new Error(`Runtime returned HTTP ${response.status}`)
    const payload = await response.json()
    state.runtimeState = payload
    state.runtimeCanWrite = payload.capabilities?.analytics_write_enabled === true
    renderRuntimeState(payload)
  } catch (error) {
    renderRuntimeUnavailable(
      'Runtime unavailable',
      error instanceof Error ? error.message : String(error),
    )
  }
}

async function refreshRuntimePanel() {
  if (!state.activeRun) {
    await loadRuntimeState()
    return
  }
  try {
    renderRuntimePending('Refreshing run')
    const response = await fetch(`${state.runtimeUrl}/api/runs/${encodeURIComponent(state.activeRun.run_id)}`, {
      headers: { accept: 'application/json' },
    })
    const payload = await response.json()
    if (!response.ok || payload.ok !== true) {
      throw new Error(payload.error ?? `Runtime returned HTTP ${response.status}`)
    }
    state.activeRun = payload.run
    renderActiveRuntimeRun(payload.run, null)
  } catch (error) {
    renderRuntimeUnavailable('Refresh failed', error instanceof Error ? error.message : String(error))
  }
}

async function startRuntimeRun(writeAnalytics) {
  if (!state.runtimeUrl) {
    showToast('Runtime URL missing')
    return
  }
  renderRuntimePending(writeAnalytics ? 'Writing rows' : 'Starting run')
  try {
    const response = await fetch(`${state.runtimeUrl}/api/runs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        mode: 'replay',
        prompt: nodes.runtimePrompt.value,
        writeAnalytics,
      }),
    })
    const payload = await response.json()
    if (!response.ok || !payload.run) {
      throw new Error(payload.error ?? `Runtime returned HTTP ${response.status}`)
    }
    state.activeRun = payload.run
    renderActiveRuntimeRun(payload.run, payload.analytics_write)
    showToast(writeAnalytics ? 'Runtime run finished' : 'Run complete')
  } catch (error) {
    renderRuntimeUnavailable('Run failed', error instanceof Error ? error.message : String(error))
  }
}

function renderRuntimeState(payload) {
  const gate = payload.gate
  if (!gate) {
    renderRuntimeUnavailable(
      'Runtime response missing gate',
      'The runtime did not return verifier state.',
    )
    return
  }
  nodes.runtimeStatus.textContent = gate.allowed ? 'Allowed' : 'Blocked'
  nodes.runtimeStatus.className = `runtime-chip ${gate.allowed ? 'good' : 'bad'}`
  nodes.runtimeReason.textContent = gate.reason
  nodes.startRuntimeRun.disabled = false
  nodes.startRuntimeRun.textContent = 'Start run'
  nodes.runtimeRunId.textContent = 'state check'
  nodes.runtimeDecision.textContent = formatEvent(gate.decision)
  nodes.runtimeRecordHash.textContent = shortHash(gate.record_hash)
  nodes.runtimeRecordHash.title = gate.record_hash
  nodes.runtimeAdkHash.textContent = 'not run'
  nodes.runtimeAdkHash.title = ''
  nodes.runtimeSource.textContent = gate.packet_source
  nodes.writeRuntimeAnalytics.disabled = !state.runtimeCanWrite
  nodes.writeRuntimeAnalytics.textContent = state.runtimeCanWrite ? 'Write rows' : 'Operator write only'
  nodes.runtimeChecks.replaceChildren(
    ...gate.checks.map((check) => {
      const li = document.createElement('li')
      li.className = check.ok ? 'ok' : 'bad'
      li.textContent = `${formatEvent(check.key)}: ${check.detail}`
      return li
    }),
  )
  renderAnalyticsRowsWithRuntime(gate.analytics_row)
}

function renderActiveRuntimeRun(run, analyticsWrite) {
  const adkStep = run.steps.find((step) => step.key === 'adk_tool_callback')
  nodes.runtimeStatus.textContent = run.status === 'complete' ? 'Complete' : 'Blocked'
  nodes.runtimeStatus.className = `runtime-chip ${run.ok ? 'good' : 'bad'}`
  nodes.runtimeReason.textContent = run.value_add?.pre_action_trust_transfer ?? run.gate.reason
  nodes.startRuntimeRun.disabled = false
  nodes.startRuntimeRun.textContent = 'Run again'
  nodes.runtimeRunId.textContent = run.run_id
  nodes.runtimeRunId.title = run.run_id
  nodes.runtimeDecision.textContent = formatEvent(run.gate.decision)
  nodes.runtimeRecordHash.textContent = shortHash(run.gate.record_hash)
  nodes.runtimeRecordHash.title = run.gate.record_hash
  nodes.runtimeAdkHash.textContent = shortHash(adkStep?.record_hash ?? 'pending')
  nodes.runtimeAdkHash.title = adkStep?.record_hash ?? ''
  nodes.runtimeSource.textContent = run.mode === 'replay' ? 'Cloud Run replay' : 'provided packet'
  nodes.writeRuntimeAnalytics.disabled = !state.runtimeCanWrite
  nodes.writeRuntimeAnalytics.textContent = state.runtimeCanWrite ? 'Write rows' : 'Operator write only'
  nodes.runtimeChecks.replaceChildren(...run.steps.map(renderRuntimeStep))
  nodes.analyticsRows.replaceChildren(...run.analytics_rows.map(renderRuntimeAnalyticsRow))
  if (analyticsWrite?.error) showToast(formatEvent(analyticsWrite.error))
}

function renderRuntimeStep(step) {
  const li = document.createElement('li')
  li.className = step.status === 'complete' ? 'ok' : 'bad'
  const hash = step.record_hash ? ` ${tinyHash(step.record_hash)}` : ''
  li.textContent = `${step.protocol}: ${step.label}.${hash}`
  return li
}

function renderRuntimePending(label) {
  nodes.runtimeStatus.textContent = label
  nodes.runtimeStatus.className = 'runtime-chip pending'
  nodes.runtimeReason.textContent = 'Waiting for the verifier endpoint.'
  nodes.startRuntimeRun.disabled = true
  nodes.startRuntimeRun.textContent = label
  nodes.runtimeRunId.textContent = state.activeRun?.run_id ?? 'pending'
  nodes.runtimeDecision.textContent = 'checking'
}

function renderRuntimeUnavailable(label, reason) {
  nodes.runtimeStatus.textContent = label
  nodes.runtimeStatus.className = 'runtime-chip idle'
  nodes.runtimeReason.textContent = reason
  nodes.runtimeDecision.textContent = 'not connected'
  nodes.startRuntimeRun.disabled = !state.runtimeUrl
  nodes.startRuntimeRun.textContent = 'Start run'
  nodes.runtimeRunId.textContent = 'not started'
  nodes.runtimeRecordHash.textContent = 'pending'
  nodes.runtimeAdkHash.textContent = 'pending'
  nodes.runtimeSource.textContent = state.runtimeUrl || 'static snapshot'
  nodes.runtimeChecks.replaceChildren()
  nodes.writeRuntimeAnalytics.disabled = true
  nodes.writeRuntimeAnalytics.textContent = 'Operator write only'
  nodes.analyticsRows.replaceChildren(...state.data.analytics.rows.map(renderAnalyticsRow))
}

function renderRuntimeAnalyticsRow(row) {
  return renderAnalyticsRow({
    ...row,
    node_id: nodeIdForRuntimeRow(row),
  })
}

function renderAnalyticsRowsWithRuntime(runtimeRow) {
  const runtimeRows = runtimeRow
    ? [
        {
          ...runtimeRow,
          node_id: 'ap2',
        },
      ]
    : []
  nodes.analyticsRows.replaceChildren(
    ...[...runtimeRows, ...state.data.analytics.rows].map(renderAnalyticsRow),
  )
}

function nodeIdForRuntimeRow(row) {
  if (row.event_type.includes('a2a.remote')) return 'a2a-remote'
  if (row.event_type.includes('a2a.receiver')) return 'a2a-receiver'
  if (row.event_type.includes('adk')) return 'adk-python'
  return 'ap2'
}

function selectNode(id) {
  state.selectedId = id
  const selected = getSelectedNode()
  nodes.selectedTitle.textContent = selected.label
  nodes.selectedHash.textContent = selected.record_hash
  nodes.protocolBadge.textContent = selected.protocol
  nodes.evidenceText.textContent = selected.evidence
  nodes.valueText.textContent = selected.value

  nodes.parentList.replaceChildren(
    ...(selected.parents.length
      ? selected.parents.map((parent) => {
          const code = document.createElement('code')
          code.textContent = parent
          return code
        })
      : [document.createElement('span')]),
  )
  if (!selected.parents.length)
    nodes.parentList.firstElementChild.textContent = 'Genesis for this bridge.'

  nodes.checkList.replaceChildren(
    ...selected.checks.map((check) => {
      const li = document.createElement('li')
      li.textContent = check
      return li
    }),
  )

  document.querySelectorAll('[data-node-id]').forEach((item) => {
    const active = item.dataset.nodeId === id
    item.classList.toggle('active', active)
    if (item.matches('button')) item.setAttribute('aria-pressed', String(active))
  })
  document.querySelectorAll('#analyticsRows tr').forEach((item) => {
    item.classList.toggle('selected', item.dataset.nodeId === id)
  })
}

function scrollToSection(element) {
  const behavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
  element.scrollIntoView({ behavior, block: 'nearest' })
}

function getSelectedNode() {
  return state.data.nodes.find((item) => item.id === state.selectedId)
}

function getRuntimeUrl() {
  const params = new URLSearchParams(window.location.search)
  const fromQuery = params.get('runtime')
  const fromConfig = window.GOOGLE_STACK_RUNTIME_URL
  const value = (fromQuery || fromConfig || '').trim()
  return value.endsWith('/') ? value.slice(0, -1) : value
}

async function copyText(value, message) {
  try {
    await navigator.clipboard.writeText(value)
    showToast(message)
  } catch {
    showToast('Select the text to copy')
  }
}

function showToast(message) {
  nodes.toast.textContent = message
  nodes.toast.classList.add('show')
  window.setTimeout(() => nodes.toast.classList.remove('show'), 1500)
}

function shortHash(value) {
  if (!value.startsWith('sha256:')) return value
  return `${value.slice(0, 18)}\u2026${value.slice(-12)}`
}

function tinyHash(value) {
  if (!value.startsWith('sha256:')) return value
  return `${value.slice(7, 15)}\u2026${value.slice(-6)}`
}

function shortTrace(value) {
  if (!value) return 'local-only'
  if (value.length <= 18) return value
  return `${value.slice(0, 12)}\u2026${value.slice(-6)}`
}

function formatEvent(value) {
  return value
    .replace(/^atrib\./, '')
    .replace(/^ap2\./, '')
    .replace(/^a2a\./, '')
    .replace(/^adk_js\./, '')
    .replace(/^adk_python\./, '')
    .replaceAll('_', ' ')
}

function protocolClass(protocol) {
  if (protocol.startsWith('ADK')) return 'ADK'
  return protocol
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

init().catch((error) => {
  nodes.status.textContent = 'Snapshot failed'
  nodes.snapshotLabel.textContent = error instanceof Error ? error.message : String(error)
})
