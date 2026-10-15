const vscode = require('vscode')
const { L } = require('../i18n')
const { MARKETPLACE, PLUGIN_ID, MARKETPLACE_SOURCE } = require('../constants')
const { findClaudeBinaries, run } = require('./binaries')

const STEPS = [
  { args: ['plugin', 'marketplace', 'add', MARKETPLACE_SOURCE], okIfSays: /already/i },
  { args: ['plugin', 'install', PLUGIN_ID, '--scope', 'user'], okIfSays: /already installed/i },
]

async function chooseBinary() {
  const found = findClaudeBinaries()
  if (found.length) return found[0]
  const pick = await vscode.window.showErrorMessage(L.setupNoClaude, L.setupPick)
  if (pick !== L.setupPick) return null
  const chosen = await vscode.window.showOpenDialog({ canSelectMany: false, title: L.setupPick })
  return chosen && chosen[0] ? chosen[0].fsPath : null
}

async function runSteps(claude) {
  for (const step of STEPS) {
    const result = await run(claude, step.args)
    if (!result.ok && !step.okIfSays.test(result.out)) return result
  }
  const refreshed = await run(claude, ['plugin', 'marketplace', 'update', MARKETPLACE])
  const updated = await run(claude, ['plugin', 'update', PLUGIN_ID])
  const detail = [refreshed, updated].map(step => (step.ok ? step.out : `${step.out || step.err}`)).filter(Boolean).join('\n')
  return { ok: true, detail }
}

function createSetup({ render }) {
  return async function setup() {
    const claude = await chooseBinary()
    if (!claude) return
    const answer = await vscode.window.showWarningMessage(`${L.setupAsk}\n\n${claude}`, { modal: true }, L.setupYes)
    if (answer !== L.setupYes) return

    const result = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: L.setupBusy },
      () => runSteps(claude),
    )
    if (result.ok) vscode.window.showInformationMessage(result.detail ? `${L.setupDone}\n\n${result.detail.slice(0, 400)}` : L.setupDone)
    else vscode.window.showErrorMessage(`${L.setupFail} ${(result.out || String(result.err && result.err.message)).slice(0, 400)}`)
    render()
  }
}

module.exports = { createSetup }
