const vscode = require('vscode')
const { L } = require('../i18n')
const { repoUrl } = require('../util/versions')
const { buildPayload } = require('./panelData')
const { panelHtml } = require('./panelHtml')

function createPanel(app) {
  let panel = null

  function push() {
    if (!panel || !app.last) return
    try {
      panel.webview.postMessage({ type: 'data', data: buildPayload(app.last) })
    } catch {}
  }

  function open() {
    if (panel) return panel.reveal()
    panel = vscode.window.createWebviewPanel('claudeUsage', L.title, vscode.ViewColumn.Beside, { enableScripts: true })
    panel.webview.html = panelHtml()
    panel.onDidDispose(() => { panel = null }, null, app.context.subscriptions)
    panel.webview.onDidReceiveMessage(message => {
      if (!message) return
      if (message.type === 'ready') push()
      if (message.type === 'csv') vscode.commands.executeCommand('claudeUsage.exportCsv')
      if (message.type === 'repo') vscode.env.openExternal(vscode.Uri.parse(repoUrl()))
    }, null, app.context.subscriptions)
  }

  return { open, push }
}

module.exports = { createPanel }
