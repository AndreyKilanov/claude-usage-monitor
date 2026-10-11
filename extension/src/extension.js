const vscode = require('vscode')
const os = require('os')
const crypto = require('crypto')
const { cfg } = require('./settings')
const { pickLocale } = require('./i18n')
const { createAlerts } = require('./features/alerts')
const { createCsvExport } = require('./features/csv/export')
const { createSetup } = require('./plugin/install')
const { scheduleOffer } = require('./plugin/offer')
const { openDataFolder } = require('./plugin/dataFolder')
const { createStatusBar } = require('./ui/statusBar')
const { createPanel } = require('./ui/panel')
const { createMenu } = require('./ui/menu')

const WATCH_INTERVAL_MS = 3000

function machineIdFor(context) {
  let id = context.globalState.get('machineId')
  if (!id) {
    const host = os.hostname().replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 24)
    id = `${host}-${crypto.randomBytes(3).toString('hex')}`
    context.globalState.update('machineId', id)
  }
  return id
}

const unref = timer => {
  if (timer.unref) timer.unref()
  return timer
}

function activate(context) {
  pickLocale()
  const app = { context, machineId: machineIdFor(context), last: null, history: [], lastStamp: 0 }

  const panel = createPanel(app)
  const statusBar = createStatusBar(app, { alerts: createAlerts(context), onUpdate: panel.push })
  const { render } = statusBar

  const exportCsv = createCsvExport(app)
  const setup = createSetup({ render })
  const menu = createMenu(app, { open: panel.open, exportCsv, render, openDataFolder, setup })

  const offer = scheduleOffer(context, setup)
  render()

  const watcher = unref(setInterval(render, WATCH_INTERVAL_MS))
  let refresher
  const schedule = () => {
    clearInterval(refresher)
    refresher = unref(setInterval(render, Math.max(10, cfg('refreshIntervalSeconds', 30)) * 1000))
  }
  schedule()

  context.subscriptions.push(
    statusBar.item,
    vscode.workspace.onDidChangeConfiguration(event => {
      if (!event.affectsConfiguration('claudeUsage')) return
      pickLocale()
      schedule()
      render()
    }),
    vscode.commands.registerCommand('claudeUsage.open', panel.open),
    vscode.commands.registerCommand('claudeUsage.refresh', render),
    vscode.commands.registerCommand('claudeUsage.exportCsv', exportCsv),
    vscode.commands.registerCommand('claudeUsage.setup', setup),
    vscode.commands.registerCommand('claudeUsage.menu', menu),
    vscode.commands.registerCommand('claudeUsage.openDataFolder', openDataFolder),
    offer,
    { dispose: () => { clearInterval(watcher); clearInterval(refresher) } },
  )
}

function deactivate() {}

module.exports = { activate, deactivate }
