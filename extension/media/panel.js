const vscode = acquireVsCodeApi()
const $ = id => document.getElementById(id)
const PALETTE = ['#ffb547', '#40e0d0', '#7aa2ff', '#ff6363', '#c792ea', '#8bd17c', '#f78fb3']
const PERIOD_DAYS = { today: 1, d7: 7, d30: 30 }
const STALE_MS = 30 * 60000
const LIVE_MS = 30000

let data = null
const saved = vscode.getState() || {}
let tab = saved.tab || 'today'
let scope = saved.scope || 'all'
let metric = saved.metric || 'tok'
// start of the bar whose breakdown is shown below the chart (a time, so it survives midnight); null shows the whole period
let picked = null
// sessions whose row is opened in the list (by id; not saved between panel openings)
const opened = new Set()

const el = (tag, className, text) => {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

const fmt = n => (n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : String(Math.round(n || 0)))
const share = (part, total) => Math.round((part / total) * 100)
const level = p => (p >= data.critAt ? 'crit' : p >= data.warnAt ? 'warn' : 'ok')
const saveState = () => vscode.setState({ tab, scope, metric })

function money(n) {
  if (!(n >= 0)) return '—'
  const digits = n >= 100 ? 0 : 2
  const format = v => v.toLocaleString(data.L.locale, { style: 'currency', currency: 'USD', minimumFractionDigits: digits, maximumFractionDigits: digits })
  return n > 0 && n < 0.01 ? '< ' + format(0.01) : format(n)
}

function fmtMs(ms) {
  const minutes = Math.round(ms / 60000)
  if (minutes < 60) return Math.max(minutes, 1) + ' ' + data.L.min
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return hours + ' ' + data.L.h + ' ' + (minutes % 60) + ' ' + data.L.min
  return Math.floor(hours / 24) + ' ' + data.L.d + ' ' + (hours % 24) + ' ' + data.L.h
}

function clockAt(ms) {
  const date = new Date(ms)
  const time = date.toLocaleTimeString(data.L.locale, { hour: '2-digit', minute: '2-digit' })
  return date.toDateString() === new Date().toDateString() ? time : data.L.days[date.getDay()] + ' ' + time
}

const until = ms => (ms && ms > Date.now() ? fmtMs(ms - Date.now()) + ' · ' + data.L.at + ' ' + clockAt(ms) : '')

// A 270° gauge open at the bottom: a faint track and the used share as a gradient arc.
const GAUGE = { size: 88, r: 36, stroke: 7, sweep: 270, from: 135 }
const GAUGE_COLORS = { ok: ['#2ea043', '#7ee2a8'], warn: ['#d29922', '#f2cc60'], crit: ['#f85149', '#ff9b8a'] }
let gaugeId = 0

function gaugeSvg(percent, tone) {
  const { size, r, stroke, sweep, from } = GAUGE
  const c = size / 2
  const length = 2 * Math.PI * r
  const arc = (length * sweep) / 360
  const filled = (Math.min(100, Math.max(0, percent)) / 100) * arc
  const id = 'gauge' + gaugeId++
  const [start, end] = GAUGE_COLORS[tone]
  const circle = (cls, dash, paint) => '<circle class="' + cls + '" cx="' + c + '" cy="' + c + '" r="' + r + '" fill="none" stroke-width="' + stroke
    + '" stroke-linecap="round" stroke-dasharray="' + dash + ' ' + length + '" transform="rotate(' + from + ' ' + c + ' ' + c + ')"' + paint + '/>'
  return '<svg viewBox="0 0 ' + size + ' ' + size + '">'
    + '<defs><linearGradient id="' + id + '" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="' + start + '"/><stop offset="1" stop-color="' + end + '"/></linearGradient></defs>'
    + circle('trk', arc.toFixed(1), '')
    + (filled > 0 ? circle('val', filled.toFixed(1), ' stroke="url(#' + id + ')"') : '')
    + '</svg>'
}

function dial(percent, tone) {
  const node = el('div', 'ring')
  node.innerHTML = gaugeSvg(percent, tone)
  const value = el('div', 'pc')
  value.append(el('b', '', String(Math.round(percent))), el('small', '', '%'))
  node.appendChild(value)
  return node
}

function ring(window) {
  const percent = Number(window.p) || 0
  const tone = level(percent)
  const card = el('div', 'card ringcard ' + tone)
  card.appendChild(dial(percent, tone))

  const text = el('div')
  const left = until(window.resetAt)
  const passed = window.resetAt && window.resetAt <= Date.now()
  text.appendChild(el('div', 'label', window.name))
  text.appendChild(el('div', 'sub', left ? data.L.resetsCap + ' ' + left : passed ? data.L.resetting : data.L.noReset))
  if (window.note) {
    const note = el('div', 'sub', window.note.text)
    note.title = data.L.paceHint
    text.append(note, el('div', 'sub ' + window.note.tone, window.note.verdict))
  }
  card.appendChild(text)
  return card
}

function breakdown(host, list, total, format = fmt) {
  host.replaceChildren()
  if (!list.length || !total) {
    host.appendChild(el('div', 'sub', data.L.noBreakdown))
    return
  }
  list.forEach((entry, i) => {
    const row = el('div', 'row')
    const line = el('div', 'rl')
    line.append(el('span', '', entry.name), el('span', '', format(entry.v) + ' · ' + share(entry.v, total) + '%'))
    const meter = el('div', 'meter')
    const fill = el('i')
    fill.style.width = Math.max(2, (entry.v / total) * 100) + '%'
    fill.style.background = PALETTE[i % PALETTE.length]
    meter.appendChild(fill)
    row.append(line, meter)
    host.appendChild(row)
  })
}

function drawKinds(kinds, sum, show) {
  const total = Math.max(1, sum)
  const parts = [
    ['cacheRead', data.L.kindCacheRead, '#40e0d0'],
    ['cacheWrite', data.L.kindCacheWrite, '#7aa2ff'],
    ['input', data.L.kindInput, '#ffb547'],
    ['output', data.L.kindOutput, '#ff6363'],
    ['unknown', data.L.kindUnknown, 'rgba(127,127,127,.55)'],
  ].filter(part => kinds[part[0]] > 0)

  $('kcard').classList.toggle('hidden', !show || !sum)
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

const barName = bar => (tab === 'today' ? bar.label + ':00–' + (Number(bar.label) + 1) + ':00' : bar.label + ' ' + (bar.day || ''))

function pick(start) {
  picked = picked === start ? null : start
  draw()
}

const pickedBar = period => (picked === null ? null : period.bars.find(bar => bar.start === picked) || null)

function drawChart(period, usd) {
  const chart = $('chart')
  chart.replaceChildren()
  const values = period.bars.map(bar => (usd ? bar.c : bar.v))
  const highest = Math.max(0, ...values)
  const max = highest || 1
  const format = usd ? money : fmt
  $('cmax').textContent = highest > 0 ? data.L.chartMax + ' ' + format(highest) : ''
  const tickEvery = tab === 'd30' ? 5 : tab === 'today' ? 4 : 1
  period.bars.forEach((bar, i) => {
    const state = picked === bar.start ? ' sel' : picked !== null ? ' dim' : ''
    const column = el('div', 'col' + (bar.cur ? ' cur' : '') + state)
    column.tabIndex = 0
    column.title = barName(bar) + ' — ' + format(values[i]) + '\n' + data.L.barHint
    column.onclick = () => pick(bar.start)
    column.onkeydown = event => {
      if (event.key !== 'Enter' && event.key !== ' ') return
      event.preventDefault()
      pick(bar.start)
    }
    const stick = el('div', 'stick')
    const fill = el('i')
    fill.style.height = (values[i] ? Math.max(4, (values[i] / max) * 100) : 0) + '%'
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

function compareText(period, usd) {
  const prev = period.prev
  if (!prev) return ''
  const now = usd ? period.cost : period.total
  const before = usd ? prev.cost : prev.total
  if (!(before > 0)) return ''
  const diff = Math.round(((now - before) / before) * 100)
  const sign = diff > 0 ? '+' : diff < 0 ? '−' : '±'
  return sign + Math.abs(diff) + '% ' + (tab === 'today' ? data.L.vsYesterday : data.L.vsPrev7)
}

function periodLine(period, usd) {
  const value = usd ? period.cost : period.total
  const format = usd ? money : fmt
  const average = tab === 'today'
    ? format(value / Math.max(1, period.activeHours)) + ' ' + data.L.perHour
    : format(value / PERIOD_DAYS[tab]) + ' ' + data.L.perDay
  return (usd ? money(value) : period.totalText) + ' · ' + average + ' · ' + data.L.sessions + ': ' + period.sessions
}

function drawLive() {
  const age = data.updatedAt ? Date.now() - data.updatedAt : 0
  const ageText = age < 60000 ? data.L.dataNow : data.L.dataAgo.replace('{0}', fmtMs(age))
  $('updated').textContent = ageText + (data.devicesCount > 1 ? ' · ' + data.L.devices + ' ' + data.devicesCount : '')
  $('stale').classList.toggle('hidden', !(age > STALE_MS))
  $('stale').textContent = age > STALE_MS ? data.L.staleHint : ''
  $('rings').replaceChildren(...data.windows.map(ring))
  const eta = data.etaAt && data.etaAt > Date.now()
  $('forecast').classList.toggle('hidden', !eta)
  $('forecast').textContent = eta ? '🔥 ' + data.L.forecast + ' ' + fmtMs(data.etaAt - Date.now()) + ' (≈ ' + clockAt(data.etaAt) + ')' : ''
}

// "14:05" today, "Mon 14:05" this week, "12.10 14:05" before that
function whenText(ms) {
  if (Date.now() - ms < 6 * 86400000) return clockAt(ms)
  const date = new Date(ms)
  return date.toLocaleDateString(data.L.locale, { day: '2-digit', month: '2-digit' }) + ' ' + date.toLocaleTimeString(data.L.locale, { hour: '2-digit', minute: '2-digit' })
}

// a share as a whole percent, "<1%" for a sliver rather than a misleading "0%"
const shareText = (part, total) => (part > 0 && (part / total) * 100 < 0.5 ? '<1%' : share(part, total) + '%')

function sessionDetails(session) {
  const box = el('div', 'sdet')
  const line = (label, text) => {
    const row = el('div', 'dl')
    row.append(el('span', '', label), el('span', '', text))
    box.appendChild(row)
  }
  line(data.L.recentSpan, whenText(session.first) + ' – ' + whenText(session.last))
  if (session.models.length) line(data.L.recentModels, session.models.map(m => m.name + ' ' + shareText(m.v, session.tokens)).join(' · '))
  const kinds = [['cacheRead', data.L.kindCacheRead], ['cacheWrite', data.L.kindCacheWrite], ['input', data.L.kindInput], ['output', data.L.kindOutput], ['unknown', data.L.kindUnknown]]
    .filter(([key]) => session.kinds[key] > 0)
    .map(([key, name]) => name + ' ' + shareText(session.kinds[key], session.tokens))
  if (kinds.length) line(data.L.recentKinds, fmt(session.tokens) + ' — ' + kinds.join(' · '))
  line(data.L.costTitle, session.cost === null ? data.L.recentNoCost : money(session.cost))
  if (session.device) line(data.L.recentDevice, session.device)
  line(data.L.recentId, session.id)
  return box
}

function drawRecent(list, usd) {
  $('rlabel').textContent = data.L.recentTitle
  const host = $('recent')
  host.replaceChildren()
  if (!list.length) {
    host.appendChild(el('div', 'sub', data.L.recentNone))
    return
  }
  for (const session of list) {
    const row = el('div', 'srow' + (opened.has(session.id) ? ' open' : ''))
    row.tabIndex = 0
    const left = el('div', 'sl')
    const top = session.models[0] ? ' · ' + session.models[0].name : ''
    left.append(el('span', 'sp', session.project || '—'), el('span', 'sub', whenText(session.last) + ' · ' + data.L.recentActive + ' ' + session.hours + ' ' + data.L.h + top))
    const value = usd ? (session.cost === null ? '—' : money(session.cost)) : fmt(session.tokens)
    const extra = usd ? fmt(session.tokens) : (session.cost === null ? '' : money(session.cost))
    const right = el('div', 'sr')
    right.append(el('b', '', value), el('span', 'sub', extra))
    row.append(left, right)
    const toggle = () => {
      if (opened.has(session.id)) opened.delete(session.id)
      else opened.add(session.id)
      draw()
    }
    row.onclick = toggle
    row.onkeydown = event => {
      if (event.key !== 'Enter' && event.key !== ' ') return
      event.preventDefault()
      toggle()
    }
    host.appendChild(row)
    if (opened.has(session.id)) host.appendChild(sessionDetails(session))
  }
}

function drawEmpty() {
  $('main').classList.add('hidden')
  $('empty').classList.remove('hidden')
  $('updated').textContent = ''
  $('stale').classList.add('hidden')
  $('etitle').textContent = data.L.emptyTitle
  $('etip').textContent = data.help.tip
  $('ewhy').textContent = data.help.why
  $('enote').textContent = data.help.note
  $('ewhere').textContent = data.help.where
  $('esetup').textContent = data.L.setupTitle
}

function drawSelection(period, usd) {
  const bar = pickedBar(period)
  $('selbar').classList.toggle('hidden', !bar)
  if (!bar) return
  $('seltext').textContent = barName(bar) + ' — ' + (usd ? money(bar.c) : fmt(bar.v))
  $('selclear').textContent = data.L.barReset
}

function draw() {
  if (!data) return
  $('title').textContent = data.L.title
  if (data.empty) return drawEmpty()
  $('empty').classList.add('hidden')
  $('main').classList.remove('hidden')

  const versions = data.versions
  $('ver').textContent = 'v' + versions.ext
  $('ver').title = data.L.openRepo + ' — ' + data.L.verExt + ' ' + versions.ext + ' · ' + data.L.verPlugin + ' ' + (versions.plugin || (versions.old ? data.L.verOld : '—'))
  $('pbanner').classList.toggle('hidden', !versions.old)
  $('pbanner').textContent = versions.old ? versions.oldText : ''
  drawLive()

  const repick = fn => key => { fn(key); picked = null; saveState(); draw() }
  drawSwitch($('tabs'), [['today', data.L.tabToday], ['d7', data.L.tab7], ['d30', data.L.tab30]], tab, repick(key => { tab = key }))
  drawSwitch($('metric'), [['tok', data.L.metricTokens], ['usd', data.L.metricCost, data.L.costHint]], metric, repick(key => { metric = key }))
  const hasProject = data.projectName && data.scopes.project
  if (!hasProject) scope = 'all'
  drawSwitch($('scope'), hasProject ? [['all', data.L.scopeAll], ['project', '📁 ' + data.projectName, data.projectName + ' — ' + data.L.scopeHint]] : [], scope, repick(key => { scope = key }))

  const view = data.scopes[scope] || data.scopes.all
  const period = view[tab]
  if (!pickedBar(period)) picked = null
  const usd = metric === 'usd'
  $('plabel').textContent = usd ? data.L.costTitle : data.L.total + ' · ' + data.L.tokens
  $('plabel').title = usd ? data.L.costHint : ''
  $('ptotal').textContent = usd ? money(period.cost) : fmt(period.total)
  $('psub').textContent = periodLine(period, usd)
  $('pcmp').textContent = compareText(period, usd)
  const costNote = !usd ? '' : !data.costSeen ? data.L.costNeedPlugin : period.uncosted > 0 ? data.L.costPartial : ''
  $('costnote').classList.toggle('hidden', !costNote)
  $('costnote').textContent = costNote
  drawChart(period, usd)
  drawSelection(period, usd)

  const bar = pickedBar(period)
  const source = bar || period
  const tokens = bar ? bar.v : period.total
  const cost = bar ? bar.c : period.cost
  drawKinds(source.kinds, tokens, !usd)

  $('pcard').classList.toggle('hidden', scope === 'project')
  $('cols2').classList.toggle('one', scope === 'project')
  $('mlabel').textContent = data.L.byModel
  $('plabel2').textContent = data.L.byProject
  if (usd) {
    $('models').replaceChildren(el('div', 'sub', data.L.costNoModels))
    breakdown($('projects'), source.costProjects, cost, money)
  } else {
    breakdown($('models'), source.models, tokens)
    breakdown($('projects'), source.projects, tokens)
  }
  drawRecent(view.recent || [], usd)
  $('note').textContent = usd ? data.L.costHint : data.L.note
  $('csv').textContent = data.L.exportCsv
}

$('csv').onclick = () => vscode.postMessage({ type: 'csv' })
$('esetup').onclick = () => vscode.postMessage({ type: 'setup' })
$('selclear').onclick = () => { picked = null; draw() }
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
setInterval(() => { if (data && !data.empty) drawLive() }, LIVE_MS)
vscode.postMessage({ type: 'ready' })
