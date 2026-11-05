// @ts-check
const fs = require('fs')
const path = require('path')
const { SESS } = require('../constants')
const { syncRoot } = require('./sync')

const cache = new Map()

/**
 * A session file's JSON object, from the cache while the file is unchanged; null when unreadable.
 * @param {string} file
 * @param {import('fs').Stats | null} [knownStat] its stats, when the caller just took them
 */
function readJson(file, knownStat = null) {
  try {
    const stat = knownStat || fs.statSync(file)
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

const forget = file => cache.delete(file)

/**
 * @param {string} dir
 * @param {string} machine
 * @param {Map<string, import('fs').Stats> | null} [known] stats already taken for this folder (its files and nothing else)
 */
function readDir(dir, machine, known = null) {
  let files = []
  if (known) files = [...known.keys()]
  else {
    try {
      files = fs.readdirSync(dir).filter(name => name.endsWith('.json'))
    } catch {}
  }
  const sessions = []
  for (const name of files) {
    const full = path.join(dir, name)
    const data = readJson(full, known ? known.get(name) : null)
    if (data) sessions.push({ full, name, d: data, machine })
  }
  return sessions
}

/** All sessions, this machine's and the sync folder's; `local` (from localSnapshot) saves a second look at this machine's files. */
/**
 * @param {string} machineId
 * @param {{ stats: Map<string, import('fs').Stats> } | null} [local]
 */
function scan(machineId, local = null) {
  const all = readDir(SESS, machineId, local ? local.stats : null)
  const root = syncRoot()
  if (root) {
    let others = []
    try {
      others = fs.readdirSync(root, { withFileTypes: true }).filter(e => e.isDirectory() && e.name !== machineId)
    } catch {}
    for (const entry of others) all.push(...readDir(path.join(root, entry.name), entry.name))
  }
  const seen = new Set(all.map(session => session.full))
  for (const file of cache.keys()) if (!seen.has(file)) cache.delete(file)

  const byName = new Map()
  for (const session of all) {
    const previous = byName.get(session.name)
    if (!previous || (session.d.updatedAt || 0) > (previous.d.updatedAt || 0)) byName.set(session.name, session)
  }
  return [...byName.values()]
}

/** A cheap fingerprint of this machine's data folder (names, sizes, change times; no file is read), and the stats it took. */
function localSnapshot() {
  const stats = new Map()
  let names = []
  try {
    names = fs.readdirSync(SESS).filter(name => name.endsWith('.json')).sort()
  } catch {
    return { signature: 'none', stats }
  }
  const parts = []
  for (const name of names) {
    try {
      const stat = fs.statSync(path.join(SESS, name))
      stats.set(name, stat)
      parts.push(`${name}:${stat.mtimeMs}:${stat.size}`)
    } catch {}
  }
  return { signature: parts.join('|'), stats }
}

const localSignature = () => localSnapshot().signature

module.exports = { readJson, readDir, scan, forget, localSnapshot, localSignature, cacheSize: () => cache.size }
