const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')
const { setup } = require('./helpers/harness')
const { hourNow, session } = require('./helpers/fixtures')

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
  await withPick(t, 'setup')
  assert.equal(t.log.calls.length, 0)

  await withPick(t, null)
  assert.equal(t.log.clip, '5h 38% · wk 5% · today 1234 tokens')
})

test('menu: exactly the eight entries, the summary as its title, and CSV leads into the export flow', async () => {
  const t = menuSetup()
  t.log.pick = 'csv'
  t.log.saved = path.join(t.home, 'menu.csv')
  await t.cmds['claudeUsage.menu']()
  assert.deepEqual(t.log.offered[0].ids, ['open', 'copy', 'csv', 'refresh', 'folder', 'settings', 'setup', 'help'])
  assert.equal(t.log.offered[0].placeHolder, '5h 38% · wk 5% · today 1234 tokens')
  assert.deepEqual(t.log.offered[1].ids, ['model', 'project', 'long'])
})

test('menu in Russian is localized and the copied summary is Russian too', async () => {
  const t = menuSetup('ru')
  await withPick(t, 'copy')
  assert.equal(t.log.clip, '5ч 38% · нед 5% · сегодня 1234 токенов')
  assert.match(t.log.info.at(-1), /Скопировано/)
})

test('menu: the data folder is revealed when it exists and explained when it does not', async () => {
  const t = menuSetup()
  await withPick(t, 'folder')
  const [command, uri] = t.log.executed.at(-1)
  assert.equal(command, 'revealFileInOS')
  assert.equal(uri.fsPath, t.sessDir)

  require('fs').rmSync(t.sessDir, { recursive: true })
  t.log.executed.length = 0
  await t.cmds['claudeUsage.openDataFolder']()
  assert.equal(t.log.executed.length, 0)
  assert.match(t.log.info.at(-1), /does not exist yet/)
  assert.ok(t.log.info.at(-1).includes(t.sessDir))
})
