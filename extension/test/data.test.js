const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { setup, payloadOf } = require('./helpers/harness')
const { HOUR: H, iso, hourNow, session, day, folder } = require('./helpers/fixtures')

const outdated = instance => {
  instance.cmds['claudeUsage.open']()
  instance.refresh()
  return instance.log.posted.at(-1).data.pluginOutdated
}

test('tokens: the same session seen twice (local + synced copy) counts once', () => {
  const sync = fs.mkdtempSync(path.join(os.tmpdir(), 'cum-sync-'))
  const t = setup({ config: { syncFolder: sync } })
  const s = session({ buckets: { [hourNow()]: 1000 } })
  t.write('same.json', s)
  t.write('same.json', { ...s, updatedAt: s.updatedAt - 5 }, path.join(sync, 'old-install-id'))
  t.write('other.json', session({ buckets: { [hourNow()]: 500 } }), path.join(sync, 'laptop-2'))
  t.start()
  assert.match(t.text(), /today 1\.5k/)
  assert.match(t.tooltip(), /sessions: 2/)
  t.stop()
})

test('sync: copies this machine into the folder, never creates a missing folder, expands ~', () => {
  const sync = fs.mkdtempSync(path.join(os.tmpdir(), 'cum-sync-'))
  const t = setup({ config: { syncFolder: sync } })
  t.write('a.json', session())
  t.start()
  const dirs = fs.readdirSync(sync)
  assert.equal(dirs.length, 1)
  assert.ok(fs.existsSync(path.join(sync, dirs[0], 'a.json')))
  assert.ok(!fs.readdirSync(path.join(sync, dirs[0])).some(f => f.endsWith('.tmp')))
  t.stop()

  const ghost = path.join(os.tmpdir(), 'cum-not-mounted', 'x')
  const t2 = setup({ config: { syncFolder: ghost } })
  t2.write('a.json', session())
  t2.start()
  assert.ok(!fs.existsSync(ghost), 'a missing sync folder must not be created')
  t2.stop()

  const t3 = setup({ config: { syncFolder: '~/cum-tilde' } })
  fs.mkdirSync(path.join(t3.home, 'cum-tilde'))
  t3.write('a.json', session())
  t3.start()
  assert.equal(fs.readdirSync(path.join(t3.home, 'cum-tilde')).length, 1)
  t3.stop()
})

test('day boundaries are real local midnights across a daylight-saving change', () => {
  process.env.TZ = 'America/New_York'
  const t = setup()
  const { dayStart } = t.mod('util/dates')
  const now = new Date(2026, 10, 3, 12, 0).getTime()
  const starts = Array.from({ length: 8 }, (_, i) => dayStart(now, 7 - i))
  for (const s of starts) assert.equal(new Date(s).getHours(), 0, new Date(s).toString())
  for (let i = 1; i < starts.length; i++) assert.ok(starts[i] > starts[i - 1])
  const fallBack = starts[starts.length - 1 - 2]
  assert.equal(new Date(fallBack).getDate(), 1)
  assert.equal(starts[starts.length - 2] - fallBack, 25 * H)
  delete process.env.TZ
})

test('forecast: only with an honest pace, and only before the reset', () => {
  const { forecast } = setup().mod('data/forecast')
  const now = Date.now()
  const u = { fiveHourResetsAt: iso(5 * H) }
  assert.equal(forecast([], u), null)
  assert.equal(forecast([{ t: now - 60_000, p: 10 }, { t: now, p: 12 }], u), null, 'too short a span')
  assert.equal(forecast([{ t: now - 600_000, p: 10 }, { t: now, p: 10 }], u), null, 'no growth')
  const eta = forecast([{ t: now - 600_000, p: 10 }, { t: now, p: 20 }], u)
  assert.ok(Math.abs(eta - 80 * 60_000) < 1000)
  assert.equal(forecast([{ t: now - 600_000, p: 10 }, { t: now, p: 20 }], { fiveHourResetsAt: iso(30 * 60_000) }), null, 'the window resets first')
  assert.equal(forecast([{ t: now - 600_000, p: 90 }, { t: now, p: 100 }], u), null, 'already at the limit')
})

test('model names are readable', () => {
  const { prettyModel } = setup().mod('util/format')
  assert.equal(prettyModel('claude-haiku-5-5'), 'Haiku 5.5')
  assert.equal(prettyModel('claude-opus-5-5-20260101'), 'Opus 5.5')
  assert.equal(prettyModel('claude-sonnet-5-5[1m]'), 'Sonnet 5.5')
  assert.equal(prettyModel(undefined), 'Unknown')
  assert.equal(prettyModel(''), 'Unknown')
})

test('breakdown: several dated ids of one model merge; the long tail folds into "…"', () => {
  const t = setup()
  const detail = {}
  const buckets = {}
  for (let i = 0; i < 9; i++) { buckets[hourNow() - i * H] = 100; detail[hourNow() - i * H] = { m: { [`claude-opus-5-5-2026010${i}`]: 100 }, p: { [`proj${i}`]: 100 } } }
  t.write('s.json', session({ buckets, detail }))
  t.start()
  t.cmds['claudeUsage.open']()
  t.refresh()
  const data = t.log.posted.at(-1).data
  const week = data.scopes.all.d30
  assert.equal(week.models.length, 1)
  assert.equal(week.models[0].name, 'Opus 5.5')
  assert.equal(week.projects.length, 7)
  assert.equal(week.projects.at(-1).name, '…')
  t.stop()
})

test('many session files stay cheap: unchanged files are not re-read', () => {
  const t = setup()
  for (let i = 0; i < 300; i++) t.write(`s${i}.json`, session({ buckets: { [hourNow() - (i % 200) * H]: 10 } }))
  t.start()
  const origRead = fs.readFileSync
  let reads = 0
  fs.readFileSync = function (...a) { if (String(a[0]).endsWith('.json') && String(a[0]).includes('usage-monitor')) reads++; return origRead.apply(this, a) }
  const t0 = Date.now()
  for (let i = 0; i < 5; i++) t.refresh()
  fs.readFileSync = origRead
  assert.equal(reads, 0)
  assert.ok(Date.now() - t0 < 1500)
  t.stop()
})

test('token kinds: shares add up, cache reads dominate, old data without a split is shown as such', () => {
  const t = setup()
  const h = hourNow()
  t.write('new.json', session({ buckets: { [h]: 1000 }, detail: { [h]: { m: { m: 1000 }, p: { web: 1000 }, k: { i: 50, o: 150, w: 100, r: 700 } } } }))
  t.write('old.json', session({ buckets: { [h - H]: 400 }, detail: { [h - H]: { m: { m: 400 }, p: { web: 400 } } } }))
  t.start()
  t.cmds['claudeUsage.open']()
  t.refresh()
  const k = t.log.posted.at(-1).data.scopes.all.today.kinds
  assert.deepEqual(k, { cacheRead: 700, cacheWrite: 100, input: 50, output: 150, unknown: 400 })
  assert.equal(k.cacheRead + k.cacheWrite + k.input + k.output + k.unknown, 1400)
  assert.equal(t.log.posted.at(-1).data.scopes.all.today.total, 1400)
  const html = t.log.panels[0].html
  for (const id of ['kcard', 'stack', 'legend', 'knote']) assert.ok(html.includes(`id="${id}"`), id)
})

test('token kinds: hostile or broken values cannot produce negative or NaN shares', () => {
  const t = setup()
  const h = hourNow()
  t.write('s.json', session({ buckets: { [h]: 100 }, detail: { [h]: { m: { m: 100 }, p: { p: 100 }, k: { i: -5, o: 'x', w: null, r: 40 } } } }))
  t.start()
  t.cmds['claudeUsage.open']()
  t.refresh()
  const k = t.log.posted.at(-1).data.scopes.all.today.kinds
  assert.deepEqual(k, { cacheRead: 40, cacheWrite: 0, input: 0, output: 0, unknown: 60 })
})

test('outdated plugin: newest local data without the split triggers the warning, with it does not', () => {
  const h = hourNow()
  const withK = { m: { m: 10 }, p: { p: 10 }, k: { i: 1, o: 1, w: 1, r: 7 } }
  const noK = { m: { m: 10 }, p: { p: 10 } }

  const old = setup()
  old.write('a.json', session({ buckets: { [h]: 10 }, detail: { [h]: noK } }))
  old.start()
  assert.equal(outdated(old), true)
  assert.match(old.log.panels[0].html, /id="koutdated"/)

  const fresh = setup()
  fresh.write('a.json', session({ buckets: { [h]: 10 }, detail: { [h]: withK } }))
  fresh.start()
  assert.equal(outdated(fresh), false)

  const updated = setup()
  updated.write('old.json', session({ updatedAt: Date.now() - 5000, buckets: { [h]: 10 }, detail: { [h]: noK } }))
  updated.write('new.json', session({ updatedAt: Date.now(), buckets: { [h]: 10 }, detail: { [h]: withK } }))
  updated.start()
  assert.equal(outdated(updated), false)

  const stale = setup()
  stale.write('old.json', session({ updatedAt: Date.now() - 5000, buckets: { [h]: 10 }, detail: { [h]: withK } }))
  stale.write('new.json', session({ updatedAt: Date.now(), buckets: { [h]: 10 }, detail: { [h]: noK } }))
  stale.start()
  assert.equal(outdated(stale), true)
})

test('outdated plugin: an empty new session, another machine, or no data at all never raise a false alarm', () => {
  const h = hourNow()
  const noK = { m: { m: 10 }, p: { p: 10 } }
  const emptyNew = setup()
  emptyNew.write('has.json', session({ updatedAt: Date.now() - 5000, buckets: { [h]: 10 }, detail: { [h]: { ...noK, k: { i: 1, o: 1, w: 1, r: 7 } } } }))
  emptyNew.write('just-started.json', session({ updatedAt: Date.now(), buckets: {}, detail: {} }))
  emptyNew.start()
  assert.equal(outdated(emptyNew), false)

  const sync = fs.mkdtempSync(path.join(os.tmpdir(), 'cum-sync-'))
  const remote = setup({ config: { syncFolder: sync } })
  remote.write('theirs.json', session({ buckets: { [h]: 10 }, detail: { [h]: noK } }), path.join(sync, 'other-pc'))
  remote.write('mine.json', session({ updatedAt: Date.now() - 9000, buckets: { [h]: 10 }, detail: { [h]: { ...noK, k: { i: 1, o: 1, w: 1, r: 7 } } } }))
  remote.start()
  assert.equal(outdated(remote), false, "another computer's old plugin is not this machine's problem")

  const none = setup()
  none.write('x.json', session({ buckets: {} }))
  none.start()
  assert.equal(outdated(none), false)
})

test('only this project: the window\'s project is picked from the editor and only its sessions are counted', () => {
  const t = setup()
  t.log.folders = [folder('/work/web-app')]
  t.write('a.json', day('web-app', 1000))
  t.write('b.json', day('web-app', 500))
  t.write('c.json', day('api', 7000))
  t.start()
  const data = payloadOf(t)
  assert.equal(data.projectName, 'web-app')
  assert.equal(data.scopes.all.today.total, 8500)
  assert.equal(data.scopes.project.today.total, 1500)
  assert.deepEqual(data.scopes.project.today.models.map(m => m.name), ['Model of web app'], 'models follow the project too')
  assert.deepEqual(data.scopes.project.today.projects.map(p => p.name), ['web-app'])
  assert.equal(data.scopes.project.today.kinds.cacheRead, 1500, 'the token split follows the project too')
  assert.equal(data.scopes.project.sessionsToday, 2)
  assert.equal(data.scopes.all.sessionsToday, 3)
  const html = t.log.panels[0].html
  for (const id of ['scope', 'pbanner', 'ver', 'pcard', 'cols2']) assert.ok(html.includes(`id="${id}"`), id)
})

test('only this project: the status bar and the limits do not change with it', () => {
  const t = setup({ config: { numberGrouping: 'none' } })
  t.log.folders = [folder('/work/web-app')]
  t.write('a.json', day('web-app', 1000, { fiveHour: 61 }))
  t.write('c.json', day('api', 7000, { fiveHour: 61 }))
  t.start()
  assert.match(t.text(), /today 8\.0k/, 'the status bar always counts every project')
  const data = payloadOf(t)
  assert.equal(data.windows[0].p, 61, 'limits belong to the account')
})

test('only this project: older files without a project field fall back to the folder with most tokens; matching ignores case and Windows paths', () => {
  const { fileProject, folderName } = setup().mod('util/projects')
  const h = hourNow()
  assert.equal(fileProject({ project: 'x', detail: { [h]: { p: { y: 9 } } } }), 'x', 'what the plugin wrote wins')
  assert.equal(fileProject({ detail: { [h]: { p: { a: 5, b: 50 } }, [h - H]: { p: { a: 70 } } } }), 'a')
  assert.equal(fileProject({}), null)
  assert.equal(fileProject({ detail: 'broken' }), null)
  assert.equal(folderName('C:\\Users\\Andy\\Web-App\\'), 'Web-App')
  assert.equal(folderName('/'), null)

  const t = setup()
  t.log.folders = [folder('C:\\Users\\Andy\\WEB-APP')]
  const old = session({ buckets: { [h]: 300 }, detail: { [h]: { m: { m: 300 }, p: { 'web-app': 300 } } } })
  t.write('old.json', old)
  t.write('new.json', day('Web-App', 100))
  t.write('other.json', day('api', 9000))
  t.start()
  const data = payloadOf(t)
  assert.equal(data.projectName, 'WEB-APP')
  assert.equal(data.scopes.project.today.total, 400, 'both spellings of the same folder match')
})

test('only this project: other devices count when their project matches; no folder open means no switch', () => {
  const sync = fs.mkdtempSync(path.join(os.tmpdir(), 'cum-sync-'))
  const t = setup({ config: { syncFolder: sync } })
  t.log.folders = [folder('/work/web-app')]
  t.write('mine.json', day('web-app', 100))
  t.write('theirs.json', day('web-app', 40), path.join(sync, 'laptop'))
  t.write('theirs2.json', day('api', 999), path.join(sync, 'laptop'))
  t.start()
  assert.equal(payloadOf(t).scopes.project.today.total, 140)

  const none = setup()
  none.write('a.json', day('web-app', 100))
  none.start()
  const data = payloadOf(none)
  assert.equal(data.projectName, null)
  assert.equal(data.scopes.project, null)
})

test('versions: current, missing, old, two-digit parts, newest file decides, no data means no alarm', () => {
  const { cmpVer } = setup().mod('util/versions')
  assert.equal(cmpVer('0.6.3', '0.6.3'), 0)
  assert.equal(cmpVer('0.10.0', '0.9.9'), 1, 'numeric, not alphabetical')
  assert.equal(cmpVer('0.6.2', '0.6.3'), -1)
  assert.equal(cmpVer('1.0', '1.0.0'), 0)
  assert.equal(cmpVer(null, '0.6.3'), -1)
  assert.equal(cmpVer('garbage', '0.0.0'), 0)

  const ver = (v, extra = {}) => { const t = setup(); t.write('a.json', day('p', 10, { v, ...extra })); t.start(); return payloadOf(t).versions }
  assert.equal(ver('0.6.3').old, false)
  assert.equal(ver('0.12.1').old, false)
  assert.equal(ver('0.6.2').old, true)
  const missing = ver(undefined)
  assert.equal(missing.old, true)
  assert.match(missing.oldText, /outdated/)
  assert.equal(missing.plugin, null)

  const mixed = setup()
  mixed.write('old.json', day('p', 10, { v: '0.5.0', updatedAt: Date.now() - 9000 }))
  mixed.write('new.json', day('p', 10, { v: '0.6.3', updatedAt: Date.now() }))
  mixed.start()
  assert.equal(payloadOf(mixed).versions.old, false, 'after an update, the freshest file says what runs now')

  const sync = fs.mkdtempSync(path.join(os.tmpdir(), 'cum-sync-'))
  const onlyRemote = setup({ config: { syncFolder: sync } })
  onlyRemote.write('theirs.json', day('p', 10), path.join(sync, 'other-pc'))
  onlyRemote.start()
  const rv = payloadOf(onlyRemote).versions
  assert.equal(rv.old, false)
  assert.equal(rv.plugin, null)
})

test('repository address: from package.json, checked, and never anything but github.com', () => {
  const { repoUrl } = setup().mod('util/versions')
  assert.equal(repoUrl(), 'https://github.com/AndreyKilanov/claude-usage-monitor')
  assert.equal(require('../package.json').repository.url, 'https://github.com/AndreyKilanov/claude-usage-monitor.git')
})
