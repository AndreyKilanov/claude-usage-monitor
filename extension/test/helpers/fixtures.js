const HOUR = 3600_000

const iso = offsetMs => new Date(Date.now() + offsetMs).toISOString()
const hourNow = () => Math.floor(Date.now() / HOUR) * HOUR

const session = (overrides = {}) => ({
  fiveHour: 40,
  fiveHourResetsAt: iso(2 * HOUR),
  sevenDay: 10,
  sevenDayResetsAt: iso(80 * HOUR),
  limits: [],
  tokens: 1000,
  usd: 0.5,
  updatedAt: Date.now(),
  buckets: {},
  detail: {},
  ...overrides,
})

const day = (project, tokens, overrides = {}) => {
  const hour = hourNow()
  return session({
    project,
    buckets: { [hour]: tokens },
    detail: { [hour]: { m: { [`model-of-${project}`]: tokens }, p: { [project]: tokens }, k: { i: 0, o: 0, w: 0, r: tokens } } },
    ...overrides,
  })
}

const dayString = ms => {
  const date = new Date(ms)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

const folder = path => ({ uri: { fsPath: path } })

module.exports = { HOUR, iso, hourNow, session, day, dayString, folder }
