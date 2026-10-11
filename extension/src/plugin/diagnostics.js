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
  const stack = [[path.join(DIR, 'plugins'), 0]]
  let visited = 0
  while (stack.length && visited < 3000) {
    const [dir, depth] = stack.pop()
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

function noDataHelp() {
  let files = []
  let folderExists = true
  try {
    files = fs.readdirSync(SESS).filter(name => name.endsWith('.json'))
  } catch {
    folderExists = false
  }

  let why = L.noReadable
  if (!folderExists) why = `${L.noFolder}\n\n\`/plugin install usage-monitor --marketplace AndreyKilanov/claude-usage-monitor\`\n\n**${L.setupClick}**`
  else if (files.length === 0) why = L.noFiles

  const note = findPluginNote()
  let fromPlugin = ''
  if (note) fromPlugin = `${L.pluginSays}\n\n\`\`\`\n${note}\n\`\`\``
  else if (!folderExists) fromPlugin = L.pluginSilent

  return [L.noDataTip, why, fromPlugin, `${L.lookingIn}\n\n\`${SESS}\``].filter(Boolean).join('\n\n')
}

module.exports = { pluginListed, findPluginNote, noDataHelp }
