const { DAY } = require('../constants')

const WINDOW_MS = { seven_day: 7 * DAY }

function windowPace(kind, resetsAt, now = Date.now()) {
  const length = WINDOW_MS[kind]
  const resetAt = resetsAt ? Date.parse(resetsAt) : NaN
  if (!length || !Number.isFinite(resetAt)) return null
  const elapsed = (length - (resetAt - now)) / length
  return elapsed >= 0 && elapsed <= 1 ? elapsed : null
}

module.exports = { windowPace }
