// @ts-check
const vscode = require('vscode')
const { L } = require('../i18n')
const { repoUrl } = require('../util/versions')
const { buildPayload, emptyPayload } = require('./panelData')
const { panelHtml } = require('./panelHtml')

function createPanel(app) {
  let panel = null
  let lastSent = null

  // the page redraws itself from what it has; sending the same numbers again would only make it work harder
  function push(force = false) {
    if (!panel) return
    try {
      const message = { type: 'data', data: app.last ? buildPayload(app.last) : emptyPayload() }
      const text = JSON.stringify(message)
      if (!force && text === lastSent) return
      lastSent = text
      panel.webview.postMessage(message)
    } catch {}
  }

  function open() {
    if (panel) return panel.reveal()
    panel = vscode.window.createWebviewPanel('claudeUsage', L.title, vscode.ViewColumn.Beside, { enableScripts: true })
    lastSent = null
    panel.webview.html = panelHtml()
    panel.onDidDispose(() => { panel = null }, null, app.context.subscriptions)
    panel.webview.onDidReceiveMessage(message => {
      if (!message) return
      if (message.type === 'ready') {
        // a (re)loaded page needs everything, including what is only worked out while the panel is open
        lastSent = null
        try {
          if (app.render) return app.render()
        } catch {}
        push(true)
      }
      if (message.type === 'csv') vscode.commands.executeCommand('claudeUsage.exportCsv')
      if (message.type === 'setup') vscode.commands.executeCommand('claudeUsage.setup')
      if (message.type === 'repo') vscode.env.openExternal(vscode.Uri.parse(repoUrl()))
    }, null, app.context.subscriptions)
  }

  return { open, push: () => push(false), isOpen: () => !!panel }
}

module.exports = { createPanel }
