const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { setup } = require('./helpers/harness')
const { HOUR: H, hourNow, session } = require('./helpers/fixtures')

const DAY = 24 * H

/** Starts the extension with timers captured instead of scheduled, so a test can fire them by hand. */
function withTimers(options) {
  const t = setup(options)
  const timers = []
  const realSet = global.setInterval
  const realClear = global.clearInterval
  global.setInterval = (fn, ms) => { const timer = { fn, ms, unref() { return timer } }; timers.push(timer); return timer }
  global.clearInterval = timer => { const i = timers.indexOf(timer); if (i >= 0) timers.splice(i, 1) }
  try {
    t.start()
  } finally {
    global.setInterval = realSet
    global.clearInterval = realClear
  }
  t.timers = timers
  t.tick = ms => timers.filter(timer => timer.ms === ms).forEach(timer => timer.fn())
  return t
}

test('tests never see the real home folder, on any platform', () => {
  const t = setup()
  assert.equal(os.homedir(), t.home)
})

test('the 3-second check redraws only when this machine\'s files changed', () => {
  const t = withTimers()
  t.write('a.json', session({ buckets: { [hourNow()]: 10 } }))
  t.refresh()
  const before = t.items[0].tooltip
  t.tick(3000)
  assert.equal(t.items[0].tooltip, before, 'nothing changed, nothing redrawn')
  t.write('b.json', session({ buckets: { [hourNow()]: 20 } }))
  t.tick(3000)
  assert.notEqual(t.items[0].tooltip, before, 'a new file is picked up by the quick check')
  assert.match(t.text(), /today 30/)
})

test('refreshIntervalSeconds really sets the full redraw, with a floor of 10 seconds', () => {
  const t = withTimers({ config: { refreshIntervalSeconds: 45 } })
  assert.ok(t.timers.some(timer => timer.ms === 45000), t.timers.map(x => x.ms).join(','))
  const before = t.items[0].tooltip
  t.tick(45000)
  assert.notEqual(t.items[0].tooltip, before, 'the timed redraw always redraws')
  const low = withTimers({ config: { refreshIntervalSeconds: 1 } })
  assert.ok(low.timers.some(timer => timer.ms === 10000))
})

test('cleanup: old local files and this machine\'s old sync copies go; other devices and undated files stay', () => {
  const sync = fs.mkdtempSync(path.join(os.tmpdir(), 'cum-sync-'))
  const t = setup({ config: { syncFolder: sync }, store: { machineId: 'this-pc' } })
  const old = Date.now() - 40 * DAY
  t.write('old.json', session({ updatedAt: old }))
  t.write('fresh.json', session())
  t.write('undated.json', { tokens: 1 })
  const mine = path.join(sync, 'this-pc')
  t.write('ancient-copy.json', session({ updatedAt: old }), mine)
  fs.utimesSync(path.join(mine, 'ancient-copy.json'), old / 1000, old / 1000)
  t.write('theirs.json', session({ updatedAt: old }), path.join(sync, 'other-pc'))
  const theirs = path.join(sync, 'other-pc', 'theirs.json')
  fs.utimesSync(theirs, old / 1000, old / 1000)
  t.start()
  assert.ok(!fs.existsSync(path.join(t.sessDir, 'old.json')))
  assert.ok(fs.existsSync(path.join(t.sessDir, 'fresh.json')))
  assert.ok(fs.existsSync(path.join(t.sessDir, 'undated.json')), 'a file without a date is never guessed at')
  assert.ok(!fs.existsSync(path.join(mine, 'ancient-copy.json')))
  assert.ok(fs.existsSync(path.join(mine, 'fresh.json')), 'the fresh file was copied')
  assert.ok(fs.existsSync(theirs), "another device's folder is theirs to clean")
})

test('reading the totals no longer deletes anything', () => {
  const t = setup()
  t.write('old.json', session({ updatedAt: Date.now() - 40 * DAY }))
  const { scan } = t.mod('data/sessions')
  const { readTotals } = t.mod('data/totals')
  readTotals(scan('m'), 'm')
  assert.ok(fs.existsSync(path.join(t.sessDir, 'old.json')))
})

test('the file cache forgets files that are gone', () => {
  const t = setup()
  t.write('a.json', session())
  t.write('b.json', session())
  t.start()
  const { cacheSize } = t.mod('data/sessions')
  assert.equal(cacheSize(), 2)
  fs.unlinkSync(path.join(t.sessDir, 'b.json'))
  t.refresh()
  assert.equal(cacheSize(), 1)
})

test('sync: copies are made when local files change, not on every redraw', () => {
  const sync = fs.mkdtempSync(path.join(os.tmpdir(), 'cum-sync-'))
  const t = withTimers({ config: { syncFolder: sync }, store: { machineId: 'this-pc' } })
  t.write('a.json', session())
  t.refresh()
  const copy = path.join(sync, 'this-pc', 'a.json')
  assert.ok(fs.existsSync(copy))
  fs.unlinkSync(copy)
  t.tick(30000)
  assert.ok(!fs.existsSync(copy), 'a timed redraw with no local change copies nothing')
  t.write('a.json', session({ tokens: 5 }))
  t.tick(3000)
  assert.ok(fs.existsSync(copy), 'a local change is copied out')
})

test('alerts: the editor state is written only when an alert level changes', () => {
  let writes = 0
  const store = new Proxy({}, { set(target, key, value) { if (key === 'alerts') writes++; target[key] = value; return true } })
  const t = setup({ store })
  t.write('a.json', session({ fiveHour: 85 }))
  t.start()
  const afterFirst = writes
  assert.ok(afterFirst >= 1)
  t.refresh()
  t.refresh()
  assert.equal(writes, afterFirst, 'the same reading twice writes nothing')
  t.write('a.json', session({ fiveHour: 95 }))
  t.refresh()
  assert.equal(writes, afterFirst + 1)
})
