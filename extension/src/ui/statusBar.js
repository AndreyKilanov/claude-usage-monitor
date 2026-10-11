const vscode = require('vscode')
const fs = require('fs')
const { L } = require('../i18n')
const { cfg } = require('../settings')
const { SESS } = require('../constants')
const { scan } = require('../data/sessions')
const { pushSync } = require('../data/sync')
const { readLimits, windows, nameOf } = require('../data/limits')
const { readTotals } = require('../data/totals')
const { forecast } = require('../data/forecast')
const { noDataHelp } = require('../plugin/diagnostics')
const { pct, tok, groupNum, bar, fmtMs, timeLeft } = require('../util/format')
const { workspaceProject } = require('../util/projects')
const { repoUrl, versionInfo, versionLabel } = require('../util/versions')
const { clickCommand } = require('./menu')

const WATCHED_KINDS = ['five_hour', 'seven_day']

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
  if (cfg('showWeek', true)) parts.push(`${L.week} ${pct(usage.sevenDay)}`)
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
  const rows = windows(usage).map(window => {
    const left = timeLeft(window.resetsAt)
    return `| **${nameOf(window.kind)}** | \`${bar(window.p)}\` | **${pct(window.p)}** | ${left ? `${L.resets} ${left}` : ''} |`
  })

  const blocks = [[`| **${L.title}** | | | ${versionLink} |`, '|:--|:--|--:|--:|', ...rows].join('\n')]
  if (eta) blocks.push(`$(flame) ${L.forecast} **${fmtMs(eta)}**`)
  blocks.push('---')
  blocks.push(`${L.todayLine}: **${groupNum(totals.periods.today.total)}** ${L.tokens} · ${L.sessions}: ${totals.sessionsToday}`)
  const session = `${L.curSession}: ${tok(usage.tokens)} ${L.tokens}`
  blocks.push(usage.usd != null ? `${session} · $${Number(usage.usd).toFixed(2)}` : session)
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
    item.text = `$(pulse) ${L.noData}`
    item.tooltip = new vscode.MarkdownString(noDataHelp(), false)
    item.command = fs.existsSync(SESS) ? clickCommand() : 'claudeUsage.setup'
    item.backgroundColor = undefined
    item.show()
  }

  function render() {
    pushSync(app.machineId)
    const sessions = scan(app.machineId)
    const usage = readLimits(sessions)
    const totals = readTotals(sessions, app.machineId)
    const project = workspaceProject()
    const projectTotals = project ? readTotals(sessions, app.machineId, project) : null
    if (!usage) return showEmpty()

    item.command = clickCommand()
    trackHistory(app, usage)
    alerts(usage)
    const eta = forecast(app.history, usage)
    app.last = { usage, totals, projectTotals, project, eta }

    item.text = statusText(usage, totals)
    item.backgroundColor = statusBackground(usage)
    item.tooltip = new vscode.MarkdownString(tooltipText(usage, totals, eta), true)
    item.show()
    onUpdate()
  }

  return { item, render }
}

module.exports = { createStatusBar }
