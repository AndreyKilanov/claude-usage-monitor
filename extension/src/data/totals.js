// @ts-check
const { L } = require('../i18n')
const { DAY, HOUR, KEEP_DAYS, COST_PLUGIN } = require('../constants')
const { num } = require('../util/numbers')
const { dayStart } = require('../util/dates')
const { prettyModel } = require('../util/format')
const { fileProject, sameProject } = require('../util/projects')
const { projectLabels, belongsTo } = require('./projectLabels')
const { cmpVer } = require('../util/versions')

const KIND_KEYS = ['i', 'o', 'w', 'r']

/** One bag of sums. A period, and each bar of its chart, keep the same shape. */
const newSums = () => ({ total: 0, cost: 0, uncosted: 0, models: {}, projects: {}, costProjects: {}, kinds: { i: 0, o: 0, w: 0, r: 0 } })

const newPeriod = bars => ({ ...newSums(), bars, sessions: 0, prev: null })

function dayBars(now, count) {
  return Array.from({ length: count }, (_, i) => {
    const start = dayStart(now, count - 1 - i)
    return {
      ...newSums(),
      start,
      end: dayStart(now, count - 2 - i),
      label: L.days[new Date(start).getDay()],
      day: new Date(start).getDate(),
      cur: i === count - 1,
    }
  })
}

function hourBars(now) {
  const midnight = dayStart(now, 0)
  const currentHour = new Date(now).getHours()
  return Array.from({ length: 24 }, (_, hour) => ({ ...newSums(), start: midnight + hour * HOUR, label: String(hour), cur: hour === currentHour }))
}

const positive = value => (Number(value) > 0 ? Number(value) : 0)

/** Adds an hour to a bag of sums; `full` also adds its split, which only the panel shows. */
function addTo(sums, hour, full = true) {
  sums.total += hour.tokens
  sums.cost += hour.cost
  if (!hour.costAware) sums.uncosted += hour.tokens
  if (!full) return
  const detail = hour.detail
  if (detail) {
    for (const [model, n] of Object.entries(detail.m || {})) if (positive(n)) sums.models[model] = (sums.models[model] || 0) + positive(n)
    for (const [project, n] of Object.entries(hour.p || {})) if (positive(n)) sums.projects[project] = (sums.projects[project] || 0) + positive(n)
    for (const key of KIND_KEYS) if (detail.k) sums.kinds[key] += positive(detail.k[key])
  }
  if (hour.cost > 0) {
    if (!hour.costProjects) hour.costProjects = costByProject(hour.cost, hour.allP, hour.sessionProject)
    for (const [project, usd] of Object.entries(hour.costProjects)) sums.costProjects[project] = (sums.costProjects[project] || 0) + usd
  }
}

/** Splits an hour's cost between its projects by their tokens; with no tokens it goes to the session's project. */
function costByProject(cost, projects, sessionProject) {
  const tokens = projects || {}
  let sum = 0
  for (const name in tokens) sum += positive(tokens[name])
  if (!sum) return { [sessionProject() || '?']: cost }
  const shares = {}
  for (const name in tokens) if (positive(tokens[name])) shares[name] = (cost * positive(tokens[name])) / sum
  return shares
}

const renameKeys = (map, rename) => {
  const out = {}
  for (const key in map) out[rename(key)] = (out[rename(key)] || 0) + positive(map[key])
  return out
}

/**
 * Every hour of a session file that holds tokens or cost, with its numbers already sanitised.
 * `rename` (from projectLabels) relabels the session's project when another folder shares its name.
 */
/**
 * @param {any} data
 * @param {((key: string) => string) | null} [rename]
 */
function hoursOf(data, rename = null) {
  const buckets = data.buckets && typeof data.buckets === 'object' ? data.buckets : {}
  const details = data.detail && typeof data.detail === 'object' ? data.detail : {}
  const costAware = typeof data.v === 'string' && cmpVer(data.v, COST_PLUGIN) >= 0
  // working the project out can mean a pass over every hour, so only when an hour needs it
  let project
  const sessionProject = () => {
    if (project === undefined) {
      const name = fileProject(data)
      project = name && rename ? rename(name) : name
    }
    return project
  }
  const hours = []
  const add = key => {
    const start = Number(key)
    if (!Number.isFinite(start)) return
    const detail = details[key] && typeof details[key] === 'object' ? details[key] : null
    const tokens = positive(buckets[key])
    const cost = detail ? positive(num(detail.c)) : 0
    if (!tokens && !cost) return
    const projects = detail && detail.p && typeof detail.p === 'object' ? (rename ? renameKeys(detail.p, rename) : detail.p) : null
    // the cost split by project is worked out on first use (see addTo)
    hours.push({ start, tokens, cost, detail: tokens ? detail : null, p: tokens ? projects : null, allP: projects, costAware, sessionProject, costProjects: null })
  }
  for (const key in buckets) add(key)
  for (const key in details) if (!(key in buckets)) add(key)
  return hours
}

/**
 * Adds up the session files. `detailed` also fills every chart bar with its own split (models,
 * projects, kinds, cost), which only the panel needs; `now` is fixed by tests.
 */
/**
 * @param {{ d: any, machine: string }[]} sessions
 * @param {string} localId
 * @param {string | { name: string | null, pid: string | null, parent?: string | null } | null} [project]
 * @param {{ detailed?: boolean, now?: number }} [options]
 */
function readTotals(sessions, localId, project = null, { detailed = true, now = Date.now() } = {}) {
  const midnight = dayStart(now, 0)
  const labels = projectLabels(sessions)
  // the project to narrow to: { name, pid } from the editor, or a plain folder name
  const wanted = typeof project === 'string' ? { name: project, pid: null } : project
  const periods = { today: newPeriod(hourBars(now)), d7: newPeriod(dayBars(now, 7)), d30: newPeriod(dayBars(now, 30)) }
  // the same stretch of time one period back: yesterday up to this time, and the 7 days before the last 7
  const back = {
    today: { from: dayStart(now, 1), to: dayStart(now, 1) + (now - midnight), sums: newSums() },
    d7: { from: dayStart(now, 13), to: dayStart(now, 13) + (now - dayStart(now, 6)), sums: newSums() },
  }
  const raw = []
  const devices = new Set()
  let newestAny = null
  let newestWithTokens = null
  let costSeen = false

  for (const { d: data, machine } of sessions) {
    devices.add(machine)
    const updatedAt = num(data.updatedAt) || 0
    if (now - updatedAt > KEEP_DAYS * DAY) continue

    const isLocal = machine === localId
    const hours = hoursOf(data, labels.forSession(data, machine))
    if (isLocal && (!newestAny || updatedAt > newestAny.t)) {
      newestAny = { t: updatedAt, v: typeof data.v === 'string' ? data.v : null }
    }
    if (isLocal && hours.some(h => h.tokens) && (!newestWithTokens || updatedAt > newestWithTokens.t)) {
      const details = data.detail && typeof data.detail === 'object' ? Object.values(data.detail) : []
      newestWithTokens = { t: updatedAt, hasKinds: details.some(h => h && h.k && typeof h.k === 'object') }
    }
    if (wanted && !belongsTo(data, wanted, { local: isLocal, nameOf: fileProject, sameName: sameProject, ambiguous: labels.ambiguous })) continue

    const hit = { today: false, d7: false, d30: false }
    for (const hour of hours) {
      if (hour.cost > 0 || hour.costAware) costSeen = true
      const detail = hour.detail
      raw.push({ t: hour.start, v: hour.tokens, c: hour.cost, m: detail ? detail.m : null, p: hour.p, k: detail && detail.k ? detail.k : null })

      if (hour.start >= midnight) {
        hit.today = true
        const bar = periods.today.bars[new Date(hour.start).getHours()]
        addTo(periods.today, hour, detailed)
        if (bar && detailed) addTo(bar, hour)
      }
      for (const name of ['d7', 'd30']) {
        const bars = periods[name].bars
        if (hour.start < bars[0].start) continue
        const bar = bars.find(b => hour.start >= b.start && hour.start < b.end)
        if (!bar) continue
        hit[name] = true
        addTo(periods[name], hour, detailed)
        if (detailed) addTo(bar, hour)
      }
      for (const window of Object.values(back)) if (hour.start >= window.from && hour.start < window.to) addTo(window.sums, hour, false)
    }
    for (const name of Object.keys(hit)) if (hit[name]) periods[name].sessions++
  }

  for (const [name, window] of Object.entries(back)) periods[name].prev = { total: window.sums.total, cost: window.sums.cost }

  return {
    periods,
    sessionsToday: periods.today.sessions,
    devices: devices.size,
    raw,
    costSeen,
    pluginOutdated: !!(newestWithTokens && !newestWithTokens.hasKinds),
    pluginVersion: newestAny ? newestAny.v : undefined,
  }
}

function mergeModels(models) {
  const merged = {}
  for (const [id, tokens] of Object.entries(models)) {
    const name = prettyModel(id)
    merged[name] = (merged[name] || 0) + tokens
  }
  return merged
}

function kindsOf(sums) {
  const { i, o, w, r } = sums.kinds
  return { cacheRead: r, cacheWrite: w, input: i, output: o, unknown: Math.max(0, sums.total - (i + o + w + r)) }
}

function top(map, limit = 6) {
  const rows = Object.entries(map).sort((a, b) => b[1] - a[1])
  const head = rows.slice(0, limit)
  const rest = rows.slice(limit).reduce((sum, row) => sum + row[1], 0)
  if (rest > 0) head.push(['…', rest])
  return head.map(([name, v]) => ({ name, v }))
}

module.exports = { readTotals, mergeModels, kindsOf, top }
