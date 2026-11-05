// @ts-check
const vscode = require('vscode')
const fs = require('fs')
const { L } = require('../i18n')
const { cfg } = require('../settings')
const { SESS, LATEST_PLUGIN } = require('../constants')
const { pluginListed } = require('./diagnostics')
const { installedVersion, isStale } = require('./install')

let delayMs = 2500

const setOfferDelay = ms => { delayMs = ms }

/**
 * A newer plugin is out than the one installed (by Claude Code's own list of installed plugins):
 * ask once per start, until it is updated or this version is skipped. Nothing runs without the
 * person confirming the exact commands in the setup dialog; a newer version asks again.
 */
async function offerUpdate(context, setup) {
  const installed = installedVersion()
  if (!installed || !isStale()) return
  if (context.globalState.get('updateSkipped', null) === LATEST_PLUGIN) return
  const pick = await vscode.window.showInformationMessage(L.updateText(installed, LATEST_PLUGIN), L.updateYes, L.offerLater, L.updateSkip)
  if (pick === L.updateYes) await setup()
  else if (pick === L.updateSkip) context.globalState.update('updateSkipped', LATEST_PLUGIN)
}

function scheduleOffer(context, setup) {
  const offer = async () => {
    if (!cfg('offerPluginInstall', true)) return
    if (fs.existsSync(SESS) || pluginListed()) return offerUpdate(context, setup)
    if (context.globalState.get('offerDismissed', false)) return
    const pick = await vscode.window.showInformationMessage(L.offerText, L.offerYes, L.offerLater, L.offerNever)
    if (pick === L.offerYes) await setup()
    else if (pick === L.offerNever) context.globalState.update('offerDismissed', true)
  }
  const timer = setTimeout(() => { offer().catch(() => {}) }, delayMs)
  if (timer.unref) timer.unref()
  return { dispose: () => clearTimeout(timer) }
}

module.exports = { scheduleOffer, setOfferDelay }
