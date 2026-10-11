// Run with: node --test extension/test
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const Module = require('module')

const live = []
test.afterEach(() => { for (const t of live.splice(0)) t.stop() }) // a failing test must not leave timers behind

const H = 3600_000
const EXT = path.join(__dirname, '..', 'extension.js')

// A fresh editor, a fresh home folder and a fresh copy of the extension for every test.
function setup({ lang = 'en', config = {}, store = {} } = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cum-'))
  process.env.HOME = home
  const sessDir = path.join(home, '.claude', 'usage-monitor')
  fs.mkdirSync(sessDir, { recursive: true })
  const log = { warn: [], error: [], info: [], panels: [], posted: [], saved: null }
  const items = []
  const cmds = {}
  const vs = {
    env: { language: lang },
    workspace: { getConfiguration: () => ({ get: (k, d) => (k in config ? config[k] : d) }), onDidChangeConfiguration: () => ({ dispose() {} }) },
    window: {
      createStatusBarItem: () => { const i = { show() {}, dispose() {} }; items.push(i); return i },
      createWebviewPanel: () => {
        const p = { webview: { postMessage: m => { log.posted.push(m) }, onDidReceiveMessage() {}, set html(v) { p.html = v } }, onDidDispose() {}, reveal() {} }
        log.panels.push(p)
        return p
      },
      showWarningMessage: m => log.warn.push(m),
      showErrorMessage: m => log.error.push(m),
      showInformationMessage: m => log.info.push(m),
      showSaveDialog: async () => (log.saved ? { fsPath: log.saved } : undefined),
    },
    StatusBarAlignment: { Right: 1 },
    ThemeColor: class { constructor(id) { this.id = id } },
    MarkdownString: class { constructor(v) { this.value = v } },
    commands: { registerCommand: (n, f) => { cmds[n] = f; return { dispose() {} } } },
    ViewColumn: { Beside: 2 },
    Uri: { file: p => ({ fsPath: p }) },
  }
  const orig = Module._load
  Module._load = function (r, ...a) { return r === 'vscode' ? vs : orig.call(this, r, ...a) }
  delete require.cache[EXT]
  const ext = require(EXT)
  Module._load = orig
  const gs = { ...store }
  const ctx = { subscriptions: [], globalState: { get: (k, d) => (k in gs ? gs[k] : d), update: (k, v) => { gs[k] = v } } }
  const api = {
    home, sessDir, log, items, cmds, ext, gs,
    start() { ext.activate(ctx); live.push(api); return api },
    write(name, obj, dir = sessDir) { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, name), typeof obj === 'string' ? obj : JSON.stringify(obj)) },
    text() { return items[0].text },
    tooltip() { return items[0].tooltip.value || items[0].tooltip },
    refresh() { cmds['claudeUsage.refresh']() },
    stop() { ctx.subscriptions.forEach(s => s.dispose && s.dispose()) },
  }
  return api
}
const iso = ms => new Date(Date.now() + ms).toISOString()
const session = (over = {}) => ({
  fiveHour: 40, fiveHourResetsAt: iso(2 * H), sevenDay: 10, sevenDayResetsAt: iso(80 * H),
  limits: [], tokens: 1000, usd: 0.5, updatedAt: Date.now(), buckets: {}, detail: {}, ...over,
})
const hourNow = () => Math.floor(Date.now() / H) * H

test('no data at all: a calm message, no crash', () => {
  const t = setup().start()
  assert.match(t.text(), /no data/)
  t.stop()
})

test('a half-written file is skipped and the good one is used', () => {
  const t = setup()
  t.write('torn.json', '{"fiveHour":43,"updatedAt":17917\0\0\0\0')
  t.write('ok.json', session({ fiveHour: 55 }))
  t.start()
  assert.match(t.text(), /5h 55%/)
  t.stop()
})

test('strange values never print NaN or undefined', () => {
  const t = setup()
  t.write('weird.json', { fiveHour: 'lots', sevenDay: {}, limits: [null, 5, { kind: 3 }, { kind: 'five_hour', percentUsed: 'x' }], tokens: 'many', usd: NaN, updatedAt: 'now', buckets: { abc: 5, [hourNow()]: 'x', [hourNow() - H]: -5 }, detail: 7 })
  t.write('array.json', '[1,2,3]')
  t.write('null.json', 'null')
  t.start()
  assert.doesNotMatch(t.text() + t.tooltip(), /NaN|undefined|null|Infinity/)
  t.stop()
})

test('a window that has reset since the last reading is shown empty, not stale', () => {
  const t = setup()
  t.write('old.json', session({ fiveHour: 97, fiveHourResetsAt: iso(-H), sevenDay: 20, limits: [{ kind: 'five_hour', percentUsed: 97, resetsAt: iso(-H) }] }))
  t.start()
  assert.match(t.text(), /5h 0%/)
  assert.deepEqual(t.log.warn.concat(t.log.error), []) // no scary alert from a number that is no longer true
  t.stop()
})

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
  const { dayStart } = t.ext.__test
  const now = new Date(2026, 10, 3, 12, 0).getTime() // Nov 3: DST ended on Nov 1
  const starts = Array.from({ length: 8 }, (_, i) => dayStart(now, 7 - i))
  for (const s of starts) assert.equal(new Date(s).getHours(), 0, new Date(s).toString())
  for (let i = 1; i < starts.length; i++) assert.ok(starts[i] > starts[i - 1])
  const fallBack = starts[starts.length - 1 - 2] // Nov 1
  assert.equal(new Date(fallBack).getDate(), 1)
  assert.equal(starts[starts.length - 2] - fallBack, 25 * H) // the long day is one bar, not two
  delete process.env.TZ
})

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

  const next = iso(8 * H) // a new window
  t.write('s.json', session({ fiveHour: 3, fiveHourResetsAt: next, limits: [{ kind: 'five_hour', percentUsed: 3, resetsAt: next }] }))
  t.refresh()
  assert.equal(t.log.info.length, 1, 'reset is announced once')
  t.refresh()
  assert.equal(t.log.info.length, 1)
  t.stop()

  // a second editor window that shares the same stored state does not repeat the news
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

test('a misordered threshold pair (warn above critical) still gives sane colours', () => {
  const t = setup({ config: { warnAt: 95, critAt: 90 } })
  t.write('s.json', session({ fiveHour: 92 }))
  t.start()
  assert.equal(t.items[0].backgroundColor.id, 'statusBarItem.errorBackground')
  t.stop()
})

test('forecast: only with an honest pace, and only before the reset', () => {
  const { forecast } = setup().ext.__test
  const now = Date.now()
  const u = { fiveHourResetsAt: iso(5 * H) }
  assert.equal(forecast([], u), null)
  assert.equal(forecast([{ t: now - 60_000, p: 10 }, { t: now, p: 12 }], u), null, 'too short a span')
  assert.equal(forecast([{ t: now - 600_000, p: 10 }, { t: now, p: 10 }], u), null, 'no growth')
  const eta = forecast([{ t: now - 600_000, p: 10 }, { t: now, p: 20 }], u) // 1%/min
  assert.ok(Math.abs(eta - 80 * 60_000) < 1000)
  assert.equal(forecast([{ t: now - 600_000, p: 10 }, { t: now, p: 20 }], { fiveHourResetsAt: iso(30 * 60_000) }), null, 'the window resets first')
  assert.equal(forecast([{ t: now - 600_000, p: 90 }, { t: now, p: 100 }], u), null, 'already at the limit')
})

test('model names are readable', () => {
  const { prettyModel } = setup().ext.__test
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
  const week = data.periods.d30
  assert.equal(week.models.length, 1)
  assert.equal(week.models[0].name, 'Opus 5.5')
  assert.equal(week.projects.length, 7)
  assert.equal(week.projects.at(-1).name, '…')
  t.stop()
})

test('CSV: a folder named like a formula is neutralised, commas and quotes survive', async () => {
  const t = setup()
  const detail = { [hourNow()]: { m: { 'claude-opus-5-5': 10 }, p: { '=HYPERLINK("x")': 5, 'a,b': 5 } } }
  t.write('s.json', session({ buckets: { [hourNow()]: 10 }, detail }))
  t.start()
  t.log.saved = path.join(t.home, 'out.csv')
  await t.cmds['claudeUsage.exportCsv']()
  const csv = fs.readFileSync(t.log.saved, 'utf8')
  assert.match(csv, /^date,dimension,name,tokens\n/)
  assert.ok(csv.includes(`"'=HYPERLINK(""x"")"`), csv)
  assert.ok(csv.includes('"a,b"'))
  assert.ok(!/(^|,)=/m.test(csv), 'no cell may start with =')
  t.stop()
})

test('CSV: cancelling the dialog, and an unwritable path, are handled', async () => {
  const t = setup()
  t.write('s.json', session({ buckets: { [hourNow()]: 10 } }))
  t.start()
  t.log.saved = null
  await t.cmds['claudeUsage.exportCsv']() // cancelled: nothing happens
  t.log.saved = path.join(t.home, 'no', 'such', 'dir', 'x.csv')
  await t.cmds['claudeUsage.exportCsv']()
  assert.equal(t.log.error.length, 1)
  const empty = setup().start()
  await empty.cmds['claudeUsage.exportCsv']()
  assert.equal(empty.log.info.length, 1) // "nothing to export"
  t.stop(); empty.stop()
})

test('the panel is a static shell: no innerHTML for data, a strict CSP', () => {
  const html = setup().ext.__test.panelHtml()
  assert.match(html, /Content-Security-Policy[^>]*default-src 'none'/)
  const uses = html.match(/innerHTML/g) || []
  assert.equal(uses.length, 1, 'only the fixed ring svg uses innerHTML')
  assert.ok(!/\$\{/.test(html.replace(/nonce-[0-9a-f]+/g, '')), 'no unexpanded template')
})

test('a project name with markup cannot reach the page as HTML', () => {
  const t = setup()
  const evil = '<img src=x onerror=alert(1)>'
  t.write('s.json', session({ buckets: { [hourNow()]: 10 }, detail: { [hourNow()]: { m: { m: 10 }, p: { [evil]: 10 } } } }))
  t.start()
  t.cmds['claudeUsage.open']()
  t.refresh()
  const html = t.log.panels[0].html
  assert.ok(!html.includes(evil), 'the shell never contains data')
  assert.equal(t.log.posted.at(-1).data.periods.today.projects[0].name, evil) // data travels as data, drawn with textContent
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

test('Russian: grammar-sensitive strings render and nothing is left untranslated', () => {
  const t = setup({ lang: 'ru' })
  t.write('s.json', session({ fiveHour: 95 }))
  t.start()
  assert.match(t.text(), /5ч 95%/)
  assert.match(t.log.error[0], /лимит почти исчерпан/)
  assert.match(t.tooltip(), /Окно 5 часов/)
  t.stop()
})
