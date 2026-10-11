const vscode = require('vscode')
const fs = require('fs')
const { L } = require('../i18n')
const { SESS } = require('../constants')

async function openDataFolder() {
  if (!fs.existsSync(SESS)) {
    vscode.window.showInformationMessage(`${L.dataFolderMissing} ${SESS}`)
    return
  }
  await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(SESS))
}

module.exports = { openDataFolder }
