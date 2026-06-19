const state = {
  data: null,
  selectedId: null,
  viewMode: 'live',
  runtimeUrl: '',
  runtimeState: null,
  activeRun: null,
  runtimeSteps: [],
  runtimeCurrentKey: null,
  runtimeChainNodes: null,
  runtimeCanWrite: false,
}

const runtimeStages = [
  {
    key: 'ap2_gate',
    id: 'runtime-ap2',
    protocol: 'AP2',
    label: 'AP2 evidence gate',
    actor: 'atrib-google-evidence-runtime',
    source: 'verified replay packet',
    waiting: 'Waiting for AP2 receipt, VI evidence, and counterparty checks.',
    running: 'Verifying the AP2 packet before any downstream action runs.',
    complete: 'AP2 evidence accepted. Its atrib record can now become parent context.',
  },
  {
    key: 'a2a_handoff',
    id: 'runtime-a2a',
    protocol: 'A2A',
    label: 'A2A verifier handoff',
    actor: 'a2a-receiving-agent',
    source: 'fresh signed handoff',
    waiting: 'Waiting for verified AP2 parent evidence.',
    running: 'Creating the A2A handoff from the accepted AP2 record.',
    complete: 'A2A receiver signed a follow-up that cites the verified handoff evidence.',
  },
  {
    key: 'adk_tool_callback',
    id: 'runtime-adk-js',
    protocol: 'ADK JS',
    label: 'ADK JS tool callback',
    actor: 'google_adk_atrib_smoke_agent',
    source: 'fresh signed callback',
    waiting: 'Waiting for the A2A receiver record.',
    running: 'Running the ADK FunctionTool callback with the A2A parent record.',
    complete: 'ADK callback signed a record that cites the A2A receiver follow-up.',
  },
]

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
  analyticsTitle: document.querySelector('#analyticsTitle'),
  stageMode: document.querySelector('#stageMode'),
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
  runtimeRailTitle: document.querySelector('#runtimeRailTitle'),
  runtimeStatusDot: document.querySelector('#runtimeStatusDot'),
  runtimeFlow: document.querySelector('#runtimeFlow'),
  runtimeChecks: document.querySelector('#runtimeChecks'),
  runtimePrompt: document.querySelector('#runtimePrompt'),
  startRuntimeRun: document.querySelector('#startRuntimeRun'),
  refreshRuntime: document.querySelector('#refreshRuntime'),
  writeRuntimeAnalytics: document.querySelector('#writeRuntimeAnalytics'),
  viewLiveRun: document.querySelector('#viewLiveRun'),
  viewReferenceSnapshot: document.querySelector('#viewReferenceSnapshot'),
  stageTitle: document.querySelector('#stageTitle'),
  toast: document.querySelector('#toast'),
}

async function init() {
  state.data = await loadSnapshot()
  state.runtimeUrl = getRuntimeUrl()
  renderStatic()
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
  nodes.snapshotLabel.textContent = `reference snapshot loaded, ${data.nodes.length} records`
  nodes.strategyText.textContent = data.strategy
  nodes.snapshotSchema.textContent = data.snapshot.schema
  nodes.commandText.textContent = data.command
  nodes.analyticsCaveat.textContent =
    'Runtime rows appear after Start run. The pinned fixture is available in Reference view.'

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

  renderRuntimeFlow()
  renderLiveWaiting()

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
      if (view === 'live' || view === 'reference') {
        setViewMode(view)
      }
      if (view === 'analytics') {
        scrollToSection(document.querySelector('#analyticsBand'))
      }
      if (view === 'limits') {
        scrollToSection(document.querySelector('#proofBoundaries'))
      }
    })
  })

  nodes.startRuntimeRun.addEventListener('click', () => startRuntimeRun(false))
  nodes.refreshRuntime.addEventListener('click', () => refreshRuntimePanel())
  nodes.writeRuntimeAnalytics.addEventListener('click', () => startRuntimeRun(true))
  nodes.viewLiveRun.addEventListener('click', () => setViewMode('live'))
  nodes.viewReferenceSnapshot.addEventListener('click', () => setViewMode('reference'))
}

function setViewMode(mode) {
  state.viewMode = mode
  updateViewButtons()
  if (mode === 'reference') {
    renderReferenceSnapshot()
    return
  }
  if (state.activeRun || state.runtimeSteps.length || state.runtimeCurrentKey) {
    renderRuntimeChainFromProgress(state.activeRun)
    const selected = getSelectedNode()
    selectNode(selected?.id ?? (state.activeRun?.ok ? 'runtime-adk-js' : 'runtime-ap2'))
    renderRuntimeAnalyticsRows()
    return
  }
  renderLiveWaiting()
}

function updateViewButtons() {
  const live = state.viewMode === 'live'
  nodes.viewLiveRun.classList.toggle('active', live)
  nodes.viewReferenceSnapshot.classList.toggle('active', !live)
  nodes.viewLiveRun.setAttribute('aria-pressed', String(live))
  nodes.viewReferenceSnapshot.setAttribute('aria-pressed', String(!live))

  document.querySelectorAll('.segment').forEach((button) => {
    const active = button.dataset.view === state.viewMode
    button.classList.toggle('active', active)
    button.setAttribute('aria-pressed', String(active))
  })
}

function renderLiveWaiting() {
  state.selectedId = null
  state.runtimeChainNodes = null
  nodes.stageTitle.textContent = 'Live proof chain'
  nodes.stageMode.textContent =
    'Start a runtime run to populate the verifier chain. The AP2 packet is replayed; A2A and ADK records are freshly signed during the run.'
  renderChainEmpty(
    'Runtime records will appear here',
    'The reference artifact stays available, but this main chain remains empty until Cloud Run returns a run.',
  )
  renderInspectorEmpty(
    'No live record selected',
    'Start run to inspect the AP2 gate, A2A handoff, and ADK callback records.',
  )
  renderAnalyticsEmpty('Runtime analytics rows appear after Start run.')
}

function renderReferenceSnapshot() {
  state.selectedId = state.data.nodes[0].id
  state.runtimeChainNodes = null
  nodes.stageTitle.textContent = 'Reference artifact'
  nodes.stageMode.textContent =
    'Pinned local AP2, A2A, and ADK Python proof snapshot. It is inspectable evidence, not the active Cloud Run run.'
  renderChainCollection(state.data.nodes)
  nodes.analyticsTitle.textContent = 'Reference analytics fixture'
  nodes.analyticsCaveat.textContent = state.data.analytics.caveat
  nodes.analyticsRows.replaceChildren(...state.data.analytics.rows.map(renderAnalyticsRow))
  selectNode(state.selectedId)
}

function renderChainEmpty(title, detail) {
  const empty = document.createElement('div')
  empty.className = 'empty-chain'
  empty.innerHTML = `
    <span class="empty-icon" aria-hidden="true"></span>
    <div>
      <h3>${escapeHtml(title)}</h3>
      <p>${escapeHtml(detail)}</p>
    </div>
  `
  nodes.chain.classList.add('is-empty')
  nodes.chain.replaceChildren(empty)
  nodes.mobileTabs.replaceChildren()
}

function renderInspectorEmpty(title, detail) {
  nodes.protocolBadge.textContent = 'Live'
  nodes.selectedTitle.textContent = title
  nodes.selectedHash.textContent = 'pending'
  nodes.copyHash.disabled = true
  nodes.parentList.replaceChildren(emptyText('No parent record yet.'))
  nodes.checkList.replaceChildren(emptyListItem('Waiting for runtime evidence.'))
  nodes.evidenceText.textContent = detail
  nodes.valueText.textContent =
    'atrib turns accepted prior evidence into parent context for the next agent action.'
  document.querySelectorAll('[data-node-id]').forEach((item) => {
    item.classList.remove('active')
    if (item.matches('button')) item.setAttribute('aria-pressed', 'false')
  })
}

function renderAnalyticsEmpty(message) {
  nodes.analyticsTitle.textContent = 'Runtime analytics rows'
  nodes.analyticsCaveat.textContent = message
  const tr = document.createElement('tr')
  tr.className = 'empty-row'
  tr.innerHTML = `<td colspan="5">${escapeHtml(message)}</td>`
  nodes.analyticsRows.replaceChildren(tr)
}

function emptyText(text) {
  const span = document.createElement('span')
  span.textContent = text
  return span
}

function emptyListItem(text) {
  const li = document.createElement('li')
  li.className = 'neutral'
  li.textContent = text
  return li
}

function renderChainCollection(items) {
  nodes.chain.classList.remove('is-empty')
  nodes.chain.replaceChildren(...items.map(renderChainNode))
  nodes.mobileTabs.replaceChildren(...items.map(renderMobileTab))
}

function renderChainNode(item, index) {
  const button = document.createElement('button')
  const runtimeStatus = item.runtime_status ? ` ${item.runtime_status}` : ''
  button.className = `node${item.runtime_status ? ' runtime-node' : ''}${runtimeStatus}`
  button.type = 'button'
  button.dataset.nodeId = item.id
  button.setAttribute('aria-label', `Inspect ${item.label}`)
  button.setAttribute('aria-pressed', 'false')
  const statusBadge = item.runtime_status
    ? `<span class="badge runtime-state-badge ${escapeHtml(item.runtime_status)}">${escapeHtml(
        formatEvent(item.runtime_status),
      )}</span>`
    : `<span class="badge">${escapeHtml(item.verifier)}</span>`
  const sourceBadge = item.source
    ? `<span class="badge source-badge">${escapeHtml(item.source)}</span>`
    : ''
  button.innerHTML = `
    <span class="node-index">${index + 1}</span>
    <div>
      <h3>${escapeHtml(item.label)}</h3>
      <p title="${escapeHtml(item.actor)}">${escapeHtml(displayAgentName(item.actor))}</p>
    </div>
    <code class="node-hash">${shortHash(item.record_hash)}</code>
    <p>${escapeHtml(item.evidence)}</p>
    <div class="node-footer">
      <span class="protocol-pill ${protocolClass(item.protocol)}">${escapeHtml(item.protocol)}</span>
      ${sourceBadge}
      ${statusBadge}
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
    <td data-label="Agent" title="${escapeHtml(row.agent)}">${escapeHtml(displayAgentName(row.agent))}</td>
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
    const response = await fetch(
      `${state.runtimeUrl}/api/runs/${encodeURIComponent(state.activeRun.run_id)}`,
      {
        headers: { accept: 'application/json' },
      },
    )
    const payload = await response.json()
    if (!response.ok || payload.ok !== true) {
      throw new Error(payload.error ?? `Runtime returned HTTP ${response.status}`)
    }
    state.activeRun = payload.run
    renderActiveRuntimeRun(payload.run, null)
  } catch (error) {
    renderRuntimeUnavailable(
      'Refresh failed',
      error instanceof Error ? error.message : String(error),
    )
  }
}

async function startRuntimeRun(writeAnalytics) {
  if (!state.runtimeUrl) {
    showToast('Runtime URL missing')
    return
  }
  renderRuntimeStarted(writeAnalytics)
  try {
    const payload = await streamRuntimeRun(writeAnalytics)
    if (payload?.run) {
      showToast(writeAnalytics ? 'Runtime rows handled' : 'Runtime chain complete')
    }
  } catch (error) {
    renderRuntimeUnavailable('Run failed', error instanceof Error ? error.message : String(error))
  }
}

async function streamRuntimeRun(writeAnalytics) {
  const requestBody = JSON.stringify({
    mode: 'replay',
    prompt: nodes.runtimePrompt.value,
    writeAnalytics,
  })
  const response = await fetch(`${state.runtimeUrl}/api/runs/stream`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/x-ndjson, application/json',
    },
    body: requestBody,
  })
  if (!response.ok) throw new Error(`Runtime returned HTTP ${response.status}`)
  if (!response.body) return postRuntimeRun(requestBody)

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let finalRun = null
  let analyticsWrite = null

  while (true) {
    const { value, done } = await reader.read()
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.trim()) continue
      const parsed = JSON.parse(line)
      const result = handleRuntimeStreamMessage(parsed)
      if (result?.run) finalRun = result.run
      if (result?.analyticsWrite !== undefined) analyticsWrite = result.analyticsWrite
    }
    if (done) break
  }

  if (buffer.trim()) {
    const result = handleRuntimeStreamMessage(JSON.parse(buffer))
    if (result?.run) finalRun = result.run
    if (result?.analyticsWrite !== undefined) analyticsWrite = result.analyticsWrite
  }
  if (!finalRun) throw new Error('Runtime stream ended before run_completed')
  return { run: finalRun, analyticsWrite }
}

async function postRuntimeRun(requestBody) {
  const response = await fetch(`${state.runtimeUrl}/api/runs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: requestBody,
  })
  const payload = await response.json()
  if (!response.ok || !payload.run) {
    throw new Error(payload.error ?? `Runtime returned HTTP ${response.status}`)
  }
  state.activeRun = payload.run
  renderActiveRuntimeRun(payload.run, payload.analytics_write)
  return { run: payload.run, analyticsWrite: payload.analytics_write }
}

function handleRuntimeStreamMessage(message) {
  if (message.ok === false) throw new Error(message.error ?? 'runtime_stream_error')
  const event = message.event
  if (!event || typeof event.type !== 'string') return null
  if (event.type === 'run_started') {
    state.runtimeSteps = []
    state.runtimeCurrentKey = 'ap2_gate'
    nodes.runtimeRunId.textContent = event.run_id
    nodes.runtimeRunId.title = event.run_id
    nodes.runtimeSource.textContent =
      event.mode === 'replay' ? 'Cloud Run replay' : 'provided packet'
    renderRuntimeFlow()
    renderRuntimeChainFromProgress()
    selectNode('runtime-ap2')
    return null
  }
  if (event.type === 'step_started') {
    state.runtimeCurrentKey = event.key
    renderRuntimeStepStarted(event)
    return null
  }
  if (event.type === 'step_completed') {
    renderRuntimeStepCompleted(event.step)
    return null
  }
  if (event.type === 'run_completed' || event.type === 'run_blocked') {
    state.activeRun = event.run
    renderActiveRuntimeRun(event.run, null)
    return { run: event.run }
  }
  if (event.type === 'analytics_write') {
    if (event.analytics_write?.error) showToast(formatEvent(event.analytics_write.error))
    return { analyticsWrite: event.analytics_write }
  }
  return null
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
  state.activeRun = null
  state.runtimeSteps = []
  state.runtimeCurrentKey = null
  state.runtimeChainNodes = null
  if (state.viewMode === 'live') renderLiveWaiting()
  nodes.runtimeStatus.textContent = gate.allowed ? 'Ready' : 'Blocked'
  nodes.runtimeStatus.className = `runtime-chip ${gate.allowed ? 'ready' : 'bad'}`
  setRuntimeRail(gate.allowed ? 'Runtime ready' : 'Runtime blocked', gate.allowed ? 'ready' : 'bad')
  nodes.runtimeReason.textContent = gate.allowed
    ? 'Cloud Run is connected. Start a run to verify the AP2 replay packet, then sign fresh A2A and ADK records.'
    : gate.reason
  nodes.startRuntimeRun.disabled = false
  nodes.startRuntimeRun.textContent = 'Start run'
  nodes.runtimeRunId.textContent = 'not started'
  nodes.runtimeRunId.title = ''
  nodes.runtimeDecision.textContent = gate.allowed ? 'waiting for run' : formatEvent(gate.decision)
  nodes.runtimeRecordHash.textContent = gate.allowed ? 'ready' : shortHash(gate.record_hash)
  nodes.runtimeRecordHash.title = gate.record_hash
  nodes.runtimeAdkHash.textContent = 'pending'
  nodes.runtimeAdkHash.title = ''
  nodes.runtimeSource.textContent = gate.packet_source
  nodes.writeRuntimeAnalytics.disabled = !state.runtimeCanWrite
  nodes.writeRuntimeAnalytics.textContent = state.runtimeCanWrite ? 'Write rows' : 'Write locked'
  renderRuntimeFlow()
  nodes.runtimeChecks.replaceChildren(...renderRuntimePreflightChecks(gate))
  if (state.viewMode === 'live')
    renderAnalyticsEmpty('Runtime analytics rows appear after Start run.')
}

function renderActiveRuntimeRun(run, analyticsWrite) {
  const adkStep = run.steps.find((step) => step.key === 'adk_tool_callback')
  nodes.runtimeStatus.textContent = run.status === 'complete' ? 'Complete' : 'Blocked'
  nodes.runtimeStatus.className = `runtime-chip ${run.ok ? 'good' : 'bad'}`
  setRuntimeRail(
    run.status === 'complete' ? 'Runtime complete' : 'Runtime blocked',
    run.ok ? 'good' : 'bad',
  )
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
  nodes.writeRuntimeAnalytics.textContent = state.runtimeCanWrite ? 'Write rows' : 'Write locked'
  state.runtimeSteps = run.steps
  state.runtimeCurrentKey = null
  renderRuntimeFlow()
  state.viewMode = 'live'
  updateViewButtons()
  renderRuntimeChainFromProgress(run)
  nodes.runtimeChecks.replaceChildren(...run.steps.map(renderRuntimeStep))
  renderRuntimeAnalyticsRows()
  nodes.stageMode.textContent =
    'Active runtime path. AP2 is a verified replay packet; A2A and ADK are freshly signed for this run.'
  selectNode(run.ok ? 'runtime-adk-js' : 'runtime-ap2')
  if (analyticsWrite?.error) showToast(formatEvent(analyticsWrite.error))
}

function renderRuntimeStarted(writeAnalytics) {
  state.activeRun = null
  state.runtimeSteps = []
  state.runtimeCurrentKey = 'ap2_gate'
  state.viewMode = 'live'
  updateViewButtons()
  nodes.runtimeStatus.textContent = 'Running'
  nodes.runtimeStatus.className = 'runtime-chip pending'
  setRuntimeRail('Runtime running', 'pending')
  nodes.runtimeReason.textContent = writeAnalytics
    ? 'Streaming the AP2 to A2A to ADK path, then attempting the analytics write.'
    : 'Streaming the AP2 to A2A to ADK path from the runtime API.'
  nodes.startRuntimeRun.disabled = true
  nodes.startRuntimeRun.textContent = 'Running AP2 gate'
  nodes.runtimeRunId.textContent = 'starting'
  nodes.runtimeRunId.title = ''
  nodes.runtimeDecision.textContent = 'running'
  nodes.runtimeRecordHash.textContent = 'pending'
  nodes.runtimeRecordHash.title = ''
  nodes.runtimeAdkHash.textContent = 'pending'
  nodes.runtimeAdkHash.title = ''
  nodes.runtimeSource.textContent = 'Cloud Run stream'
  nodes.stageMode.textContent =
    'Active runtime stream. The chain updates as runtime evidence arrives.'
  nodes.runtimeChecks.replaceChildren()
  renderRuntimeFlow()
  renderRuntimeChainFromProgress()
  selectNode('runtime-ap2')
}

function renderRuntimeStepStarted(event) {
  const stage = runtimeStageByKey(event.key)
  nodes.runtimeStatus.textContent = 'Running'
  nodes.runtimeStatus.className = 'runtime-chip pending'
  setRuntimeRail(`Running ${event.protocol}`, 'pending')
  nodes.runtimeReason.textContent = stage?.running ?? event.label
  nodes.startRuntimeRun.textContent =
    event.key === 'a2a_handoff'
      ? 'Running A2A'
      : event.key === 'adk_tool_callback'
        ? 'Running ADK'
        : 'Running AP2 gate'
  renderRuntimeFlow()
  renderRuntimeChainFromProgress()
  selectNode(stage?.id ?? 'runtime-ap2')
}

function renderRuntimeStepCompleted(step) {
  state.runtimeSteps = [...state.runtimeSteps.filter((item) => item.key !== step.key), step].sort(
    (left, right) => runtimeStageIndex(left.key) - runtimeStageIndex(right.key),
  )
  state.runtimeCurrentKey = null
  nodes.runtimeReason.textContent = step.detail
  if (step.key === 'ap2_gate') {
    nodes.runtimeDecision.textContent = step.status === 'complete' ? 'AP2 accepted' : 'blocked'
    nodes.runtimeRecordHash.textContent = shortHash(step.record_hash ?? 'pending')
    nodes.runtimeRecordHash.title = step.record_hash ?? ''
  }
  if (step.key === 'adk_tool_callback') {
    nodes.runtimeAdkHash.textContent = shortHash(step.record_hash ?? 'pending')
    nodes.runtimeAdkHash.title = step.record_hash ?? ''
  }
  renderRuntimeFlow()
  renderRuntimeChainFromProgress()
  const stage = runtimeStageByKey(step.key)
  if (stage) selectNode(stage.id)
}

function renderRuntimeStep(step) {
  const li = document.createElement('li')
  li.className = step.status === 'complete' ? 'ok' : 'bad'
  const hash = step.record_hash ? ` ${tinyHash(step.record_hash)}` : ''
  li.textContent = `${step.protocol}: ${step.label}.${hash}`
  return li
}

function renderRuntimeFlow() {
  nodes.runtimeFlow.replaceChildren(
    ...runtimeStages.map((stage) => {
      const step = runtimeStepByKey(stage.key)
      const status = runtimeStatusForStage(stage)
      const li = document.createElement('li')
      li.className = `runtime-flow-step ${status}`
      const detail =
        step?.detail ??
        (status === 'running'
          ? stage.running
          : status === 'complete'
            ? stage.complete
            : stage.waiting)
      const hash = step?.record_hash
        ? `<code>${escapeHtml(shortHash(step.record_hash))}</code>`
        : ''
      li.innerHTML = `
        <span class="flow-dot" aria-hidden="true"></span>
        <div>
          <strong>${escapeHtml(stage.label)}</strong>
          <p>${escapeHtml(stage.source)}</p>
          <span class="flow-detail">${escapeHtml(detail)}</span>
          ${hash}
        </div>
        <span class="flow-state">${escapeHtml(formatEvent(status))}</span>
      `
      return li
    }),
  )
}

function renderRuntimePreflightChecks(gate) {
  return [
    {
      className: 'ok',
      text: 'Runtime connected: verifier endpoint returned AP2 state.',
    },
    {
      className: gate.allowed ? 'ok' : 'bad',
      text: gate.allowed
        ? `AP2 packet ready: ${shortHash(gate.record_hash)}`
        : `AP2 packet blocked: ${gate.reason}`,
    },
    {
      className: state.runtimeCanWrite ? 'ok' : 'neutral',
      text: state.runtimeCanWrite
        ? 'BigQuery write path enabled for operator-triggered rows.'
        : 'BigQuery write path is disabled in this public demo.',
    },
  ].map((item) => {
    const li = document.createElement('li')
    li.className = item.className
    li.textContent = item.text
    return li
  })
}

function renderRuntimeChainFromProgress(run = state.activeRun) {
  state.runtimeChainNodes = buildRuntimeChainNodes(run)
  renderChainCollection(state.runtimeChainNodes)
}

function renderRuntimeAnalyticsRows() {
  if (!state.activeRun?.analytics_rows?.length) {
    renderAnalyticsEmpty('Runtime analytics rows appear as AP2, A2A, and ADK stages complete.')
    return
  }
  nodes.analyticsTitle.textContent = 'Runtime analytics rows'
  nodes.analyticsCaveat.textContent =
    'Rows come from the active runtime response and carry atrib record hashes plus parent hashes.'
  nodes.analyticsRows.replaceChildren(
    ...state.activeRun.analytics_rows.map(renderRuntimeAnalyticsRow),
  )
}

function buildRuntimeChainNodes(run) {
  const ap2Step =
    runtimeStepByKey('ap2_gate') ?? run?.steps?.find((step) => step.key === 'ap2_gate')
  const a2aStep =
    runtimeStepByKey('a2a_handoff') ?? run?.steps?.find((step) => step.key === 'a2a_handoff')
  const adkStep =
    runtimeStepByKey('adk_tool_callback') ??
    run?.steps?.find((step) => step.key === 'adk_tool_callback')
  const byKey = {
    ap2_gate: ap2Step,
    a2a_handoff: a2aStep,
    adk_tool_callback: adkStep,
  }

  return runtimeStages.map((stage) => {
    const step = byKey[stage.key]
    const status = runtimeStatusForStage(stage, step)
    const recordHash = step?.record_hash ?? 'pending'
    const checks = checksForRuntimeNode(stage.key, step, run)
    return {
      id: stage.id,
      label: stage.label,
      protocol: stage.protocol,
      actor: runtimeActorForStage(stage, run),
      record_hash: recordHash,
      evidence:
        step?.detail ??
        (status === 'running'
          ? stage.running
          : status === 'complete'
            ? stage.complete
            : stage.waiting),
      parents: parentsForRuntimeNode(stage.key, step, run),
      checks,
      verifier: 'runtime stream',
      value: valueForRuntimeStage(stage.key),
      source: sourceForRuntimeStage(stage.key, run),
      runtime_status: status,
    }
  })
}

function sourceForRuntimeStage(key, run) {
  if (key === 'ap2_gate') {
    return run?.mode === 'provided_packet' ? 'provided AP2 packet' : 'verified replay packet'
  }
  if (key === 'a2a_handoff') return 'fresh signed handoff'
  return 'fresh signed callback'
}

function checksForRuntimeNode(key, step, run) {
  if (step?.checks?.length) {
    return step.checks.map((check) => `${formatEvent(check.key)}: ${check.detail}`)
  }
  if (key === 'a2a_handoff' && run?.chain) {
    return [
      `AP2 informs A2A remote: ${String(run.chain.ap2_informs_a2a_remote)}`,
      `A2A remote informs receiver: ${String(run.chain.a2a_remote_informs_receiver)}`,
    ]
  }
  if (key === 'adk_tool_callback' && run?.chain) {
    return [`A2A receiver informs ADK JS: ${String(run.chain.a2a_receiver_informs_adk_js)}`]
  }
  const stage = runtimeStageByKey(key)
  return [stage?.waiting ?? 'Waiting for runtime evidence.']
}

function parentsForRuntimeNode(key, step, run) {
  if (step?.informed_by?.length) return step.informed_by
  if (key === 'a2a_handoff' && run?.a2a?.evidence?.remote_record_hash) {
    return [run.a2a.evidence.remote_record_hash]
  }
  if (key === 'adk_tool_callback' && run?.a2a?.followup?.record_hash) {
    return [run.a2a.followup.record_hash]
  }
  return []
}

function runtimeActorForStage(stage, run) {
  if (stage.key === 'adk_tool_callback') {
    return (
      run?.analytics_rows?.find((row) => row.event_type.includes('adk_js'))?.agent ?? stage.actor
    )
  }
  return stage.actor
}

function valueForRuntimeStage(key) {
  if (key === 'ap2_gate') {
    return 'AP2 proves authority. atrib makes the accepted evidence a signed parent record.'
  }
  if (key === 'a2a_handoff') {
    return 'The receiving A2A agent gets verifier-accepted parent evidence, not just a task.'
  }
  return 'The ADK callback runs from the signed A2A/AP2 chain and signs its own follow-up.'
}

function runtimeStepByKey(key) {
  return state.runtimeSteps.find((step) => step.key === key)
}

function runtimeStageByKey(key) {
  return runtimeStages.find((stage) => stage.key === key)
}

function runtimeStageIndex(key) {
  return runtimeStages.findIndex((stage) => stage.key === key)
}

function runtimeStatusForStage(stage, step = runtimeStepByKey(stage.key)) {
  if (step?.status === 'complete') return 'complete'
  if (step?.status === 'blocked') return 'blocked'
  if (state.runtimeCurrentKey === stage.key) return 'running'
  return 'waiting'
}

function renderRuntimePending(label) {
  nodes.runtimeStatus.textContent = label
  nodes.runtimeStatus.className = 'runtime-chip pending'
  setRuntimeRail(label, 'pending')
  nodes.runtimeReason.textContent = 'Waiting for the verifier endpoint.'
  nodes.startRuntimeRun.disabled = true
  nodes.startRuntimeRun.textContent = label
  nodes.runtimeRunId.textContent = state.activeRun?.run_id ?? 'pending'
  nodes.runtimeDecision.textContent = 'checking'
}

function renderRuntimeUnavailable(label, reason) {
  state.runtimeSteps = []
  state.runtimeCurrentKey = null
  state.runtimeChainNodes = null
  nodes.runtimeStatus.textContent = label
  nodes.runtimeStatus.className = 'runtime-chip idle'
  setRuntimeRail(label, 'idle')
  nodes.runtimeReason.textContent = reason
  nodes.runtimeDecision.textContent = 'not connected'
  nodes.startRuntimeRun.disabled = !state.runtimeUrl
  nodes.startRuntimeRun.textContent = 'Start run'
  nodes.runtimeRunId.textContent = 'not started'
  nodes.runtimeRecordHash.textContent = 'pending'
  nodes.runtimeAdkHash.textContent = 'pending'
  nodes.runtimeSource.textContent = state.runtimeUrl || 'static snapshot'
  nodes.runtimeFlow.replaceChildren()
  nodes.runtimeChecks.replaceChildren()
  nodes.writeRuntimeAnalytics.disabled = true
  nodes.writeRuntimeAnalytics.textContent = 'Write locked'
  if (state.viewMode === 'live') renderLiveWaiting()
}

function setRuntimeRail(title, status) {
  nodes.runtimeRailTitle.textContent = title
  nodes.runtimeStatusDot.className = `status-dot ${status}`
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
  if (state.runtimeChainNodes?.length) {
    if (row.event_type.includes('a2a')) return 'runtime-a2a'
    if (row.event_type.includes('adk')) return 'runtime-adk-js'
    return 'runtime-ap2'
  }
  if (row.event_type.includes('a2a.remote')) return 'a2a-remote'
  if (row.event_type.includes('a2a.receiver')) return 'a2a-receiver'
  if (row.event_type.includes('adk')) return 'adk-python'
  return 'ap2'
}

function selectNode(id) {
  state.selectedId = id
  const selected = getSelectedNode() ?? getDisplayedNodes()[0]
  if (!selected) {
    renderInspectorEmpty(
      state.viewMode === 'reference' ? 'No reference record selected' : 'No live record selected',
      'Select a record once the current view has records.',
    )
    return
  }
  state.selectedId = selected.id
  nodes.selectedTitle.textContent = selected.label
  nodes.selectedHash.textContent = selected.record_hash
  nodes.copyHash.disabled = false
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
  return getDisplayedNodes().find((item) => item.id === state.selectedId)
}

function getDisplayedNodes() {
  if (state.viewMode === 'reference') return state.data.nodes
  return state.runtimeChainNodes?.length ? state.runtimeChainNodes : []
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

function displayAgentName(value) {
  return String(value)
    .replace('atrib-google-evidence-runtime', 'atrib-google-runtime')
    .replace('google_adk_atrib_smoke_agent', 'google-adk-smoke-agent')
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
