const { L } = require('../i18n')
const { num } = require('../util/numbers')

function readLimits(sessions) {
  const hasLimits = s => num(s.d.fiveHour) !== null || num(s.d.sevenDay) !== null || (Array.isArray(s.d.limits) && s.d.limits.length > 0)
  const withLimits = sessions.filter(hasLimits)
  const pool = withLimits.length ? withLimits : sessions
  const newest = pool.reduce((a, b) => (!a || (num(b.d.updatedAt) || 0) > (num(a.d.updatedAt) || 0) ? b : a), null)
  if (!newest) return null
  const data = newest.d
  const now = Date.now()

  const fresh = (percent, iso) => {
    const value = num(percent)
    const resetAt = iso ? Date.parse(iso) : NaN
    if (value !== null && Number.isFinite(resetAt) && resetAt < now) return { p: 0, resetsAt: null }
    return { p: value, resetsAt: Number.isFinite(resetAt) ? iso : null }
  }

  const five = fresh(data.fiveHour, data.fiveHourResetsAt)
  const week = fresh(data.sevenDay, data.sevenDayResetsAt)
  const limits = (Array.isArray(data.limits) ? data.limits : [])
    .filter(l => l && typeof l.kind === 'string' && num(l.percentUsed) !== null)
    .map(l => {
      const f = fresh(l.percentUsed, l.resetsAt)
      return { kind: String(l.kind).slice(0, 40), percentUsed: f.p, resetsAt: f.resetsAt }
    })

  return {
    fiveHour: five.p,
    fiveHourResetsAt: five.resetsAt,
    sevenDay: week.p,
    sevenDayResetsAt: week.resetsAt,
    limits,
    tokens: num(data.tokens) || 0,
    usd: num(data.usd),
    updatedAt: num(data.updatedAt) || 0,
  }
}

function windows(usage) {
  const list = (usage.limits || []).map(l => ({ kind: l.kind, p: l.percentUsed, resetsAt: l.resetsAt }))
  if (!list.length) {
    if (usage.fiveHour !== null) list.push({ kind: 'five_hour', p: usage.fiveHour, resetsAt: usage.fiveHourResetsAt })
    if (usage.sevenDay !== null) list.push({ kind: 'seven_day', p: usage.sevenDay, resetsAt: usage.sevenDayResetsAt })
  }
  const order = { five_hour: 0, seven_day: 1 }
  return list.sort((a, b) => (order[a.kind] ?? 9) - (order[b.kind] ?? 9))
}

const nameOf = kind => ({
  five_hour: L.win5,
  seven_day: L.winWeek,
  seven_day_sonnet: L.sonnet,
  seven_day_opus: L.opus,
  spend_limit: L.spend,
})[kind] || `${L.other} ${kind}`

module.exports = { readLimits, windows, nameOf }
