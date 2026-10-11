const test = require('node:test')
const assert = require('node:assert/strict')
const { setup } = require('./helpers/harness')
const { HOUR: H, iso, session } = require('./helpers/fixtures')

test('alerts fire once per level, say so on reset, and stay quiet across windows', () => {
  const store = {}
  const t = setup({ store })
  const reset = iso(3 * H)
  t.write('s.json', session({ fiveHour: 85, fiveHourResetsAt: reset, limits: [{ kind: 'five_hour', percentUsed: 85, resetsAt: reset }] }))
  t.start()
  assert.equal(t.log.warn.length, 1)
  t.refresh(); t.refresh()
  assert.equal(t.log.warn.length, 1, 'no repeat while the level is unchanged')

  t.write('s.json', session({ fiveHour: 95, fiveHourResetsAt: reset, limits: [{ kind: 'five_hour', percentUsed: 95, resetsAt: reset }] }))
  t.refresh()
  assert.equal(t.log.error.length, 1, 'critical is its own alert')

  const next = iso(8 * H)
  t.write('s.json', session({ fiveHour: 3, fiveHourResetsAt: next, limits: [{ kind: 'five_hour', percentUsed: 3, resetsAt: next }] }))
  t.refresh()
  assert.equal(t.log.info.length, 1, 'reset is announced once')
  t.refresh()
  assert.equal(t.log.info.length, 1)
  t.stop()

  const t2 = setup({ store })
  t2.write('s.json', session({ fiveHour: 3, fiveHourResetsAt: next, limits: [{ kind: 'five_hour', percentUsed: 3, resetsAt: next }] }))
  t2.start()
  assert.equal(t2.log.info.length + t2.log.warn.length + t2.log.error.length, 0)
  t2.stop()
})

test('alerts can be switched off', () => {
  const t = setup({ config: { notifications: false } })
  t.write('s.json', session({ fiveHour: 99 }))
  t.start()
  assert.equal(t.log.warn.length + t.log.error.length, 0)
  t.stop()
})
