const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const { setup, payloadOf } = require('./helpers/harness')
const { HOUR: H, hourNow, session, dayString } = require('./helpers/fixtures')

const costed = (project, tokens, usd, overrides = {}) => {
  const hour = hourNow()
  return session({
    v: '0.7.0',
    project,
    usd,
    buckets: { [hour]: tokens },
    detail: { [hour]: { m: { 'claude-opus-5-5': tokens }, p: { [project]: tokens }, k: { i: 0, o: 0, w: 0, r: tokens }, c: usd } },
    ...overrides,
  })
}

test('cost: hourly cost adds up per period and per project, and is flagged as API prices in the tooltip', () => {
  const t = setup()
  t.write('a.json', costed('web', 1000, 1.5))
  t.write('b.json', costed('api', 500, 0.25))
  t.start()
  const data = payloadOf(t)
  const today = data.scopes.all.today
  assert.equal(today.cost, 1.75)
  assert.equal(data.scopes.all.d7.cost, 1.75)
  assert.equal(data.scopes.all.d30.cost, 1.75)
  assert.deepEqual(today.costProjects, [{ name: 'web', v: 1.5 }, { name: 'api', v: 0.25 }])
  assert.equal(today.uncosted, 0)
  assert.equal(data.costSeen, true)
  assert.match(t.tooltip(), /\nCost today: ≈ \$1\.75 · at API prices\n/, 'a line of its own, so the tooltip stays narrow')
})

test('cost: an hour with cost but no tokens still counts, and goes to the session\'s project', () => {
  const t = setup()
  const hour = hourNow()
  t.write('a.json', session({ v: '0.7.0', project: 'web', buckets: {}, detail: { [hour]: { m: {}, p: {}, c: 0.4 } } }))
  t.start()
  const today = payloadOf(t).scopes.all.today
  assert.equal(today.cost, 0.4)
  assert.equal(today.total, 0)
  assert.deepEqual(today.costProjects, [{ name: 'web', v: 0.4 }])
})

test('cost: an hour shared by two projects splits its cost by their tokens', () => {
  const t = setup()
  const hour = hourNow()
  t.write('a.json', session({ v: '0.7.0', project: 'web', buckets: { [hour]: 400 }, detail: { [hour]: { m: { m: 400 }, p: { web: 300, api: 100 }, c: 2 } } }))
  t.start()
  assert.deepEqual(payloadOf(t).scopes.all.today.costProjects, [{ name: 'web', v: 1.5 }, { name: 'api', v: 0.5 }])
})

test('cost: tokens from a plugin older than 0.7.0 are marked as not costed; with no cost-aware data there is no cost at all', () => {
  const t = setup()
  t.write('new.json', costed('web', 1000, 1))
  t.write('old.json', session({ v: '0.6.7', buckets: { [hourNow()]: 300 }, detail: { [hourNow()]: { m: { m: 300 }, p: { web: 300 } } } }))
  t.start()
  const today = payloadOf(t).scopes.all.today
  assert.equal(today.uncosted, 300)
  assert.equal(today.cost, 1)
  assert.doesNotMatch(t.tooltip(), /Cost today/, 'a sum missing the older plugin\'s share is left to the panel, which explains it')

  const legacy = setup()
  legacy.write('old.json', session({ v: '0.6.7', buckets: { [hourNow()]: 300 } }))
  legacy.start()
  const data = payloadOf(legacy)
  assert.equal(data.costSeen, false)
  assert.equal(data.scopes.all.today.cost, 0)
  assert.doesNotMatch(legacy.tooltip(), /API prices/, 'no cost line without cost')
})

test('cost: broken cost values are ignored, never NaN', () => {
  const t = setup()
  const hour = hourNow()
  t.write('a.json', session({ v: '0.7.0', buckets: { [hour]: 10, [hour - H]: 10 }, detail: { [hour]: { m: {}, p: {}, c: 'x' }, [hour - H]: { m: {}, p: {}, c: -4 } } }))
  t.start()
  const today = payloadOf(t).scopes.all.today
  assert.equal(today.cost, 0)
  assert.doesNotMatch(t.tooltip(), /NaN/)
})

test('cost: the current session cost is shown as money', () => {
  const t = setup()
  t.write('a.json', costed('web', 10, 0.004))
  t.start()
  assert.match(t.tooltip(), /Current session: 1\.0k tokens · < \$0\.01/)
  assert.match(t.tooltip(), /Cost today: < \$0\.01 · at API prices/, 'no "≈" in front of "<"')
})

async function exportAs(t, pick) {
  t.log.pick = pick
  t.log.saved = path.join(t.home, `out-${pick}.csv`)
  await t.cmds['claudeUsage.exportCsv']()
  return fs.readFileSync(t.log.saved, 'utf8').slice(1).trim().split('\r\n')
}

test('CSV: a cost column appears when there is cost, with a decimal comma for Russian', async () => {
  const t = setup({ config: { numberGrouping: 'none' } })
  t.write('a.json', costed('web', 1000, 1.5))
  t.start()
  assert.equal((await exportAs(t, 'model'))[0], 'Date,Total,Opus 5.5,Other,"Cost, $"')
  const csv = await exportAs(t, 'project')
  assert.match(csv[0], /^Date,Total,web,Other,"Cost, \$"$/)
  assert.equal(csv[1], `${dayString(Date.now())},1000,1000,0,1.50`)
  assert.equal(csv.at(-1), 'Total,1000,1000,0,1.50')
  const raw = await exportAs(t, 'long')
  assert.equal(raw[0], 'Date,Dimension,Name,Value')
  assert.ok(raw.includes(`${dayString(Date.now())},"cost, $",,1.50`), raw.join('\n'))

  const ru = setup({ lang: 'ru', config: { numberGrouping: 'none' } })
  ru.write('a.json', costed('web', 1000, 1.5))
  ru.start()
  const ruRows = await exportAs(ru, 'project')
  assert.equal(ruRows[0], 'Дата;Всего;web;Прочее;Стоимость, $')
  assert.equal(ruRows[1], `${dayString(Date.now())};1000;1000;0;1,50`)
})
