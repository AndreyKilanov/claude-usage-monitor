const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const { setup } = require('./helpers/harness')
const { HOUR: H, hourNow, session, day, dayString } = require('./helpers/fixtures')

async function exportAs(t, pick) {
  t.log.pick = pick
  t.log.saved = path.join(t.home, `out-${pick}.csv`)
  await t.cmds['claudeUsage.exportCsv']()
  return fs.readFileSync(t.log.saved, 'utf8')
}
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
  assert.deepEqual(rows[1], [dayString(y), '1000', '600', '400', '0'])
  assert.deepEqual(rows[2], [dayString(Date.now()), '250', '0', '0', '250'], 'tokens without a model split land in Other')
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
  assert.ok(raw.includes(`${dayString(hourNow() - 26 * H)},model,Opus 5.5,600`))
  assert.ok(raw.includes(`${dayString(hourNow() - 26 * H)},total,,1000`))
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
  await t.cmds['claudeUsage.exportCsv']()
  t.log.pick = 'model'; t.log.saved = null
  await t.cmds['claudeUsage.exportCsv']()
  t.log.saved = path.join(t.home, 'no', 'such', 'dir', 'x.csv')
  await t.cmds['claudeUsage.exportCsv']()
  assert.equal(t.log.error.length, 1)
  const empty = setup().start()
  await empty.cmds['claudeUsage.exportCsv']()
  assert.equal(empty.log.info.length, 1) // "nothing to export"
  t.stop(); empty.stop()
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
