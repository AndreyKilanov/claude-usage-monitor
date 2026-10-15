const vscode = require('vscode')
const fs = require('fs')
const path = require('path')
const { L } = require('../i18n')
const { DIR, MARKETPLACE, PLUGIN_ID, MARKETPLACE_SOURCE, LATEST_PLUGIN } = require('../constants')
const { cmpVer } = require('../util/versions')
const { findClaudeBinaries, run } = require('./binaries')

const STEPS = [
  { args: ['plugin', 'marketplace', 'add', MARKETPLACE_SOURCE], okIfSays: /already/i },
  { args: ['plugin', 'install', PLUGIN_ID, '--scope', 'user'], okIfSays: /already installed/i },
]

const REINSTALL_STEPS = [
  ['plugin', 'uninstall', PLUGIN_ID],
  ['plugin', 'marketplace', 'remove', MARKETPLACE],
  ['plugin', 'marketplace', 'add', MARKETPLACE_SOURCE],
  ['plugin', 'install', PLUGIN_ID, '--scope', 'user'],
]

function installedVersion() {
  try {
    const registry = JSON.parse(fs.readFileSync(path.join(DIR, 'plugins', 'installed_plugins.json'), 'utf8'))
    const entry = (registry.plugins || {})[PLUGIN_ID]
    return entry && entry[0] && typeof entry[0].version === 'string' ? entry[0].version : null
  } catch {
    return null
  }
}

const isStale = () => {
  const version = installedVersion()
  return version !== null && cmpVer(version, LATEST_PLUGIN) < 0
}

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
  if (!isStale()) return { ok: true, detail }

  const outputs = [detail]
  for (const args of REINSTALL_STEPS) outputs.push((await run(claude, args)).out)
  const rest = outputs.filter(Boolean).join('\n')
  return isStale() ? { ok: true, stale: installedVersion(), detail: rest } : { ok: true, detail: rest }
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
    if (result.ok && result.stale) {
      vscode.window.showWarningMessage(`${L.setupStale(result.stale, LATEST_PLUGIN)}\n\n${result.detail.slice(-400)}`)
    } else if (result.ok) {
      vscode.window.showInformationMessage(result.detail ? `${L.setupDone}\n\n${result.detail.slice(0, 400)}` : L.setupDone)
    } else {
      vscode.window.showErrorMessage(`${L.setupFail} ${(result.out || String(result.err && result.err.message)).slice(0, 400)}`)
    }
    render()
  }
}

module.exports = { createSetup }
