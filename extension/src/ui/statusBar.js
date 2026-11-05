// @ts-check
const vscode = require('vscode')
const fs = require('fs')
const { L } = require('../i18n')
const { cfg } = require('../settings')
const { SESS } = require('../constants')
const { scan, localSnapshot } = require('../data/sessions')
const { pushSync } = require('../data/sync')
const { readLimits, windows, nameOf } = require('../data/limits')
const { readTotals } = require('../data/totals')
const { forecast } = require('../data/forecast')
const { noDataHelp } = require('../plugin/diagnostics')
const { pct, tok, groupNum, bar, fmtMs, timeLeft, money } = require('../util/format')
const { workspaceWhere } = require('../util/projects')
const { recentSessions } = require('../data/recent')
const { projectLabels } = require('../data/projectLabels')
const { repoUrl, versionInfo, versionLabel } = require('../util/versions')
const { clickCommand } = require('./menu')

const WATCHED_KINDS = ['five_hour', 'seven_day']
const STALE_MS = 30 * 60_000
const RESYNC_MS = 10 * 60_000

const levelOf = percent => (percent >= cfg('critAt', 90) ? 'crit' : percent >= cfg('warnAt', 80) ? 'warn' : 'ok')

function worstPercent(usage) {
  const percents = windows(usage).filter(w => WATCHED_KINDS.includes(w.kind)).map(w => w.p)
  return Math.max(...percents, 0)
}

function statusText(usage, totals) {
  const parts = []
  if (cfg('showFiveHour', true)) {
    const reset = cfg('showResetTimer', false) ? timeLeft(usage.fiveHourResetsAt) : ''
    parts.push(`${L.h5} ${pct(usage.fiveHour)}${reset ? ` ⏱${reset}` : ''}`)
  }
  if (cfg('showWeek', true)) {
    const reset = cfg('showWeekResetTimer', false) ? timeLeft(usage.sevenDayResetsAt) : ''
    parts.push(`${L.week} ${pct(usage.sevenDay)}${reset ? ` ⏱${reset}` : ''}`)
  }
  if (cfg('showToday', true)) parts.push(`${L.today} ${tok(totals.periods.today.total)}`)

  const worst = worstPercent(usage)
  const icon = worst >= cfg('critAt', 90) ? '$(error)' : worst >= cfg('warnAt', 80) ? '$(warning)' : '$(pulse)'
  return `${icon} ${parts.join(' · ') || L.title}`
}

function statusBackground(usage) {
  const worst = worstPercent(usage)
  if (worst >= cfg('critAt', 90)) return new vscode.ThemeColor('statusBarItem.errorBackground')
  if (worst >= cfg('warnAt', 80)) return new vscode.ThemeColor('statusBarItem.warningBackground')
  return undefined
}

function tooltipText(usage, totals, eta) {
  const info = versionInfo(totals)
  const hover = versionLabel(info).replace(/"/g, "'")
  const versionLink = `[_v${info.ext}_](${repoUrl()} "${hover}")`
  // the tooltip stays narrow: clock times, the cost split and the explanations live in the panel
  const rows = windows(usage).map(window => {
    const left = timeLeft(window.resetsAt)
    return `| **${nameOf(window.kind)}** | ${bar(window.p, levelOf(window.p))} | **${pct(window.p)}** | ${left ? `${L.resets} ${left}` : ''} |`
  })

  // the reset column is left-aligned: right-aligned, "2 h 6 min" and "2 h 16 min" start at different places
  const blocks = [[`| **${L.title}** | | | ${versionLink} |`, '|:--|:--|--:|:--|', ...rows].join('\n')]
  if (eta) blocks.push(`$(flame) ${L.forecast} **${fmtMs(eta)}**`)
  blocks.push('---')
  blocks.push(`${L.todayLine}: **${groupNum(totals.periods.today.total)}** ${L.tokens} · ${L.sessions}: ${totals.sessionsToday}`)
  // a sum with tokens from an older, cost-less plugin in it would read as far too low, so it is left out
  const today = totals.periods.today
  if (today.cost > 0 && today.uncosted === 0) {
    const costText = money(today.cost)
    blocks.push(`${L.todayCost}: ${costText.startsWith('<') ? '' : '≈ '}${costText} · ${L.costShort}`)
  }
  const session = `${L.curSession}: ${tok(usage.tokens)} ${L.tokens}`
  blocks.push(usage.usd != null ? `${session} · ${money(usage.usd)}` : session)
  const age = usage.updatedAt ? Date.now() - usage.updatedAt : 0
  if (age > STALE_MS) blocks.push(`$(debug-pause) ${L.staleLine(fmtMs(age))}`)
  if (info.old) blocks.push(`⚠ ${info.oldText}`)
  return blocks.join('\n\n')
}

function trackHistory(app, usage) {
  if (!usage.updatedAt || usage.updatedAt === app.lastStamp || usage.fiveHour == null) return
  app.lastStamp = usage.updatedAt
  const previous = app.history[app.history.length - 1]
  if (previous && usage.fiveHour < previous.p) app.history = []
  app.history.push({ t: usage.updatedAt, p: usage.fiveHour })
  app.history = app.history.slice(-60)
}

function createStatusBar(app, { alerts, onUpdate }) {
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100)
  item.command = 'claudeUsage.menu'

  function showEmpty() {
    app.last = null
    item.text = `$(pulse) ${L.noData}`
    item.tooltip = new vscode.MarkdownString(noDataHelp(), false)
    item.command = fs.existsSync(SESS) ? clickCommand() : 'claudeUsage.setup'
    item.backgroundColor = undefined
    item.show()
    onUpdate()
  }

  // copies this machine's files to the sync folder only when they changed (and now and then, in case the folder came back)
  function syncOut(signature) {
    if (signature === app.pushedSig && Date.now() - (app.pushedAt || 0) < RESYNC_MS) return
    pushSync(app.machineId)
    app.pushedSig = signature
    app.pushedAt = Date.now()
  }

  function render() {
    const local = localSnapshot()
    app.renderedSig = local.signature
    syncOut(local.signature)
    const sessions = scan(app.machineId, local)
    const usage = readLimits(sessions)
    // the per-bar split and the project's own totals are for the panel only
    const panelOpen = !!(app.panelOpen && app.panelOpen())
    const totals = readTotals(sessions, app.machineId, null, { detailed: panelOpen })
    const where = workspaceWhere()
    const projectTotals = where && panelOpen ? readTotals(sessions, app.machineId, where) : null
    const recent = panelOpen
      ? { all: recentSessions(sessions, app.machineId), project: where ? recentSessions(sessions, app.machineId, where) : null }
      : null
    if (!usage) return showEmpty()

    item.command = clickCommand()
    trackHistory(app, usage)
    alerts(usage)
    const eta = forecast(app.history, usage)
    // the switch says `api (client-a)` when this computer has another `api` folder too
    const project = where ? projectLabels(sessions).labelOf(where.name, where.pid, where.parent, app.machineId) : null
    app.last = { usage, totals, projectTotals, project, recent, eta }

    item.text = statusText(usage, totals)
    item.backgroundColor = statusBackground(usage)
    item.tooltip = new vscode.MarkdownString(tooltipText(usage, totals, eta), true)
    item.show()
    onUpdate()
  }

  return { item, render }
}

module.exports = { createStatusBar }
