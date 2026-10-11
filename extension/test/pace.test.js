const test = require('node:test')
const assert = require('node:assert/strict')
const { setup, payloadOf } = require('./helpers/harness')
const { HOUR, iso, session } = require('./helpers/fixtures')

const { windowPace } = setup().mod('data/pace')
const NOW = Date.parse('2026-03-10T12:00:00Z')

test('pace: the share of the week that has passed, only for the weekly window', () => {
  assert.equal(windowPace('seven_day', new Date(NOW + 84 * HOUR).toISOString(), NOW), 0.5)
  assert.equal(windowPace('seven_day', new Date(NOW + 168 * HOUR).toISOString(), NOW), 0)
  assert.equal(windowPace('seven_day', new Date(NOW).toISOString(), NOW), 1)
  assert.equal(windowPace('five_hour', new Date(NOW + HOUR).toISOString(), NOW), null)
})

test('pace: missing, broken or impossible reset times give no mark', () => {
  assert.equal(windowPace('seven_day', null, NOW), null)
  assert.equal(windowPace('seven_day', 'not a date', NOW), null)
  assert.equal(windowPace('seven_day', new Date(NOW + 200 * HOUR).toISOString(), NOW), null)
  assert.equal(windowPace('seven_day', new Date(NOW - HOUR).toISOString(), NOW), null)
})

const weekNote = t => payloadOf(t).windows.find(window => window.note).note

test('pace: the weekly card says how much of the week has passed and what that means', () => {
  const t = setup()
  t.write('s.json', session({ sevenDay: 17, sevenDayResetsAt: iso(84 * HOUR) }))
  t.start()
  const { windows } = payloadOf(t)
  assert.equal(windows.filter(window => window.note).length, 1, 'only the weekly card has a note')
  assert.match(weekNote(t).text, /50% of the week has passed/)
  assert.match(weekNote(t).verdict, /headroom/)
})

test('pace: spending ahead of the week says so, spending in step says that', () => {
  const ahead = setup()
  ahead.write('s.json', session({ sevenDay: 80, sevenDayResetsAt: iso(84 * HOUR) }))
  ahead.start()
  assert.match(weekNote(ahead).verdict, /fast/)
  assert.equal(weekNote(ahead).tone, 'warn')

  const even = setup()
  even.write('s.json', session({ sevenDay: 52, sevenDayResetsAt: iso(84 * HOUR) }))
  even.start()
  assert.match(weekNote(even).verdict, /on pace/i)
})

test('pace: no weekly reset time means no note; Russian texts are Russian', () => {
  const none = setup()
  none.write('s.json', session({ sevenDayResetsAt: null, limits: [] }))
  none.start()
  assert.ok(payloadOf(none).windows.every(window => window.note === null))

  const t = setup({ lang: 'ru' })
  t.write('s.json', session({ sevenDay: 17, sevenDayResetsAt: iso(84 * HOUR) }))
  t.start()
  assert.match(weekNote(t).text, /Неделя прошла на 50%/)
  assert.match(weekNote(t).verdict, /запас/)
})
