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
    const created = vscode.window.createWebviewPanel('claudeUsage', L.title, vscode.ViewColumn.Beside, { enableScripts: true })
    panel = created
    lastSent = null
    // registered first, so a panel that failed half-way is still forgotten once closed
    created.onDidDispose(() => { if (panel === created) panel = null }, null, app.context.subscriptions)
    try {
      created.webview.html = panelHtml()
    } catch {
      // the page's files are gone: the extension was replaced on disk while this window kept running it
      panel = null
      created.dispose()
      vscode.window.showErrorMessage(L.panelFilesGone)
      return
    }
    created.webview.onDidReceiveMessage(message => {
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
