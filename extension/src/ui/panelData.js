const { L } = require('../i18n')
const { cfg } = require('../settings')
const { windows, nameOf } = require('../data/limits')
const { windowPace } = require('../data/pace')
const { mergeModels, kindsOf, top } = require('../data/totals')
const { groupNum, fmtMs, timeLeft } = require('../util/format')
const { versionInfo } = require('../util/versions')

const PAGE_TEXT = [
  'title', 'updated', 'resetsCap', 'noReset', 'forecast', 'note', 'tabToday', 'tab7', 'tab30', 'byModel', 'byProject',
  'noBreakdown', 'kindsTitle', 'kindCacheRead', 'kindCacheWrite', 'kindInput', 'kindOutput', 'kindUnknown', 'kindsNote',
  'kindsOutdated', 'openRepo', 'scopeAll', 'scopeHint', 'verExt', 'verPlugin', 'verOld', 'tokens', 'sessions', 'devices',
  'curSession', 'exportCsv', 'total', 'perDay', 'paceHint',
]

function pageText() {
  return Object.fromEntries(PAGE_TEXT.map(key => [key, L[key]]))
}

function periodData(totals, key) {
  const period = totals.periods[key]
  return {
    total: period.total,
    totalText: groupNum(period.total),
    bars: period.bars.map(bar => ({ label: bar.label, day: bar.day, v: bar.v, cur: bar.cur })),
    models: top(mergeModels(period.models)),
    kinds: kindsOf(period),
    projects: top(period.projects),
  }
}

function scopeData(totals) {
  return {
    today: periodData(totals, 'today'),
    d7: periodData(totals, 'd7'),
    d30: periodData(totals, 'd30'),
    sessionsToday: totals.sessionsToday,
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
  return { name: nameOf(window.kind), p: window.p, reset: timeLeft(window.resetsAt), note: paceNote(window) }
}

function buildPayload({ usage, totals, projectTotals, project, eta }) {
  return {
    L: pageText(),
    locale: L.locale,
    time: new Date().toLocaleTimeString(L.locale),
    warnAt: cfg('warnAt', 80),
    critAt: cfg('critAt', 90),
    windows: windows(usage).map(windowData),
    eta: eta ? fmtMs(eta) : null,
    scopes: { all: scopeData(totals), project: projectTotals ? scopeData(projectTotals) : null },
    projectName: project,
    versions: versionInfo(totals),
    pluginOutdated: totals.pluginOutdated,
    devicesCount: totals.devices,
    session: { tokens: usage.tokens || 0, usd: usage.usd ?? null },
  }
}

module.exports = { buildPayload }
