// @ts-check
const { L } = require('../i18n')
const { cfg } = require('../settings')
const { windows, nameOf } = require('../data/limits')
const { windowPace } = require('../data/pace')
const { mergeModels, kindsOf, top } = require('../data/totals')
const { groupNum } = require('../util/format')
const { versionInfo } = require('../util/versions')
const { noDataPlain } = require('../plugin/diagnostics')

const PAGE_TEXT = [
  'title', 'resetsCap', 'noReset', 'forecast', 'note', 'tabToday', 'tab7', 'tab30', 'byModel', 'byProject',
  'noBreakdown', 'kindsTitle', 'kindCacheRead', 'kindCacheWrite', 'kindInput', 'kindOutput', 'kindUnknown', 'kindsNote',
  'kindsOutdated', 'openRepo', 'scopeAll', 'scopeHint', 'verExt', 'verPlugin', 'verOld', 'tokens', 'sessions', 'devices',
  'curSession', 'exportCsv', 'total', 'perDay', 'perHour', 'paceHint', 'min', 'h', 'd', 'days', 'locale', 'at',
  'dataAgo', 'dataNow', 'staleHint', 'metricTokens', 'metricCost', 'costTitle', 'costHint', 'costPartial', 'costNeedPlugin',
  'costNoModels', 'vsYesterday', 'vsPrev7', 'barHint', 'barReset', 'chartMax', 'emptyTitle', 'setupTitle', 'resetting',
  'recentTitle', 'recentNone', 'recentActive', 'recentModels', 'recentKinds', 'recentDevice', 'recentId', 'recentSpan', 'recentNoCost',
]

function pageText() {
  return Object.fromEntries(PAGE_TEXT.map(key => [key, L[key]]))
}

function sumsData(sums) {
  return {
    models: top(mergeModels(sums.models)),
    projects: top(sums.projects),
    costProjects: top(sums.costProjects),
    kinds: kindsOf(sums),
    uncosted: sums.uncosted,
  }
}

const barData = bar => ({ label: bar.label, day: bar.day || null, start: bar.start, v: bar.total, c: bar.cost, cur: bar.cur, ...sumsData(bar) })

function periodData(totals, key) {
  const period = totals.periods[key]
  return {
    total: period.total,
    totalText: groupNum(period.total),
    cost: period.cost,
    sessions: period.sessions,
    prev: period.prev,
    activeHours: period.bars.filter(bar => bar.total > 0).length,
    bars: period.bars.map(barData),
    ...sumsData(period),
  }
}

function scopeData(totals, recent) {
  return {
    today: periodData(totals, 'today'),
    d7: periodData(totals, 'd7'),
    d30: periodData(totals, 'd30'),
    sessionsToday: totals.sessionsToday,
    recent: recent || [],
  }
}

const PACE_TOLERANCE = 5

function paceNote(window) {
  const pace = windowPace(window.kind, window.resetsAt)
  if (pace === null) return null
  const percent = Math.round(pace * 100)
  const gap = window.p - percent
  const verdict = gap > PACE_TOLERANCE ? L.paceFast : gap < -PACE_TOLERANCE ? L.paceSlow : L.paceEven
  return { text: L.weekLine(percent), verdict, tone: gap > PACE_TOLERANCE ? 'warn' : 'ok' }
}

function windowData(window) {
  const resetAt = window.resetsAt ? Date.parse(window.resetsAt) : NaN
  return { name: nameOf(window.kind), p: window.p, resetAt: Number.isFinite(resetAt) ? resetAt : null, note: paceNote(window) }
}

function buildPayload({ usage, totals, projectTotals, project, recent, eta }) {
  return {
    L: pageText(),
    updatedAt: usage.updatedAt || null,
    warnAt: cfg('warnAt', 80),
    critAt: cfg('critAt', 90),
    windows: windows(usage).map(windowData),
    etaAt: eta ? Math.round((Date.now() + eta) / 60_000) * 60_000 : null,
    scopes: {
      all: scopeData(totals, recent && recent.all),
      project: projectTotals ? scopeData(projectTotals, recent && recent.project) : null,
    },
    projectName: project,
    versions: versionInfo(totals),
    pluginOutdated: totals.pluginOutdated,
    costSeen: totals.costSeen,
    devicesCount: totals.devices,
    session: { tokens: usage.tokens || 0, usd: usage.usd ?? null },
  }
}

function emptyPayload() {
  return { empty: true, L: pageText(), help: noDataPlain() }
}

module.exports = { buildPayload, emptyPayload }
