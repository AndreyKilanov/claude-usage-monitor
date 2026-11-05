const test = require('node:test')
const assert = require('node:assert/strict')
const { setup, payloadOf } = require('./helpers/harness')
const { HOUR: H, iso, hourNow, session, day } = require('./helpers/fixtures')

const DAY = 24 * H

const at = (start, tokens, extra = {}) => session({ buckets: { [start]: tokens }, detail: { [start]: { m: { 'claude-opus-5-5': tokens }, p: { web: tokens }, k: { i: 0, o: 0, w: 0, r: tokens } } }, ...extra })

test('U1: each period counts the sessions that worked in it, not today\'s', () => {
  const t = setup()
  t.write('today.json', at(hourNow(), 10))
  t.write('earlier.json', at(hourNow() - 3 * DAY, 10))
  t.start()
  const all = payloadOf(t).scopes.all
  assert.equal(all.today.sessions, 1)
  assert.equal(all.d7.sessions, 2)
  assert.equal(all.d30.sessions, 2)
  assert.equal(all.sessionsToday, 1)
  assert.match(t.log.panels[0].html, /data\.L\.sessions \+ ': ' \+ period\.sessions/)
})

// noon today: every test below gets the same time of day, whenever it runs
const noon = () => { const d = new Date(); d.setHours(12, 30, 0, 0); return d.getTime() }
const totalsAt = (t, now) => t.mod('data/totals').readTotals(t.mod('data/sessions').scan('m'), 'm', null, { now })

test('U2: "today" averages over the hours that had work, the other tabs per day', () => {
  const t = setup()
  const now = noon()
  const hour = Math.floor(now / H) * H
  t.write('a.json', session({ updatedAt: now, buckets: { [hour]: 100, [hour - H]: 300 } }))
  const today = totalsAt(t, now).periods.today
  assert.equal(today.bars.filter(bar => bar.total > 0).length, 2)
  t.start()
  const html = (t.cmds['claudeUsage.open'](), t.log.panels[0].html)
  assert.match(html, /period\.activeHours/)
  assert.match(html, /data\.L\.perHour/)
})

test('U3: the panel gets the age of the data, and the tooltip says when it is old', () => {
  const fresh = setup()
  fresh.write('a.json', session())
  fresh.start()
  const data = payloadOf(fresh)
  assert.ok(Math.abs(data.updatedAt - Date.now()) < 5000)
  assert.equal(data.time, undefined, 'no more "updated at" clock of the redraw')
  assert.doesNotMatch(fresh.tooltip(), /may have changed/)

  const old = setup()
  old.write('a.json', session({ updatedAt: Date.now() - 2 * H }))
  old.start()
  assert.match(old.tooltip(), /Data received 2 h 0 min ago — the limits may have changed since/)
})

test('U4: with no data the panel shows why and offers to install the plugin', () => {
  const t = setup()
  t.start()
  t.cmds['claudeUsage.open']()
  t.log.onMessage({ type: 'ready' })
  const data = t.log.posted.at(-1).data
  assert.equal(data.empty, true)
  assert.match(data.help.why, /no session files yet/)
  assert.ok(data.help.where.includes(t.sessDir))
  t.log.onMessage({ type: 'setup', command: 'workbench.action.terminal.new' })
  assert.deepEqual(t.log.executed.at(-1), ['claudeUsage.setup'], 'only the fixed command runs')
})

test('U4: data that appears later replaces the empty page', () => {
  const t = setup()
  t.start()
  t.cmds['claudeUsage.open']()
  t.refresh()
  assert.equal(t.log.posted.at(-1).data.empty, true)
  t.write('a.json', session())
  t.refresh()
  assert.equal(t.log.posted.at(-1).data.empty, undefined)
  assert.ok(t.log.posted.at(-1).data.windows.length > 0)
})

test('U5 / D6: the page gets moments, not finished countdowns, and the same numbers are not sent twice', () => {
  const t = setup()
  t.write('a.json', session({ limits: [{ kind: 'five_hour', percentUsed: 40, resetsAt: iso(2 * H) }] }))
  t.start()
  t.cmds['claudeUsage.open']()
  t.refresh()
  const sent = t.log.posted.length
  const window = t.log.posted.at(-1).data.windows[0]
  assert.ok(Math.abs(window.resetAt - (Date.now() + 2 * H)) < 5000)
  assert.equal(window.reset, undefined)
  t.refresh()
  t.refresh()
  assert.equal(t.log.posted.length, sent, 'unchanged numbers are not re-sent')
  t.log.onMessage({ type: 'ready' })
  assert.equal(t.log.posted.length, sent + 1, 'a page that (re)loads always gets them')
  assert.match(t.log.panels[0].html, /setInterval\(\(\) => \{ if \(data && !data\.empty\) drawLive\(\) \}, LIVE_MS\)/)
})

test('U7: every bar carries its own breakdown for the click-through', () => {
  const t = setup()
  t.write('a.json', at(hourNow(), 700))
  t.write('b.json', at(hourNow() - 2 * DAY, 300, { project: 'api' }))
  t.start()
  const all = payloadOf(t).scopes.all
  const thisHour = all.today.bars[new Date().getHours()]
  assert.equal(thisHour.v, 700)
  assert.deepEqual(thisHour.models, [{ name: 'Opus 5.5', v: 700 }])
  assert.equal(thisHour.kinds.cacheRead, 700)
  const twoDaysAgo = all.d7.bars.at(-3)
  assert.equal(twoDaysAgo.v, 300)
  assert.deepEqual(twoDaysAgo.projects, [{ name: 'web', v: 300 }])
  assert.equal(all.d7.bars.at(-1).v, 700)
})

test('U8: today is compared with yesterday up to the same time, 7 days with the 7 before; 30 days with nothing', () => {
  const t = setup()
  const now = noon()
  const hour = Math.floor(now / H) * H
  t.write('now.json', at(hour, 200, { updatedAt: now }))
  t.write('yesterday.json', at(hour - DAY, 100, { updatedAt: now }))
  t.write('yesterday-later.json', at(hour - DAY + 2 * H, 999, { updatedAt: now }))
  t.write('last-week.json', at(hour - 9 * DAY, 400, { updatedAt: now }))
  const periods = totalsAt(t, now).periods
  assert.equal(periods.today.prev.total, 100, 'later hours of yesterday are not part of the comparison')
  assert.equal(periods.d7.prev.total, 400)
  assert.equal(periods.d30.prev, null)
  t.start()
  assert.equal(payloadOf(t).scopes.all.d30.prev, null)
})

test('load: with the panel closed, no per-bar split and no project totals are worked out', () => {
  const t = setup()
  t.log.folders = [{ uri: { fsPath: '/work/web' } }]
  t.write('a.json', at(hourNow(), 700))
  t.start()
  const { readTotals } = t.mod('data/totals')
  const { scan } = t.mod('data/sessions')
  const lean = readTotals(scan('m'), 'm', null, { detailed: false })
  assert.equal(lean.periods.today.total, 700, 'the period sums are still there for the status bar')
  assert.ok(lean.periods.today.bars.every(bar => bar.total === 0), 'bars are left empty')
  t.cmds['claudeUsage.open']()
  t.log.onMessage({ type: 'ready' })
  const data = t.log.posted.at(-1).data
  assert.equal(data.scopes.project.today.total, 700, 'opening the panel works the project out at once')
  assert.equal(data.scopes.all.today.bars[new Date().getHours()].v, 700)
})

test('U9: the panel gives the clock time of resets and the forecast; the tooltip stays short without it', () => {
  const t = setup()
  t.write('a.json', session({ limits: [{ kind: 'five_hour', percentUsed: 40, resetsAt: iso(2 * H) }] }))
  t.start()
  const row = t.tooltip().split('\n').find(line => line.startsWith('| **5-hour'))
  assert.match(row, /\| resets in \| 2 h 0 min \|$/)
  t.cmds['claudeUsage.open']()
  const html = t.log.panels[0].html
  assert.match(html, /fmtMs\(ms - Date\.now\(\)\) \+ ' · ' \+ data\.L\.at \+ ' ' \+ clockAt\(ms\)/)
  assert.match(html, /' \(≈ ' \+ clockAt\(data\.etaAt\) \+ '\)'/)
})

test('the tooltip stays narrow: no line is much longer than the limit table', () => {
  for (const lang of ['en', 'ru']) {
    const t = setup({ lang, config: { numberGrouping: 'none' } })
    const hour = hourNow()
    t.write('a.json', session({ v: '0.7.0', tokens: 30930000, usd: 12.26, updatedAt: Date.now() - 3 * H, buckets: { [hour]: 220685771 }, detail: { [hour]: { m: {}, p: {}, c: 9.5 } }, limits: [{ kind: 'five_hour', percentUsed: 40, resetsAt: iso(2 * H) }, { kind: 'seven_day', percentUsed: 68, resetsAt: iso(80 * H) }] }))
    t.start()
    const text = t.tooltip().replace(/!\[[^\]]*\]\([^)]*\)/g, '##########').replace(/\[_(v[^_]+)_\]\([^)]*\)/g, '$1').replace(/\*\*|\$\([\w-]+\) /g, '')
    const longest = Math.max(...text.split('\n').map(line => line.length))
    assert.ok(longest <= 75, `${lang}: longest line is ${longest} characters:\n${text}`)
  }
})

test('U11: the weekly reset timer in the status bar is a separate setting', () => {
  const off = setup()
  off.write('a.json', session())
  off.start()
  assert.doesNotMatch(off.text(), /wk 10% ⏱/)
  const on = setup({ config: { showWeekResetTimer: true } })
  on.write('a.json', session())
  on.start()
  assert.match(on.text(), /wk 10% ⏱3 d 8 h/)
})

test('the metric switch, the bar click-through and the empty page live in the page script, still without innerHTML for data', () => {
  const t = setup()
  t.write('a.json', day('p', 10))
  t.start()
  t.cmds['claudeUsage.open']()
  const html = t.log.panels[0].html
  for (const id of ['metric', 'selbar', 'selclear', 'cmax', 'pcmp', 'costnote', 'empty', 'esetup', 'stale', 'main']) assert.ok(html.includes(`id="${id}"`), id)
  assert.match(html, /vscode\.postMessage\(\{ type: 'setup' \}\)/)
  assert.match(html, /column\.onclick = \(\) => pick\(bar\.start\)/, 'a picked bar is remembered by its time, not its position')
  assert.match(html, /data\.L\.resetting/)
  assert.equal((html.match(/innerHTML/g) || []).length, 1)
})

test('tooltip bars are small inline SVG images in the warning colours, with the percentage as a fallback', () => {
  const { bar } = setup().mod('util/format')
  const decode = image => Buffer.from(image.match(/base64,([^)]+)\)/)[1], 'base64').toString()
  assert.match(bar(41), /^!\[41%\]\(data:image\/svg\+xml;base64,[A-Za-z0-9+/=]+\)$/)
  assert.match(decode(bar(41)), /fill="#3fb950"/)
  assert.match(decode(bar(85, 'warn')), /fill="#d29922"/)
  assert.match(decode(bar(95, 'crit')), /fill="#f85149"/)
  assert.equal((decode(bar(0)).match(/<rect/g) || []).length, 1, 'an empty bar is only the track')
  assert.match(bar(250), /^!\[100%\]/, 'clamped')
  assert.match(bar('x'), /^!\[0%\]/, 'garbage is zero, never NaN')

  const t = setup({ config: { warnAt: 80, critAt: 90 } })
  t.write('a.json', session({ limits: [{ kind: 'five_hour', percentUsed: 92, resetsAt: iso(2 * H) }] }))
  t.start()
  const row = t.tooltip().split('\n').find(line => line.startsWith('| **5-hour'))
  assert.match(decode(row), /fill="#f85149"/, 'the 5-hour bar turns red past the critical mark')
  assert.ok(!/[▰▱]/.test(t.tooltip()), 'no font-dependent glyph bars any more')
})

test('gauges: a plain 270° arc with the percentage, no pace mark on it', () => {
  const t = setup()
  t.write('a.json', session({ limits: [{ kind: 'five_hour', percentUsed: 40, resetsAt: iso(2 * H) }] }))
  t.start()
  assert.equal(payloadOf(t).windows[0].span, undefined)
  const html = t.log.panels[0].html
  assert.match(html, /function gaugeSvg\(percent, tone\)/)
  assert.ok(!/notch/.test(html), 'the mark is gone from the script and the styles')
  assert.equal((html.match(/innerHTML/g) || []).length, 1, 'the gauge is still the only innerHTML, built from numbers alone')
})

test('the switches fit one line in Russian: short labels, a long project name is cut with its full name on hover', () => {
  const ru = setup({ lang: 'ru' })
  const { dictionaries } = ru.mod('i18n')
  for (const dict of Object.values(dictionaries)) {
    assert.ok(dict.scopeAll.length <= 4, dict.scopeAll)
    assert.equal(dict.metricCost, '$')
  }
  ru.start()
  ru.cmds['claudeUsage.open']()
  const html = ru.log.panels[0].html
  assert.match(html, /\.tab \{[^}]*max-width: 170px; overflow: hidden; text-overflow: ellipsis;/)
  assert.match(html, /data\.projectName \+ ' — ' \+ data\.L\.scopeHint/)
})
