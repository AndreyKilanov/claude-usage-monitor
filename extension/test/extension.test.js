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
  const log = { warn: [], error: [], info: [], panels: [], posted: [], saved: null, calls: [], folders: undefined, offered: [], executed: [], clip: null, opened: null, confirm: undefined, errorChoice: undefined, openPick: undefined, plan: () => ({}), extensions: [] }
  const items = []
  const cmds = {}
  const vs = {
    env: { language: lang, clipboard: { writeText: async v => { log.clip = v } }, openExternal: async u => { log.opened = u.value } },
    workspace: { get workspaceFolders() { return log.folders }, getConfiguration: () => ({ get: (k, d) => (k in config ? config[k] : d) }), onDidChangeConfiguration: () => ({ dispose() {} }) },
    window: {
      createStatusBarItem: () => { const i = { show() {}, dispose() {} }; items.push(i); return i },
      createWebviewPanel: () => {
        const p = { webview: { postMessage: m => { log.posted.push(m) }, onDidReceiveMessage(cb) { log.onMessage = cb }, set html(v) { p.html = v } }, onDidDispose() {}, reveal() {} }
        log.panels.push(p)
        return p
      },
      showWarningMessage: (m, ...rest) => { log.warn.push(m); return Promise.resolve(rest.length ? log.confirm : undefined) },
      showErrorMessage: m => { log.error.push(m); return Promise.resolve(log.errorChoice) },
      withProgress: (_o, fn) => fn(),
      showOpenDialog: async () => (log.openPick ? [{ fsPath: log.openPick }] : undefined),
      showInformationMessage: m => log.info.push(m),
      showSaveDialog: async () => (log.saved ? { fsPath: log.saved } : undefined),
      showQuickPick: async (items, opts) => { log.offered.push({ ids: items.map(i => i.id), placeHolder: opts && opts.placeHolder }); return log.pick === null ? undefined : items.find(i => i.id === (log.pick || 'model')) },
    },
    StatusBarAlignment: { Right: 1 },
    ThemeColor: class { constructor(id) { this.id = id } },
    MarkdownString: class { constructor(v) { this.value = v } },
    commands: { registerCommand: (n, f) => { cmds[n] = f; return { dispose() {} } }, executeCommand: (...a) => { log.executed.push(a) } },
    ViewColumn: { Beside: 2 },
    ProgressLocation: { Notification: 15 },
    extensions: { get all() { return log.extensions } },
    Uri: { file: p => ({ fsPath: p }), parse: v => ({ value: v }) },
  }
  const orig = Module._load
  const fakeCp = {
    execFile: (file, args, _opts, cb) => {
      log.calls.push({ file, args })
      const r = log.plan(args) || {}
      setImmediate(() => cb(r.err || null, r.stdout || '', r.stderr || ''))
    },
  }
  Module._load = function (r, ...a) { return r === 'vscode' ? vs : r === 'child_process' ? fakeCp : orig.call(this, r, ...a) }
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

test('"no data" explains itself: folder missing, folder empty, files unreadable', () => {
  const missing = setup()
  fs.rmSync(missing.sessDir, { recursive: true })
  missing.start()
  assert.match(missing.tooltip(), /Folder not found/)
  assert.match(missing.tooltip(), /plugin install usage-monitor/)
  assert.ok(missing.tooltip().includes(missing.sessDir), 'shows where it looks')
  const empty = setup().start()
  assert.match(empty.tooltip(), /no session files yet/)
  const bad = setup()
  bad.write('x.json', '{"torn":')
  bad.start()
  assert.match(bad.tooltip(), /could not be read/)
  const ru = setup({ lang: 'ru' })
  fs.rmSync(ru.sessDir, { recursive: true })
  ru.start()
  assert.match(ru.tooltip(), /Папки с данными нет/)
})

test('"no data" shows the note the plugin left, or says the plugin is silent', () => {
  const silent = setup()
  fs.rmSync(silent.sessDir, { recursive: true })
  silent.start()
  assert.match(silent.tooltip(), /left no note on this machine/)

  const loud = setup()
  fs.rmSync(loud.sessDir, { recursive: true })
  const pluginDir = path.join(loud.home, '.claude', 'plugins', 'cache', 'claude-usage-monitor', 'usage-monitor', '0.5.4')
  fs.mkdirSync(pluginDir, { recursive: true })
  fs.writeFileSync(path.join(pluginDir, 'diagnostics.txt'), 'error at 2026-10-11T10:00:00.000Z\ncould not write C:\\Users\\a\\.claude\\usage-monitor\\s.json\nEPERM: operation not permitted\n')
  loud.start()
  assert.match(loud.tooltip(), /Note from the plugin/)
  assert.match(loud.tooltip(), /EPERM: operation not permitted/)
  assert.doesNotMatch(loud.tooltip(), /left no note/)

  const other = setup() // a note from some other plugin must not be mistaken for ours
  fs.rmSync(other.sessDir, { recursive: true })
  const odd = path.join(other.home, '.claude', 'plugins', 'cache', 'someone-else', 'tool', '1.0')
  fs.mkdirSync(odd, { recursive: true })
  fs.writeFileSync(path.join(odd, 'diagnostics.txt'), 'not ours')
  other.start()
  assert.doesNotMatch(other.tooltip(), /not ours/)
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
  const week = data.scopes.all.d30
  assert.equal(week.models.length, 1)
  assert.equal(week.models[0].name, 'Opus 5.5')
  assert.equal(week.projects.length, 7)
  assert.equal(week.projects.at(-1).name, '…')
  t.stop()
})

const DAYMS = 86400_000
const dayStr = ms => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
async function exportAs(t, pick) {
  t.log.pick = pick
  t.log.saved = path.join(t.home, `out-${pick}.csv`)
  await t.cmds['claudeUsage.exportCsv']()
  return fs.readFileSync(t.log.saved, 'utf8')
}
// two days of data: yesterday has a model/project split, today only a bare total (an older file without detail)
function twoDays(t) {
  const y = hourNow() - 26 * H
  const detail = { [y]: { m: { 'claude-opus-5-5-20260101': 600, 'claude-haiku-5-5': 400 }, p: { web: 700, api: 300 } } }
  t.write('s.json', session({ buckets: { [y]: 1000, [hourNow()]: 250 }, detail }))
  return y
}

test('CSV by day and model: a readable table with a total row, BOM and CRLF', async () => {
  const t = setup({ config: { numberGrouping: 'none' } })
  const y = twoDays(t)
  t.start()
  const csv = await exportAs(t, 'model')
  assert.ok(csv.startsWith('\uFEFF'), 'BOM so Excel reads UTF-8')
  const rows = csv.slice(1).trim().split('\r\n').map(r => r.split(','))
  assert.deepEqual(rows[0], ['Date', 'Total', 'Opus 5.5', 'Haiku 5.5', 'Other'])
  assert.deepEqual(rows[1], [dayStr(y), '1000', '600', '400', '0'])
  assert.deepEqual(rows[2], [dayStr(Date.now()), '250', '0', '0', '250'], 'tokens without a model split land in Other')
  assert.deepEqual(rows[3], ['Total', '1250', '600', '400', '250'])
  assert.equal(rows.length, 4)
  t.stop()
})

test('CSV by day and project, and the raw rows format', async () => {
  const t = setup({ config: { numberGrouping: 'none' } })
  twoDays(t)
  t.start()
  const byProject = (await exportAs(t, 'project')).slice(1).trim().split('\r\n').map(r => r.split(','))
  assert.deepEqual(byProject[0], ['Date', 'Total', 'web', 'api', 'Other'])
  const raw = (await exportAs(t, 'long')).slice(1).trim().split('\r\n')
  assert.equal(raw[0], 'Date,Dimension,Name,Tokens')
  assert.ok(raw.includes(`${dayStr(hourNow() - 26 * H)},model,Opus 5.5,600`))
  assert.ok(raw.includes(`${dayStr(hourNow() - 26 * H)},total,,1000`))
  t.stop()
})

test('CSV in Russian: Cyrillic headers and ";" so Excel splits the columns', async () => {
  const t = setup({ lang: 'ru' })
  twoDays(t)
  t.start()
  const csv = await exportAs(t, 'model')
  const head = csv.slice(1).split('\r\n')[0]
  assert.equal(head, 'Дата;Всего;Opus 5.5;Haiku 5.5;Прочее')
  t.stop()
  const t2 = setup({ lang: 'ru', config: { csvDelimiter: ',' } })
  twoDays(t2)
  t2.start()
  assert.equal((await exportAs(t2, 'model')).slice(1).split('\r\n')[0], 'Дата,Всего,Opus 5.5,Haiku 5.5,Прочее')
  t2.stop()
})

test('CSV: more than eight models fold into Other, nothing is lost', async () => {
  const t = setup({ config: { numberGrouping: 'none' } })
  const buckets = {}
  const detail = {}
  for (let i = 0; i < 12; i++) { buckets[hourNow() - i * H] = 100 * (i + 1); detail[hourNow() - i * H] = { m: { [`claude-model-${i}-0`]: 100 * (i + 1) }, p: {} } }
  t.write('s.json', session({ buckets, detail }))
  t.start()
  const rows = (await exportAs(t, 'model')).slice(1).trim().split('\r\n').map(r => r.split(','))
  assert.equal(rows[0].length, 2 + 8 + 1)
  const total = rows.at(-1)
  assert.equal(Number(total[1]), 7800)
  assert.equal(total.slice(2).reduce((s, x) => s + Number(x), 0), 7800)
  t.stop()
})

test('CSV: names like a formula are neutralised, separators and quotes survive', async () => {
  const t = setup()
  const detail = { [hourNow()]: { m: { 'claude-opus-5-5': 10 }, p: { '=HYPERLINK("x")': 5, 'a,b': 3, '@cmd': 2 } } }
  t.write('s.json', session({ buckets: { [hourNow()]: 10 }, detail }))
  t.start()
  for (const pick of ['project', 'long']) {
    const csv = await exportAs(t, pick)
    assert.ok(csv.includes(`"'=HYPERLINK(""x"")"`), csv)
    assert.ok(csv.includes('"a,b"'))
    assert.ok(csv.includes("'@cmd"))
    assert.ok(!/(^|,)[=@]/m.test(csv.slice(1)), 'no cell may start with = or @')
  }
  t.stop()
})

test('CSV: cancelling either dialog, an unwritable path and no data are handled', async () => {
  const t = setup()
  t.write('s.json', session({ buckets: { [hourNow()]: 10 } }))
  t.start()
  t.log.pick = null
  await t.cmds['claudeUsage.exportCsv']() // cancelled at the picker
  t.log.pick = 'model'; t.log.saved = null
  await t.cmds['claudeUsage.exportCsv']() // cancelled at the save dialog
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
  assert.equal(t.log.posted.at(-1).data.scopes.all.today.projects[0].name, evil) // data travels as data, drawn with textContent
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
  assert.match(t.log.error[0], /использовано 95%, остаётся совсем немного/)
  assert.match(t.tooltip(), /5-часовой лимит/)
  t.stop()
})

test('digit grouping: spaces for Russian, commas for English, dots and none on request', () => {
  const g = (lang, style) => { const t = setup({ lang, config: style ? { numberGrouping: style } : {} }); t.start(); return t }
  const ru = g('ru'); ru.write('s.json', session({ buckets: { [hourNow()]: 13240843 } })); ru.refresh()
  assert.match(ru.tooltip(), /13\u00A0240\u00A0843/)
  const en = g('en'); en.write('s.json', session({ buckets: { [hourNow()]: 13240843 } })); en.refresh()
  assert.match(en.tooltip(), /13,240,843/)
  const dot = g('en', 'dot'); dot.write('s.json', session({ buckets: { [hourNow()]: 13240843 } })); dot.refresh()
  assert.match(dot.tooltip(), /13\.240\.843/)
  const none = g('ru', 'none'); none.write('s.json', session({ buckets: { [hourNow()]: 13240843 } })); none.refresh()
  assert.match(none.tooltip(), /13240843/)
})

test('digit grouping edge values', () => {
  const t = setup({ lang: 'en' })
  t.start()
  const run = n => { t.write('s.json', session({ buckets: { [hourNow()]: n } })); t.refresh(); return t.tooltip() }
  assert.match(run(999), /Today: \*\*999\*\*/)
  assert.match(run(1000), /Today: \*\*1,000\*\*/)
  assert.match(run(1234567890123), /1,234,567,890,123/)
  assert.match(run(0), /Today: \*\*0\*\*/)
})

test('every CSV mode groups digits by the same rule, and "none" gives plain numbers', async () => {
  const t = setup({ lang: 'ru' })
  t.write('s.json', session({ buckets: { [hourNow()]: 13240843 }, detail: { [hourNow()]: { m: { 'claude-sonnet-5-5': 13240843 }, p: { web: 13240843 } } } }))
  t.start()
  for (const pick of ['model', 'project', 'long']) {
    const csv = await exportAs(t, pick)
    assert.ok(csv.includes('13\u00A0240\u00A0843'), `${pick}: ${csv}`)
    assert.ok(!/\d{7,}/.test(csv.replace(/\d{4}-\d{2}-\d{2}/g, '')), `${pick}: no ungrouped long number`)
  }
  const en = setup({ lang: 'en' })
  en.write('s.json', session({ buckets: { [hourNow()]: 13240843 }, detail: { [hourNow()]: { m: { m: 13240843 }, p: { web: 13240843 } } } }))
  en.start()
  assert.ok((await exportAs(en, 'model')).includes('"13,240,843"'), 'a comma group inside a comma-separated file is quoted')
  assert.ok((await exportAs(en, 'long')).includes('"13,240,843"'))
  const plain = setup({ lang: 'ru', config: { numberGrouping: 'none' } })
  plain.write('s.json', session({ buckets: { [hourNow()]: 13240843 } }))
  plain.start()
  for (const pick of ['model', 'long']) assert.ok((await exportAs(plain, pick)).includes('13240843'))
})

// ---- installing the plugin from the editor ----
const exeName = process.platform === 'win32' ? 'claude.exe' : 'claude'
function fakeClaude(home, editorDir, version) {
  const dir = path.join(home, editorDir, 'extensions', `anthropic.claude-code-${version}`, 'resources', 'native-binary')
  fs.mkdirSync(dir, { recursive: true })
  const f = path.join(dir, exeName)
  fs.writeFileSync(f, 'x')
  return f
}

test('it finds Claude Code by itself: any editor folder, newest version first, never a stranger', () => {
  const t = setup()
  const old = fakeClaude(t.home, '.antigravity-ide', '2.1.290-win32-x64')
  const newer = fakeClaude(t.home, '.vscode', '2.1.296-win32-x64')
  fs.utimesSync(old, new Date(2026, 0, 1), new Date(2026, 0, 1))
  fs.mkdirSync(path.join(t.home, '.config', 'extensions', 'anthropic.claude-code-9.9.9', 'resources', 'native-binary'), { recursive: true })
  fs.writeFileSync(path.join(t.home, '.config', 'extensions', 'anthropic.claude-code-9.9.9', 'resources', 'native-binary', exeName), 'x') // not an editor folder
  fakeClaude(t.home, '.cursor', '1.0.0')
  const found = t.ext.__test.findClaudeBinaries()
  assert.ok(found.includes(old) && found.includes(newer))
  assert.ok(!found.some(f => f.includes(`${path.sep}.config${path.sep}`)))
  assert.ok(found.indexOf(newer) < found.indexOf(old), 'newest first')
  // and the extension the editor itself has loaded counts too
  const loaded = path.join(t.home, 'loaded-ext')
  fs.mkdirSync(path.join(loaded, 'resources', 'native-binary'), { recursive: true })
  fs.writeFileSync(path.join(loaded, 'resources', 'native-binary', exeName), 'x')
  t.log.extensions = [{ id: 'anthropic.claude-code', extensionPath: loaded }, { id: 'ms-python.python', extensionPath: path.join(t.home, 'nope') }]
  assert.ok(t.ext.__test.findClaudeBinaries().includes(path.join(loaded, 'resources', 'native-binary', exeName)))
})

test('install: asks first, then runs exactly the install commands, with no shell', async () => {
  const t = setup()
  const bin = fakeClaude(t.home, '.antigravity-ide', '2.1.296')
  t.start()
  assert.equal(t.log.calls.length, 0, 'nothing runs on its own')
  t.log.confirm = 'Install'
  await t.cmds['claudeUsage.setup']()
  assert.deepEqual(t.log.calls.map(c => c.args), [
    ['plugin', 'marketplace', 'add', 'AndreyKilanov/claude-usage-monitor'],
    ['plugin', 'install', 'usage-monitor@claude-usage-monitor', '--scope', 'user'],
    ['plugin', 'marketplace', 'update', 'claude-usage-monitor'], // refresh the version list, or "update" sees nothing new
    ['plugin', 'update', 'usage-monitor@claude-usage-monitor'],
  ])
  assert.ok(t.log.calls.every(c => c.file === bin))
  assert.match(t.log.warn.at(-1), /AndreyKilanov\/claude-usage-monitor/, 'the prompt names what will run and from where')
  assert.match(t.log.info.at(-1), /NEW Claude session/)
})

test('install: declining runs nothing; an already-added catalogue is fine; a real failure is reported', async () => {
  const t = setup()
  fakeClaude(t.home, '.vscode', '2.1.296')
  t.start()
  t.log.confirm = undefined // closed the dialog
  await t.cmds['claudeUsage.setup']()
  assert.equal(t.log.calls.length, 0)

  t.log.confirm = 'Install'
  t.log.plan = args => (args[2] === 'add' ? { err: new Error('exit 1'), stderr: 'Marketplace claude-usage-monitor already exists' } : {})
  await t.cmds['claudeUsage.setup']()
  assert.equal(t.log.calls.length, 4)
  assert.equal(t.log.info.length, 1)

  t.log.calls.length = 0
  t.log.plan = args => (args[1] === 'install' ? { err: new Error('exit 1'), stderr: 'EACCES: permission denied, mkdir' } : {})
  await t.cmds['claudeUsage.setup']()
  assert.deepEqual(t.log.calls.map(c => c.args[1]), ['marketplace', 'install'], 'no update after a failed install')
  assert.match(t.log.error.at(-1), /EACCES/)
})

test('install: no Claude Code found offers to pick one by hand', async () => {
  const t = setup().start()
  await t.cmds['claudeUsage.setup']() // nothing chosen
  assert.match(t.log.error.at(-1), /Could not find Claude Code/)
  assert.equal(t.log.calls.length, 0)

  const manual = path.join(t.home, 'somewhere', exeName)
  fs.mkdirSync(path.dirname(manual), { recursive: true })
  fs.writeFileSync(manual, 'x')
  t.log.errorChoice = 'Choose claude manually…'
  t.log.openPick = manual
  t.log.confirm = 'Install'
  await t.cmds['claudeUsage.setup']()
  assert.ok(t.log.calls.every(c => c.file === manual))
  assert.equal(t.log.calls.length, 4)
})

test('the status item installs the plugin when it is missing, otherwise opens the menu (or the panel, by setting)', () => {
  const missing = setup()
  fs.rmSync(missing.sessDir, { recursive: true })
  missing.start()
  assert.equal(missing.items[0].command, 'claudeUsage.setup')
  assert.match(missing.tooltip(), /Click to install the plugin/)
  const ok = setup()
  ok.write('s.json', session())
  ok.start()
  assert.equal(ok.items[0].command, 'claudeUsage.menu')
  const panelFirst = setup({ config: { clickAction: 'panel' } })
  panelFirst.write('s.json', session())
  panelFirst.start()
  assert.equal(panelFirst.items[0].command, 'claudeUsage.open')
})

// ---- the status bar menu ----
function menuSetup(lang = 'en') {
  const t = setup({ lang, config: { numberGrouping: 'none' } })
  t.write('s.json', session({ fiveHour: 38, sevenDay: 5, buckets: { [hourNow()]: 1234 } }))
  return t.start()
}
const withPick = (t, id) => { t.log.pick = id; const orig = t.cmds['claudeUsage.menu']; return orig() }

test('menu: every entry does what it says', async () => {
  const t = menuSetup()
  await withPick(t, 'copy')
  assert.equal(t.log.clip, '5h 38% · wk 5% · today 1234 tokens')
  assert.match(t.log.info.at(-1), /Copied/)

  await withPick(t, 'open')
  assert.equal(t.log.panels.length, 1)

  await withPick(t, 'settings')
  assert.deepEqual(t.log.executed.at(-1), ['workbench.action.openSettings', '@ext:andreykilanov.claude-usage-monitor'])

  await withPick(t, 'help')
  assert.equal(t.log.opened, 'https://github.com/AndreyKilanov/claude-usage-monitor#readme')

  const before = t.items[0].text
  await withPick(t, 'refresh')
  assert.equal(t.items[0].text, before)

  t.log.confirm = undefined
  await withPick(t, 'setup') // asks first; nothing is run when it is not confirmed
  assert.equal(t.log.calls.length, 0)

  await withPick(t, null) // dismissed: nothing happens
  assert.equal(t.log.clip, '5h 38% · wk 5% · today 1234 tokens')
})

test('menu: exactly the seven entries, the summary as its title, and CSV leads into the export flow', async () => {
  const t = menuSetup()
  t.log.pick = 'csv'
  t.log.saved = path.join(t.home, 'menu.csv')
  await t.cmds['claudeUsage.menu']()
  assert.deepEqual(t.log.offered[0].ids, ['open', 'copy', 'csv', 'refresh', 'settings', 'setup', 'help'])
  assert.equal(t.log.offered[0].placeHolder, '5h 38% · wk 5% · today 1234 tokens')
  // the menu hands over to the export's own picker (by day and model / project / raw rows)
  assert.deepEqual(t.log.offered[1].ids, ['model', 'project', 'long'])
})

test('menu in Russian is localized and the copied summary is Russian too', async () => {
  const t = menuSetup('ru')
  await withPick(t, 'copy')
  assert.equal(t.log.clip, '5ч 38% · нед 5% · сегодня 1234 токенов')
  assert.match(t.log.info.at(-1), /Скопировано/)
})

// ---- token kinds ----
test('token kinds: shares add up, cache reads dominate, old data without a split is shown as such', () => {
  const t = setup()
  const h = hourNow()
  t.write('new.json', session({ buckets: { [h]: 1000 }, detail: { [h]: { m: { m: 1000 }, p: { web: 1000 }, k: { i: 50, o: 150, w: 100, r: 700 } } } }))
  t.write('old.json', session({ buckets: { [h - H]: 400 }, detail: { [h - H]: { m: { m: 400 }, p: { web: 400 } } } })) // before kinds existed
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

test('CSV raw rows carry the kind split with readable names, in the interface language', async () => {
  const t = setup({ config: { numberGrouping: 'none' } })
  const h = hourNow()
  t.write('s.json', session({ buckets: { [h]: 1000 }, detail: { [h]: { m: { m: 1000 }, p: { web: 1000 }, k: { i: 50, o: 150, w: 100, r: 700 } } } }))
  t.start()
  const csv = await exportAs(t, 'long')
  assert.ok(csv.includes(',type,Cache reads,700'), csv)
  assert.ok(csv.includes(',type,Output,150'))
  const ru = setup({ lang: 'ru', config: { numberGrouping: 'none' } })
  ru.write('s.json', session({ buckets: { [h]: 1000 }, detail: { [h]: { m: { m: 1000 }, p: { web: 1000 }, k: { i: 50, o: 150, w: 100, r: 700 } } } }))
  ru.start()
  assert.ok((await exportAs(ru, 'long')).includes(';тип;Чтение кэша;700'))
})

test('both languages have the same keys, no empty strings, and Russian text is really Russian', () => {
  const { STR } = setup().ext.__test
  assert.deepEqual(Object.keys(STR.ru).sort(), Object.keys(STR.en).sort(), 'every string exists in both languages')
  for (const [lang, dict] of Object.entries(STR)) {
    for (const [k, v] of Object.entries(dict)) {
      if (typeof v === 'string') assert.ok(v.trim().length > 0, `${lang}.${k} is empty`)
      if (Array.isArray(v)) assert.equal(v.length, 7, `${lang}.${k}`)
    }
  }
  // a few words that read badly in Russian before; they must not come back
  const ruText = JSON.stringify(STR.ru)
  for (const bad of ['Окно 5 часов', 'Новый ввод', 'Записка', 'ориентируйтесь', 'Ищу данные', 'Срез']) assert.ok(!ruText.includes(bad), bad)
  for (const k of ['kindsNote', 'note', 'setupAsk', 'noFolder', 'pluginSilent']) assert.match(STR.ru[k], /[а-яё]{4}/i, k)
  // the names read well inside alerts
  assert.equal(STR.ru.warnMsg(STR.ru.win5, 85), 'Claude: 5-часовой лимит — использовано 85%')
  assert.equal(STR.ru.resetMsg(STR.ru.winWeek), 'Claude: Недельный лимит сброшен — можно продолжать работу')
})

// ---- an outdated plugin on this machine ----
const outdated = t => { t.cmds['claudeUsage.open'](); t.refresh(); return t.log.posted.at(-1).data.pluginOutdated }

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

  // the plugin was updated: an old file is followed by a newer one that has the split
  const updated = setup()
  updated.write('old.json', session({ updatedAt: Date.now() - 5000, buckets: { [h]: 10 }, detail: { [h]: noK } }))
  updated.write('new.json', session({ updatedAt: Date.now(), buckets: { [h]: 10 }, detail: { [h]: withK } }))
  updated.start()
  assert.equal(outdated(updated), false)

  // ...and the other way round: a newer file without it means the plugin here is still old
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
  emptyNew.write('just-started.json', session({ updatedAt: Date.now(), buckets: {}, detail: {} })) // no reply yet
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

// ---- "only this project" and versions ----
const folder = p => ({ uri: { fsPath: p } })
const payloadOf = t => { t.cmds['claudeUsage.open'](); t.refresh(); return t.log.posted.at(-1).data }
const day = (project, tokens, extra = {}) => {
  const h = hourNow()
  return session({
    project,
    buckets: { [h]: tokens },
    detail: { [h]: { m: { [`model-of-${project}`]: tokens }, p: { [project]: tokens }, k: { i: 0, o: 0, w: 0, r: tokens } } },
    ...extra,
  })
}

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
  const { fileProject, folderName } = setup().ext.__test
  const h = hourNow()
  assert.equal(fileProject({ project: 'x', detail: { [h]: { p: { y: 9 } } } }), 'x', 'what the plugin wrote wins')
  assert.equal(fileProject({ detail: { [h]: { p: { a: 5, b: 50 } }, [h - H]: { p: { a: 70 } } } }), 'a')
  assert.equal(fileProject({}), null)
  assert.equal(fileProject({ detail: 'broken' }), null)
  assert.equal(folderName('C:\\Users\\Andy\\Web-App\\'), 'Web-App')
  assert.equal(folderName('/'), null)

  const t = setup()
  t.log.folders = [folder('C:\\Users\\Andy\\WEB-APP')]
  const old = session({ buckets: { [h]: 300 }, detail: { [h]: { m: { m: 300 }, p: { 'web-app': 300 } } } }) // no project field
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
  const { cmpVer } = setup().ext.__test
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

  // nothing of this computer's own on disk (only another device's data): there is nothing local to be old
  const sync = fs.mkdtempSync(path.join(os.tmpdir(), 'cum-sync-'))
  const onlyRemote = setup({ config: { syncFolder: sync } })
  onlyRemote.write('theirs.json', day('p', 10), path.join(sync, 'other-pc'))
  onlyRemote.start()
  const rv = payloadOf(onlyRemote).versions
  assert.equal(rv.old, false)
  assert.equal(rv.plugin, null)
})

test('versions: shown in the panel data and the tooltip, in both languages, and the extension reports its own', () => {
  const ownVersion = require('../package.json').version
  const t = setup()
  t.write('a.json', day('p', 10, { v: '0.6.3' }))
  t.start()
  const v = payloadOf(t).versions
  assert.equal(v.ext, ownVersion)
  assert.equal(v.plugin, '0.6.3')
  const tip = t.tooltip()
  const link = `[_v${ownVersion}_](https://github.com/AndreyKilanov/claude-usage-monitor "Extension ${ownVersion} · plugin 0.6.3")`
  const headerRow = tip.split('\n').find(l => l.startsWith('| **Claude'))
  assert.ok(headerRow && headerRow.endsWith(`${link} |`), 'the version link closes the header row, top right: ' + headerRow)
  assert.ok(tip.indexOf(link) < tip.indexOf('5-hour window'), 'above the limit bars, not under them')
  assert.ok(!tip.includes('### '), 'the title now lives in the same table row')
  assert.ok(!/plugin 0\.6\.3_?\s*$/.test(tip.trimEnd()), 'no version line at the bottom')

  const ru = setup({ lang: 'ru' })
  ru.write('a.json', day('p', 10)) // no version: an old plugin
  ru.start()
  assert.ok(ru.tooltip().includes(`[_v${ownVersion}_](https://github.com/AndreyKilanov/claude-usage-monitor "Расширение ${ownVersion} · плагин старый (до 0.6.3)")`), ru.tooltip())
  assert.match(ru.tooltip().trimEnd().split('\n').pop(), /^⚠ Плагин на этом компьютере устарел/, 'an old plugin is flagged at the end, once')
  assert.match(payloadOf(ru).versions.oldText, /Плагин на этом компьютере устарел/)
})

test('versions: the old-plugin banner replaces the token-split warning instead of doubling it; a remote old plugin is not this computer\'s problem', () => {
  const t = setup()
  t.write('a.json', session({ buckets: { [hourNow()]: 10 }, detail: { [hourNow()]: { m: { m: 10 }, p: { p: 10 } } } })) // no v, no split
  t.start()
  const data = payloadOf(t)
  assert.equal(data.versions.old, true)
  assert.equal(data.pluginOutdated, true)
  assert.match(t.log.panels[0].html, /showKindsWarn/, 'the page hides the second warning when the banner is up')

  const sync = fs.mkdtempSync(path.join(os.tmpdir(), 'cum-sync-'))
  const remote = setup({ config: { syncFolder: sync } })
  remote.write('mine.json', day('p', 10, { v: '0.6.3' }))
  remote.write('theirs.json', day('p', 10), path.join(sync, 'other-pc')) // old plugin over there
  remote.start()
  assert.equal(payloadOf(remote).versions.old, false)
})

test('the version sits small in the top right of the panel: plain "v<number>", both versions on hover, no network involved', () => {
  const t = setup()
  t.write('a.json', day('p', 10, { v: '0.6.3' }))
  t.start()
  const html = t.log.panels.length ? t.log.panels[0].html : (t.cmds['claudeUsage.open'](), t.log.panels[0].html)
  assert.match(html, /<a class="ver" id="ver" href="#"><\/a>/)
  assert.match(html, /\.ver \{ position: absolute; top: 10px; right: 24px; font-size: 10px/)
  assert.match(html, /\$\('ver'\)\.textContent = 'v' \+ v\.ext/)
  assert.ok(!html.includes('id="versions"'), 'the old footer line is gone')
  assert.ok(!/https?:\/\//.test(html.replace(/<\/?\w[^>]*>/g, '')), 'the page itself makes no requests')
  // the extension never loads a network module
  const src = fs.readFileSync(path.join(__dirname, '..', 'extension.js'), 'utf8')
  assert.ok(!/require\(['"](https?|net|dgram|tls|http2)['"]\)/.test(src), 'no network modules anywhere in the extension')
  assert.ok(!/\bfetch\(|XMLHttpRequest|WebSocket/.test(src.replace(/\/\/.*$/gm, '')), 'no fetch-style calls')
})

test('the version is a link to the repository: one fixed address, whatever the page sends', () => {
  const t = setup()
  t.write('a.json', day('p', 10, { v: '0.6.3' }))
  t.start()
  t.cmds['claudeUsage.open']()
  t.refresh()
  assert.equal(typeof t.log.onMessage, 'function', 'the panel listens to its page')
  t.log.onMessage({ type: 'repo' })
  assert.equal(t.log.opened, 'https://github.com/AndreyKilanov/claude-usage-monitor')

  t.log.opened = null
  t.log.onMessage({ type: 'repo', url: 'https://evil.example/phish' })
  assert.equal(t.log.opened, 'https://github.com/AndreyKilanov/claude-usage-monitor', 'an address in the message is never used')

  t.log.opened = null
  t.log.onMessage({ type: 'something-else', url: 'https://evil.example' })
  t.log.onMessage(null)
  t.log.onMessage('repo')
  assert.equal(t.log.opened, null, 'other or malformed messages do nothing')

  const html = t.log.panels[0].html
  assert.match(html, /\$\('ver'\)\.onclick = e => \{ e\.preventDefault\(\); vscode\.postMessage\(\{ type: 'repo' \}\) \}/)
  assert.ok(!html.includes('github.com'), 'the page itself holds no address to navigate to')
  assert.match(html, /\.ver:hover \{ text-decoration: underline/)
})

test('repository address: from package.json, checked, and never anything but github.com', () => {
  const { repoUrl } = setup().ext.__test
  assert.equal(repoUrl(), 'https://github.com/AndreyKilanov/claude-usage-monitor')
  assert.equal(require('../package.json').repository.url, 'https://github.com/AndreyKilanov/claude-usage-monitor.git')
})

test('the version label is in the Russian panel too, with a Russian hint', () => {
  const t = setup({ lang: 'ru' })
  t.write('a.json', day('p', 10, { v: '0.6.3' }))
  t.start()
  const data = payloadOf(t)
  assert.equal(data.L.openRepo, 'Страница проекта на GitHub')
  const en = setup()
  en.write('a.json', day('p', 10, { v: '0.6.3' }))
  en.start()
  assert.equal(payloadOf(en).L.openRepo, 'Project page on GitHub')
})

test('tooltip: the header row is a real table row that lines up with the limit rows, in both languages', () => {
  for (const lang of ['en', 'ru']) {
    const t = setup({ lang })
    t.write('a.json', day('p', 10, { v: '0.6.3', limits: [{ kind: 'five_hour', percentUsed: 38, resetsAt: iso(2 * H) }, { kind: 'seven_day', percentUsed: 5, resetsAt: iso(80 * H) }] }))
    t.start()
    const table = t.tooltip().split('\n').filter(l => l.startsWith('|'))
    assert.equal(table.length, 4, 'header, alignment, two limit rows')
    const cols = row => row.split(/(?<!\\)\|/).length - 2 // cells in a row, ignoring the outer pipes
    assert.deepEqual(table.map(cols), [4, 4, 4, 4], `${lang}: every row has the same four cells`)
    assert.match(table[1], /^\|:--\|:--\|--:\|--:\|$/)
  }
})

test('tooltip: an up-to-date plugin leaves no warning line', () => {
  const t = setup()
  t.write('a.json', day('p', 10, { v: '0.6.3' }))
  t.start()
  assert.ok(!t.tooltip().includes('⚠'))
})
