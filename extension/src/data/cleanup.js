// @ts-check
const fs = require('fs')
const path = require('path')
const { SESS, DAY, KEEP_DAYS } = require('../constants')
const { num } = require('../util/numbers')
const { readJson, forget } = require('./sessions')
const { syncRoot } = require('./sync')

const jsonFiles = dir => {
  try {
    return fs.readdirSync(dir).filter(name => name.endsWith('.json')).map(name => path.join(dir, name))
  } catch {
    return []
  }
}

function remove(file) {
  try {
    fs.unlinkSync(file)
    forget(file)
    return true
  } catch {
    return false
  }
}

/**
 * Deletes what is older than KEEP_DAYS: this machine's session files (by their last update)
 * and this machine's own copies in the sync folder (by file time, which the copy keeps).
 * Other devices' folders are never touched: they clean up after themselves.
 */
function cleanup(machineId, now = Date.now()) {
  const limit = KEEP_DAYS * DAY
  let removed = 0

  for (const file of jsonFiles(SESS)) {
    const data = readJson(file)
    const updatedAt = data ? num(data.updatedAt) : null
    if (updatedAt !== null && now - updatedAt > limit && remove(file)) removed++
  }

  const root = syncRoot()
  if (root && machineId) {
    for (const file of jsonFiles(path.join(root, machineId))) {
      try {
        if (now - fs.statSync(file).mtimeMs > limit && remove(file)) removed++
      } catch {}
    }
  }
  return removed
}

module.exports = { cleanup }
