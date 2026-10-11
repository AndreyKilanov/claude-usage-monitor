const vscode = acquireVsCodeApi()
const $ = id => document.getElementById(id)
const PALETTE = ['#ffb547', '#40e0d0', '#7aa2ff', '#ff6363', '#c792ea', '#8bd17c', '#f78fb3']
const RING_RADIUS = 32
const PERIOD_DAYS = { today: 1, d7: 7, d30: 30 }

let data = null
let tab = (vscode.getState() || {}).tab || 'today'
let scope = (vscode.getState() || {}).scope || 'all'

const el = (tag, className, text) => {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

const fmt = n => (n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : String(Math.round(n || 0)))
const share = (part, total) => Math.round((part / total) * 100)
const level = p => (p >= data.critAt ? 'crit' : p >= data.warnAt ? 'warn' : 'ok')
const levelColor = p => ({ ok: 'var(--ok)', warn: 'var(--warn)', crit: 'var(--crit)' })[level(p)]
const saveState = () => vscode.setState({ tab, scope })

function ringSvg(percent, color) {
  const circumference = 2 * Math.PI * RING_RADIUS
  const filled = (Math.min(100, Math.max(0, percent)) / 100) * circumference
  return '<svg viewBox="0 0 80 80">'
    + '<circle class="trk" cx="40" cy="40" r="' + RING_RADIUS + '" fill="none" stroke-width="8"/>'
    + '<circle class="val" cx="40" cy="40" r="' + RING_RADIUS + '" fill="none" stroke-width="8" stroke="' + color + '" stroke-dasharray="' + filled + ' ' + circumference + '"/>'
    + '</svg>'
}

function dial(percent, color) {
  const node = el('div', 'ring')
  node.innerHTML = ringSvg(percent, color)
  node.appendChild(el('div', 'pc', Math.round(percent) + '%'))
  return node
}

function ring(window) {
  const percent = Number(window.p) || 0
  const card = el('div', 'card ringcard ' + level(percent))

  const text = el('div')
  text.appendChild(el('div', 'label', window.name))
  text.appendChild(el('div', 'sub', window.reset ? data.L.resetsCap + ' ' + window.reset : data.L.noReset))
  if (window.note) {
    const note = el('div', 'sub', window.note.text)
    note.title = data.L.paceHint
    text.append(note, el('div', 'sub ' + window.note.tone, window.note.verdict))
  }
  card.append(dial(percent, levelColor(percent)), text)
  return card
}

function breakdown(host, list, total) {
  host.replaceChildren()
  if (!list.length || !total) {
    host.appendChild(el('div', 'sub', data.L.noBreakdown))
    return
  }
  list.forEach((entry, i) => {
    const row = el('div', 'row')
    const line = el('div', 'rl')
    line.append(el('span', '', entry.name), el('span', '', fmt(entry.v) + ' · ' + share(entry.v, total) + '%'))
    const meter = el('div', 'meter')
    const fill = el('i')
    fill.style.width = Math.max(2, (entry.v / total) * 100) + '%'
    fill.style.background = PALETTE[i % PALETTE.length]
    meter.appendChild(fill)
    row.append(line, meter)
    host.appendChild(row)
  })
}

function drawKinds(period) {
  const kinds = period.kinds
  const total = Math.max(1, period.total)
  const parts = [
    ['cacheRead', data.L.kindCacheRead, '#40e0d0'],
    ['cacheWrite', data.L.kindCacheWrite, '#7aa2ff'],
    ['input', data.L.kindInput, '#ffb547'],
    ['output', data.L.kindOutput, '#ff6363'],
    ['unknown', data.L.kindUnknown, 'rgba(127,127,127,.55)'],
  ].filter(part => kinds[part[0]] > 0)

  $('kcard').classList.toggle('hidden', !period.total)
  $('klabel').textContent = data.L.kindsTitle
  const stack = $('stack')
  const legend = $('legend')
  stack.replaceChildren()
  legend.replaceChildren()
  for (const [key, name, color] of parts) {
    const segment = el('i')
    segment.style.width = (kinds[key] / total) * 100 + '%'
    segment.style.background = color
    segment.title = name + ' — ' + fmt(kinds[key])
    stack.appendChild(segment)

    const row = el('div', 'leg')
    const dot = el('b')
    dot.style.background = color
    row.append(dot, el('span', '', name), el('span', '', fmt(kinds[key]) + ' · ' + share(kinds[key], total) + '%'))
    legend.appendChild(row)
  }
  $('knote').textContent = kinds.cacheRead / total >= 0.5 ? data.L.kindsNote : ''
  const showKindsWarn = data.pluginOutdated && !(data.versions && data.versions.old)
  $('koutdated').classList.toggle('hidden', !showKindsWarn)
  $('koutdated').textContent = showKindsWarn ? data.L.kindsOutdated : ''
}

function drawChart(period) {
  const chart = $('chart')
  chart.replaceChildren()
  const max = Math.max(1, ...period.bars.map(bar => bar.v))
  const tickEvery = tab === 'd30' ? 5 : tab === 'today' ? 4 : 1
  period.bars.forEach((bar, i) => {
    const column = el('div', 'col' + (bar.cur ? ' cur' : ''))
    const stick = el('div', 'stick')
    const fill = el('i')
    fill.style.height = (bar.v ? Math.max(4, (bar.v / max) * 100) : 0) + '%'
    fill.title = (tab === 'today' ? bar.label + ':00' : bar.label + ' ' + (bar.day || '')) + ' — ' + fmt(bar.v)
    stick.appendChild(fill)
    const showTick = tab === 'd7' || i % tickEvery === 0 || bar.cur
    column.append(stick, el('div', 'tick', showTick ? (tab === 'd30' ? String(bar.day) : bar.label) : ''))
    chart.appendChild(column)
  })
}

function drawSwitch(host, options, current, onPick) {
  host.replaceChildren()
  for (const [key, label, hint] of options) {
    const button = el('button', 'tab' + (key === current ? ' on' : ''), label)
    if (hint) button.title = hint
    button.onclick = () => onPick(key)
    host.appendChild(button)
  }
}

function draw() {
  if (!data) return
  const versions = data.versions
  $('title').textContent = data.L.title
  $('updated').textContent = data.L.updated + ' ' + data.time + (data.devicesCount > 1 ? ' · ' + data.L.devices + ' ' + data.devicesCount : '')
  $('ver').textContent = 'v' + versions.ext
  $('ver').title = data.L.openRepo + ' — ' + data.L.verExt + ' ' + versions.ext + ' · ' + data.L.verPlugin + ' ' + (versions.plugin || (versions.old ? data.L.verOld : '—'))
  $('pbanner').classList.toggle('hidden', !versions.old)
  $('pbanner').textContent = versions.old ? versions.oldText : ''
  $('rings').replaceChildren(...data.windows.map(ring))
  $('forecast').classList.toggle('hidden', !data.eta)
  $('forecast').textContent = data.eta ? '🔥 ' + data.L.forecast + ' ' + data.eta : ''

  drawSwitch($('tabs'), [['today', data.L.tabToday], ['d7', data.L.tab7], ['d30', data.L.tab30]], tab, key => { tab = key; saveState(); draw() })
  const hasProject = data.projectName && data.scopes.project
  if (!hasProject) scope = 'all'
  drawSwitch($('scope'), hasProject ? [['all', data.L.scopeAll], ['project', '📁 ' + data.projectName, data.L.scopeHint]] : [], scope, key => { scope = key; saveState(); draw() })

  const view = data.scopes[scope] || data.scopes.all
  const period = view[tab]
  $('plabel').textContent = data.L.total + ' · ' + data.L.tokens
  $('ptotal').textContent = fmt(period.total)
  $('psub').textContent = period.totalText + ' · ' + fmt(period.total / PERIOD_DAYS[tab]) + ' ' + data.L.perDay + ' · ' + data.L.sessions + ': ' + view.sessionsToday
  drawChart(period)
  drawKinds(period)

  $('pcard').classList.toggle('hidden', scope === 'project')
  $('cols2').classList.toggle('one', scope === 'project')
  $('mlabel').textContent = data.L.byModel
  $('plabel2').textContent = data.L.byProject
  breakdown($('models'), period.models, period.total)
  breakdown($('projects'), period.projects, period.total)
  $('note').textContent = data.L.note
  $('csv').textContent = data.L.exportCsv
}

$('csv').onclick = () => vscode.postMessage({ type: 'csv' })
$('ver').onclick = event => {
  event.preventDefault()
  vscode.postMessage({ type: 'repo' })
}
window.addEventListener('message', event => {
  if (event.data && event.data.type === 'data') {
    data = event.data.data
    draw()
  }
})
vscode.postMessage({ type: 'ready' })
