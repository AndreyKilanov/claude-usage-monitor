// @ts-check
const fs = require('fs')
const path = require('path')
const { L } = require('../i18n')
const { DIR, SESS } = require('../constants')

function pluginListed() {
  try {
    const plugins = JSON.parse(fs.readFileSync(path.join(DIR, 'settings.json'), 'utf8')).enabledPlugins
    if (!plugins || typeof plugins !== 'object') return false
    return Object.keys(plugins).some(key => key.startsWith('usage-monitor@') && plugins[key] !== false)
  } catch {
    return false
  }
}

function findPluginNote() {
  /** @type {[string, number][]} */
  const stack = [[path.join(DIR, 'plugins'), 0]]
  let visited = 0
  while (stack.length && visited < 3000) {
    const next = stack.pop()
    if (!next) break
    const [dir, depth] = next
    /** @type {import('fs').Dirent[]} */
    let entries = []
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { continue }
    for (const entry of entries) {
      visited++
      const full = path.join(dir, entry.name)
      if (entry.isFile() && entry.name === 'diagnostics.txt' && /usage-monitor/.test(dir)) {
        try { return fs.readFileSync(full, 'utf8').trim().slice(0, 600) } catch { return null }
      }
      if (entry.isDirectory() && depth < 6 && entry.name !== 'node_modules' && entry.name !== '.git') stack.push([full, depth + 1])
    }
  }
  return null
}

function folderState() {
  try {
    return { folderExists: true, fileCount: fs.readdirSync(SESS).filter(name => name.endsWith('.json')).length }
  } catch {
    return { folderExists: false, fileCount: 0 }
  }
}

/** The same explanation as the tooltip's, as plain text for the panel. */
function noDataPlain() {
  const { folderExists, fileCount } = folderState()
  const note = findPluginNote()
  return {
    tip: L.noDataTip,
    why: !folderExists ? L.noFolder : fileCount === 0 ? L.noFiles : L.noReadable,
    note: note ? `${L.pluginSays}\n${note}` : !folderExists ? L.pluginSilent : '',
    where: `${L.lookingIn} ${SESS}`,
  }
}

function noDataHelp() {
  const { folderExists, fileCount } = folderState()

  let why = L.noReadable
  if (!folderExists) why = `${L.noFolder}\n\n\`/plugin install usage-monitor --marketplace AndreyKilanov/claude-usage-monitor\`\n\n**${L.setupClick}**`
  else if (fileCount === 0) why = L.noFiles

  const note = findPluginNote()
  let fromPlugin = ''
  if (note) fromPlugin = `${L.pluginSays}\n\n\`\`\`\n${note}\n\`\`\``
  else if (!folderExists) fromPlugin = L.pluginSilent

  return [L.noDataTip, why, fromPlugin, `${L.lookingIn}\n\n\`${SESS}\``].filter(Boolean).join('\n\n')
}

module.exports = { pluginListed, findPluginNote, noDataHelp, noDataPlain }
