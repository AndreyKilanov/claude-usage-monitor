const vscode = require('vscode')
const { L } = require('../i18n')
const { cfg } = require('../settings')
const { pct, groupNum } = require('../util/format')
const { repoUrl } = require('../util/versions')

const EXTENSION_ID = 'andreykilanov.claude-usage-monitor'

function summaryText(last) {
  if (!last) return ''
  const { usage, totals } = last
  return `${L.h5} ${pct(usage.fiveHour)} · ${L.week} ${pct(usage.sevenDay)} · ${L.today} ${groupNum(totals.periods.today.total)} ${L.tokens}`
}

const clickCommand = () => (cfg('clickAction', 'menu') === 'panel' ? 'claudeUsage.open' : 'claudeUsage.menu')

function createMenu(app, actions) {
  return async function menu() {
    const summary = summaryText(app.last)
    const items = [
      { label: `$(graph) ${L.menuPanel}`, id: 'open' },
      { label: `$(copy) ${L.menuCopy}`, detail: summary, id: 'copy' },
      { label: `$(export) ${L.exportCsv}`, id: 'csv' },
      { label: `$(refresh) ${L.menuRefresh}`, id: 'refresh' },
      { label: `$(folder-opened) ${L.menuDataFolder}`, id: 'folder' },
      { label: `$(settings-gear) ${L.menuSettings}`, id: 'settings' },
      { label: `$(cloud-download) ${L.setupTitle}`, id: 'setup' },
      { label: `$(question) ${L.menuHelp}`, id: 'help' },
    ]
    const pick = await vscode.window.showQuickPick(items, { placeHolder: summary || L.title })
    if (!pick) return

    switch (pick.id) {
      case 'open': return actions.open()
      case 'copy':
        await vscode.env.clipboard.writeText(summary)
        return vscode.window.showInformationMessage(`${L.copied} ${summary}`)
      case 'csv': return actions.exportCsv()
      case 'refresh': return actions.render()
      case 'folder': return actions.openDataFolder()
      case 'settings':
        return vscode.commands.executeCommand('workbench.action.openSettings', `@ext:${(app.context.extension && app.context.extension.id) || EXTENSION_ID}`)
      case 'setup': return actions.setup()
      case 'help': return vscode.env.openExternal(vscode.Uri.parse(`${repoUrl()}#readme`))
    }
  }
}

module.exports = { createMenu, clickCommand, summaryText }
