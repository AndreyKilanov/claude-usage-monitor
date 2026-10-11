const dayStart = (now, back) => {
  const date = new Date(now)
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() - back).getTime()
}

const isoDay = ms => {
  const date = new Date(ms)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

module.exports = { dayStart, isoDay }
