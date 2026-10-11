const fs = require('fs')
const os = require('os')
const path = require('path')
const { cfg } = require('../settings')
const { SESS } = require('../constants')

function syncRoot() {
  const raw = String(cfg('syncFolder', '') || '').trim()
  if (!raw) return ''
  return raw.startsWith('~') ? path.join(os.homedir(), raw.slice(1)) : raw
}

function pushSync(machineId) {
  const root = syncRoot()
  if (!root) return
  try {
    if (!fs.statSync(root).isDirectory()) return
  } catch {
    return
  }
  const destination = path.join(root, machineId)
  try {
    fs.mkdirSync(destination, { recursive: true })
    for (const file of fs.readdirSync(SESS).filter(name => name.endsWith('.json'))) {
      const source = path.join(SESS, file)
      const target = path.join(destination, file)
      const stat = fs.statSync(source)
      let upToDate = false
      try { upToDate = fs.statSync(target).mtimeMs >= stat.mtimeMs } catch {}
      if (upToDate) continue
      const body = fs.readFileSync(source)
      try { JSON.parse(body) } catch { continue }
      const temp = `${target}.tmp`
      fs.writeFileSync(temp, body)
      fs.renameSync(temp, target)
      fs.utimesSync(target, stat.atime, stat.mtime)
    }
  } catch {}
}

module.exports = { syncRoot, pushSync }
