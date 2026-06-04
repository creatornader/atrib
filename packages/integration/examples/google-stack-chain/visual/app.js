const state = {
  data: null,
  selectedId: 'ap2',
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
  toast: document.querySelector('#toast'),
}

async function init() {
  const response = await fetch('./proof-snapshot.json')
  if (!response.ok) {
    throw new Error(`Unable to load visual snapshot: ${response.status}`)
  }
  state.data = await response.json()
  state.selectedId = state.data.nodes[0].id
  renderStatic()
  selectNode(state.selectedId)
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
      button.classList.add('active')
      const view = button.dataset.view
      if (view === 'analytics') {
        document
          .querySelector('#analyticsBand')
          .scrollIntoView({ behavior: 'smooth', block: 'nearest' })
      }
      if (view === 'limits') {
        document
          .querySelector('.muted-panel')
          .scrollIntoView({ behavior: 'smooth', block: 'nearest' })
      }
    })
  })
}

function renderChainNode(item, index) {
  const button = document.createElement('button')
  button.className = 'node'
  button.type = 'button'
  button.dataset.nodeId = item.id
  button.setAttribute('aria-label', `Inspect ${item.label}`)
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
  button.addEventListener('click', () => selectNode(item.id))
  return button
}

function renderAnalyticsRow(row) {
  const tr = document.createElement('tr')
  tr.dataset.nodeId = row.node_id
  tr.innerHTML = `
    <td data-label="Protocol">${escapeHtml(row.protocol)}</td>
    <td data-label="Event" title="${escapeHtml(row.event_type)}">${escapeHtml(formatEvent(row.event_type))}</td>
    <td data-label="Agent">${escapeHtml(row.agent)}</td>
    <td data-label="Trace"><code>${escapeHtml(shortTrace(row.trace_id))}</code></td>
    <td data-label="Record"><code>${shortHash(row.atrib_record_hash)}</code></td>
  `
  tr.addEventListener('click', () => selectNode(row.node_id))
  return tr
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
    item.classList.toggle('active', item.dataset.nodeId === id)
  })
  document.querySelectorAll('#analyticsRows tr').forEach((item) => {
    item.classList.toggle('selected', item.dataset.nodeId === id)
  })
}

function getSelectedNode() {
  return state.data.nodes.find((item) => item.id === state.selectedId)
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
  return `${value.slice(0, 18)}...${value.slice(-12)}`
}

function shortTrace(value) {
  if (!value) return 'local-only'
  if (value.length <= 18) return value
  return `${value.slice(0, 12)}...${value.slice(-6)}`
}

function formatEvent(value) {
  return value
    .replace(/^atrib\./, '')
    .replace(/^ap2\./, '')
    .replace(/^a2a\./, '')
    .replace(/^adk_python\./, '')
    .replaceAll('_', ' ')
}

function protocolClass(protocol) {
  if (protocol === 'ADK Python') return 'ADK'
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
