// @ts-check
const { DAY, KEEP_DAYS, COST_PLUGIN } = require('../constants')
const { num } = require('../util/numbers')
const { fileProject, sameProject } = require('../util/projects')
const { cmpVer } = require('../util/versions')
const { projectLabels, belongsTo } = require('./projectLabels')
const { mergeModels, top } = require('./totals')

const KINDS = ['i', 'o', 'w', 'r']
/** @param {unknown} value */
const positive = value => (Number(value) > 0 ? Number(value) : 0)

/**
 * The latest sessions, newest first, each with what the panel shows when its row is opened.
 * Sessions with nothing spent yet (just started) are left out.
 * @param {{ name: string, d: any, machine: string }[]} sessions
 * @param {string} localId
 * @param {{ name: string | null, pid: string | null, parent?: string | null } | null} project only this project's sessions, when given
 * @param {{ limit?: number, now?: number }} [options]
 */
function recentSessions(sessions, localId, project = null, { limit = 10, now = Date.now() } = {}) {
  const labels = projectLabels(sessions)
  const rows = []
  for (const { name, d: data, machine } of sessions) {
    const updatedAt = num(data.updatedAt) || 0
    if (!updatedAt || now - updatedAt > KEEP_DAYS * DAY) continue
    if (project && !belongsTo(data, project, { local: machine === localId, nameOf: fileProject, sameName: sameProject, ambiguous: labels.ambiguous })) continue

    const buckets = data.buckets && typeof data.buckets === 'object' ? data.buckets : {}
    const details = data.detail && typeof data.detail === 'object' ? data.detail : {}
    let tokens = 0
    let first = Infinity
    let hours = 0
    /** @type {Record<string, number>} */
    const models = {}
    const kinds = { i: 0, o: 0, w: 0, r: 0 }
    for (const key in buckets) {
      const n = positive(buckets[key])
      const start = Number(key)
      if (!n || !Number.isFinite(start)) continue
      tokens += n
      hours++
      first = Math.min(first, start)
      const detail = details[key]
      if (!detail || typeof detail !== 'object') continue
      for (const [model, m] of Object.entries(detail.m || {})) if (positive(m)) models[model] = (models[model] || 0) + positive(m)
      if (detail.k && typeof detail.k === 'object') for (const k of KINDS) kinds[k] += positive(detail.k[k])
    }
    const costAware = typeof data.v === 'string' && cmpVer(data.v, COST_PLUGIN) >= 0
    const cost = costAware ? positive(num(data.usd)) : null
    if (!tokens && !cost) continue

    const own = fileProject(data)
    const rename = labels.forSession(data, machine)
    rows.push({
      id: String(name).replace(/\.json$/, '').slice(0, 8),
      project: own ? (rename ? rename(own) : own) : null,
      first: Number.isFinite(first) ? first : updatedAt,
      last: updatedAt,
      hours,
      tokens,
      cost,
      models: top(mergeModels(models), 3),
      kinds: { cacheRead: kinds.r, cacheWrite: kinds.w, input: kinds.i, output: kinds.o, unknown: Math.max(0, tokens - (kinds.i + kinds.o + kinds.w + kinds.r)) },
      device: machine === localId ? null : String(machine).slice(0, 40),
    })
  }
  return rows.sort((a, b) => b.last - a.last).slice(0, limit)
}

module.exports = { recentSessions }
