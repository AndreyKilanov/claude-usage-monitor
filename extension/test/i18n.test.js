const test = require('node:test')
const assert = require('node:assert/strict')
const { setup } = require('./helpers/harness')
const { hourNow, session } = require('./helpers/fixtures')

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

test('both languages have the same keys, no empty strings, and Russian text is really Russian', () => {
  const { dictionaries: STR } = setup().mod('i18n')
  assert.deepEqual(Object.keys(STR.ru).sort(), Object.keys(STR.en).sort(), 'every string exists in both languages')
  for (const [lang, dict] of Object.entries(STR)) {
    for (const [k, v] of Object.entries(dict)) {
      if (typeof v === 'string') assert.ok(v.trim().length > 0, `${lang}.${k} is empty`)
      if (Array.isArray(v)) assert.equal(v.length, 7, `${lang}.${k}`)
    }
  }
  const ruText = JSON.stringify(STR.ru)
  for (const bad of ['Окно 5 часов', 'Новый ввод', 'Записка', 'ориентируйтесь', 'Ищу данные', 'Срез']) assert.ok(!ruText.includes(bad), bad)
  for (const k of ['kindsNote', 'note', 'setupAsk', 'noFolder', 'pluginSilent']) assert.match(STR.ru[k], /[а-яё]{4}/i, k)
  assert.equal(STR.ru.warnMsg(STR.ru.win5, 85), 'Claude: 5-часовой лимит — использовано 85%')
  assert.equal(STR.ru.resetMsg(STR.ru.winWeek), 'Claude: Недельный лимит сброшен — можно продолжать работу')
})
