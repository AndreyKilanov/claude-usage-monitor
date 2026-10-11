const { L } = require('../i18n')
const { MIN_PLUGIN, REPO_FALLBACK } = require('../constants')

const packageJson = () => {
  try {
    return require('../../package.json')
  } catch {
    return {}
  }
}

const cmpVer = (a, b) => {
  const left = String(a || '').split('.').map(part => parseInt(part, 10) || 0)
  const right = String(b || '').split('.').map(part => parseInt(part, 10) || 0)
  for (let i = 0; i < Math.max(left.length, right.length, 3); i++) {
    const diff = (left[i] || 0) - (right[i] || 0)
    if (diff) return diff < 0 ? -1 : 1
  }
  return 0
}

const extensionVersion = () => String(packageJson().version || '?')

const repoUrl = () => {
  const url = String((packageJson().repository || {}).url || '').replace(/\.git$/, '')
  return /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/.test(url) ? url : REPO_FALLBACK
}

const versionInfo = totals => {
  const known = totals.pluginVersion !== undefined
  const plugin = known ? totals.pluginVersion : null
  const old = known && (plugin === null || cmpVer(plugin, MIN_PLUGIN) < 0)
  return {
    ext: extensionVersion(),
    plugin,
    min: MIN_PLUGIN,
    old,
    oldText: old ? L.pluginOld(plugin || L.verOld, MIN_PLUGIN) : '',
  }
}

const versionLabel = info => `${L.verExt} ${info.ext} · ${L.verPlugin} ${info.plugin || (info.old ? L.verOld : '—')}`

module.exports = { cmpVer, extensionVersion, repoUrl, versionInfo, versionLabel }
