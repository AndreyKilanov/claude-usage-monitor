const fs = require('fs')
const { L } = require('../i18n')
const { SESS, DAY, KEEP_DAYS } = require('../constants')
const { num } = require('../util/numbers')
const { dayStart } = require('../util/dates')
const { prettyModel } = require('../util/format')
const { fileProject, sameProject } = require('../util/projects')

const KIND_KEYS = ['i', 'o', 'w', 'r']

const newPeriod = bars => ({ bars, total: 0, models: {}, projects: {}, kinds: { i: 0, o: 0, w: 0, r: 0 } })

function dayBars(now, count) {
  return Array.from({ length: count }, (_, i) => {
    const start = dayStart(now, count - 1 - i)
    return {
      start,
      end: dayStart(now, count - 2 - i),
      label: L.days[new Date(start).getDay()],
      day: new Date(start).getDate(),
      v: 0,
      cur: i === count - 1,
    }
  })
}

function hourBars() {
  const currentHour = new Date().getHours()
  return Array.from({ length: 24 }, (_, hour) => ({ label: String(hour), v: 0, cur: hour === currentHour }))
}

function addToPeriod(period, bar, tokens, detail) {
  period.total += tokens
  if (bar) bar.v += tokens
  if (!detail) return
  for (const [model, n] of Object.entries(detail.m || {})) {
    if (Number(n) > 0) period.models[model] = (period.models[model] || 0) + Number(n)
  }
  for (const [project, n] of Object.entries(detail.p || {})) {
    if (Number(n) > 0) period.projects[project] = (period.projects[project] || 0) + Number(n)
  }
  for (const key of KIND_KEYS) {
    if (detail.k && Number(detail.k[key]) > 0) period.kinds[key] += Number(detail.k[key])
  }
}

function readTotals(sessions, localId, project = null) {
  const now = Date.now()
  const midnight = dayStart(now, 0)
  const periods = { today: newPeriod(hourBars()), d7: newPeriod(dayBars(now, 7)), d30: newPeriod(dayBars(now, 30)) }
  const raw = []
  const devices = new Set()
  let newestAny = null
  let newestWithTokens = null
  let sessionsToday = 0

  for (const { full, d: data, machine } of sessions) {
    devices.add(machine)
    const updatedAt = num(data.updatedAt) || 0
    if (now - updatedAt > KEEP_DAYS * DAY) {
      if (full.startsWith(SESS)) {
        try { fs.unlinkSync(full) } catch {}
      }
      continue
    }

    const isLocal = machine === localId
    const buckets = data.buckets && typeof data.buckets === 'object' ? data.buckets : {}
    const details = data.detail && typeof data.detail === 'object' ? data.detail : {}

    if (isLocal && (!newestAny || updatedAt > newestAny.t)) {
      newestAny = { t: updatedAt, v: typeof data.v === 'string' ? data.v : null }
    }
    if (isLocal && Object.keys(buckets).length && (!newestWithTokens || updatedAt > newestWithTokens.t)) {
      newestWithTokens = { t: updatedAt, hasKinds: Object.values(details).some(h => h && h.k && typeof h.k === 'object') }
    }
    if (project && !sameProject(fileProject(data), project)) continue

    let hitToday = false
    for (const [key, value] of Object.entries(buckets)) {
      const hourStart = Number(key)
      const tokens = Number(value)
      if (!Number.isFinite(hourStart) || !(tokens > 0)) continue
      const detail = details[key] || null
      raw.push({ t: hourStart, v: tokens, m: detail ? detail.m : null, p: detail ? detail.p : null, k: detail && detail.k ? detail.k : null })

      if (hourStart >= midnight) {
        hitToday = true
        addToPeriod(periods.today, periods.today.bars[new Date(hourStart).getHours()], tokens, detail)
      }
      for (const name of ['d7', 'd30']) {
        const bar = periods[name].bars.find(b => hourStart >= b.start && hourStart < b.end)
        if (bar) addToPeriod(periods[name], bar, tokens, detail)
      }
    }
    if (hitToday) sessionsToday++
  }

  return {
    periods,
    sessionsToday,
    devices: devices.size,
    raw,
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

function kindsOf(period) {
  const { i, o, w, r } = period.kinds
  return { cacheRead: r, cacheWrite: w, input: i, output: o, unknown: Math.max(0, period.total - (i + o + w + r)) }
}

function top(map, limit = 6) {
  const rows = Object.entries(map).sort((a, b) => b[1] - a[1])
  const head = rows.slice(0, limit)
  const rest = rows.slice(limit).reduce((sum, row) => sum + row[1], 0)
  if (rest > 0) head.push(['…', rest])
  return head.map(([name, v]) => ({ name, v }))
}

module.exports = { readTotals, mergeModels, kindsOf, top }
