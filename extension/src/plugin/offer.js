const vscode = require('vscode')
const fs = require('fs')
const { L } = require('../i18n')
const { cfg } = require('../settings')
const { SESS } = require('../constants')
const { pluginListed } = require('./diagnostics')

let delayMs = 2500

const setOfferDelay = ms => { delayMs = ms }

function scheduleOffer(context, setup) {
  const offer = async () => {
    if (!cfg('offerPluginInstall', true)) return
    if (context.globalState.get('offerDismissed', false)) return
    if (fs.existsSync(SESS) || pluginListed()) return
    const pick = await vscode.window.showInformationMessage(L.offerText, L.offerYes, L.offerLater, L.offerNever)
    if (pick === L.offerYes) await setup()
    else if (pick === L.offerNever) context.globalState.update('offerDismissed', true)
  }
  const timer = setTimeout(() => { offer().catch(() => {}) }, delayMs)
  if (timer.unref) timer.unref()
  return { dispose: () => clearTimeout(timer) }
}

module.exports = { scheduleOffer, setOfferDelay }
