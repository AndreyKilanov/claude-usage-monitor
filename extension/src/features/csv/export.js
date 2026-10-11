const vscode = require('vscode')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { L } = require('../../i18n')
const { scan } = require('../../data/sessions')
const { readTotals } = require('../../data/totals')
const { isoDay } = require('../../util/dates')
const { buildCsv } = require('./build')

function createCsvExport({ machineId }) {
  return async function exportCsv() {
    const totals = readTotals(scan(machineId), machineId)
    if (!totals.raw.length) return vscode.window.showInformationMessage(L.csvNone)

    const pick = await vscode.window.showQuickPick(
      [
        { label: L.csvByModel, detail: L.csvByModelHint, id: 'model' },
        { label: L.csvByProject, detail: L.csvByProjectHint, id: 'project' },
        { label: L.csvLong, detail: L.csvLongHint, id: 'long' },
      ],
      { placeHolder: L.csvPick },
    )
    if (!pick) return

    const target = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(path.join(os.homedir(), `claude-usage-${pick.id}-${isoDay(Date.now())}.csv`)),
      filters: { CSV: ['csv'] },
    })
    if (!target) return

    try {
      fs.writeFileSync(target.fsPath, buildCsv(totals.raw, pick.id))
    } catch (error) {
      return vscode.window.showErrorMessage(`CSV: ${error && error.message ? error.message : error}`)
    }
    vscode.window.showInformationMessage(`${L.csvDone}: ${target.fsPath}`)
  }
}

module.exports = { createCsvExport }
