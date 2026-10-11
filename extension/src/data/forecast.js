function forecast(history, usage) {
  const now = Date.now()
  const points = history.filter(s => now - s.t < 3600_000)
  if (points.length < 2) return null
  const first = points[0]
  const lastPoint = points[points.length - 1]
  const elapsed = lastPoint.t - first.t
  const grown = lastPoint.p - first.p
  if (elapsed < 180_000 || grown < 1 || lastPoint.p >= 100) return null
  const eta = ((100 - lastPoint.p) / grown) * elapsed
  const untilReset = usage.fiveHourResetsAt ? Date.parse(usage.fiveHourResetsAt) - now : Infinity
  return eta < untilReset ? eta : null
}

module.exports = { forecast }
