const fs = require('fs')
const path = require('path')
const { SESS } = require('../constants')
const { syncRoot } = require('./sync')

const cache = new Map()

function readJson(file) {
  try {
    const stat = fs.statSync(file)
    const hit = cache.get(file)
    if (hit && hit.mtimeMs === stat.mtimeMs && hit.size === stat.size) return hit.data
    const data = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null
    cache.set(file, { mtimeMs: stat.mtimeMs, size: stat.size, data })
    return data
  } catch {
    cache.delete(file)
    return null
  }
}

function readDir(dir, machine) {
  let files = []
  try {
    files = fs.readdirSync(dir).filter(name => name.endsWith('.json'))
  } catch {}
  const sessions = []
  for (const name of files) {
    const full = path.join(dir, name)
    const data = readJson(full)
    if (data) sessions.push({ full, name, d: data, machine })
  }
  return sessions
}

function scan(machineId) {
  const all = readDir(SESS, machineId)
  const root = syncRoot()
  if (root) {
    let others = []
    try {
      others = fs.readdirSync(root, { withFileTypes: true }).filter(e => e.isDirectory() && e.name !== machineId)
    } catch {}
    for (const entry of others) all.push(...readDir(path.join(root, entry.name), entry.name))
  }
  const byName = new Map()
  for (const session of all) {
    const previous = byName.get(session.name)
    if (!previous || (session.d.updatedAt || 0) > (previous.d.updatedAt || 0)) byName.set(session.name, session)
  }
  return [...byName.values()]
}

module.exports = { readJson, readDir, scan }
