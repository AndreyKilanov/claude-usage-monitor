const vscode = require('vscode')
const { L } = require('../i18n')
const { cfg } = require('../settings')
const { windows, nameOf } = require('../data/limits')

const WATCHED = ['five_hour', 'seven_day']
const RESET_TOLERANCE_MS = 600_000

function createAlerts(context) {
  return function alerts(usage) {
    if (!cfg('notifications', true)) return
    const seen = context.globalState.get('alerts', {})
    const warnAt = cfg('warnAt', 80)
    const critAt = cfg('critAt', 90)

    for (const window of windows(usage)) {
      if (!WATCHED.includes(window.kind)) continue
      const state = seen[window.kind] || { resetsAt: window.resetsAt, level: 0 }
      const moved = state.resetsAt && window.resetsAt && Math.abs(Date.parse(state.resetsAt) - Date.parse(window.resetsAt)) > RESET_TOLERANCE_MS
      if (moved) {
        if (state.level > 0 && cfg('notifyOnReset', true)) vscode.window.showInformationMessage(L.resetMsg(nameOf(window.kind)))
        state.level = 0
        state.resetsAt = window.resetsAt
      }

      const level = window.p >= critAt ? 2 : window.p >= warnAt ? 1 : 0
      if (level > state.level) {
        const message = (level === 2 ? L.critMsg : L.warnMsg)(nameOf(window.kind), Math.round(window.p))
        if (level === 2) vscode.window.showErrorMessage(message)
        else vscode.window.showWarningMessage(message)
        state.level = level
      }
      state.resetsAt = state.resetsAt || window.resetsAt
      seen[window.kind] = state
    }
    context.globalState.update('alerts', seen)
  }
}

module.exports = { createAlerts }
