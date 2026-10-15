const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const { setup, withoutPlugin, fakeClaude, exeName, writeClaudeSettings } = require('./helpers/harness')
const { session } = require('./helpers/fixtures')

test('it finds Claude Code by itself: any editor folder, newest version first, never a stranger', () => {
  const t = setup()
  const old = fakeClaude(t.home, '.antigravity-ide', '2.1.290-win32-x64')
  const newer = fakeClaude(t.home, '.vscode', '2.1.296-win32-x64')
  fs.utimesSync(old, new Date(2026, 0, 1), new Date(2026, 0, 1))
  fs.mkdirSync(path.join(t.home, '.config', 'extensions', 'anthropic.claude-code-9.9.9', 'resources', 'native-binary'), { recursive: true })
  fs.writeFileSync(path.join(t.home, '.config', 'extensions', 'anthropic.claude-code-9.9.9', 'resources', 'native-binary', exeName), 'x')
  fakeClaude(t.home, '.cursor', '1.0.0')
  const found = t.mod('plugin/binaries').findClaudeBinaries()
  assert.ok(found.includes(old) && found.includes(newer))
  assert.ok(!found.some(f => f.includes(`${path.sep}.config${path.sep}`)))
  assert.ok(found.indexOf(newer) < found.indexOf(old), 'newest first')
  const loaded = path.join(t.home, 'loaded-ext')
  fs.mkdirSync(path.join(loaded, 'resources', 'native-binary'), { recursive: true })
  fs.writeFileSync(path.join(loaded, 'resources', 'native-binary', exeName), 'x')
  t.log.extensions = [{ id: 'anthropic.claude-code', extensionPath: loaded }, { id: 'ms-python.python', extensionPath: path.join(t.home, 'nope') }]
  assert.ok(t.mod('plugin/binaries').findClaudeBinaries().includes(path.join(loaded, 'resources', 'native-binary', exeName)))
})

test('install: asks first, then runs exactly the install commands, with no shell', async () => {
  const t = setup()
  const bin = fakeClaude(t.home, '.antigravity-ide', '2.1.296')
  t.start()
  assert.equal(t.log.calls.length, 0, 'nothing runs on its own')
  t.log.confirm = 'Install'
  await t.cmds['claudeUsage.setup']()
  assert.deepEqual(t.log.calls.map(c => c.args), [
    ['plugin', 'marketplace', 'add', 'https://github.com/AndreyKilanov/claude-usage-monitor.git'],
    ['plugin', 'install', 'usage-monitor@claude-usage-monitor', '--scope', 'user'],
    ['plugin', 'marketplace', 'update', 'claude-usage-monitor'], // refresh the version list, or "update" sees nothing new
    ['plugin', 'update', 'usage-monitor@claude-usage-monitor'],
  ])
  assert.ok(t.log.calls.every(c => c.file === bin))
  assert.match(t.log.warn.at(-1), /AndreyKilanov\/claude-usage-monitor/, 'the prompt names what will run and from where')
  assert.match(t.log.info.at(-1), /NEW Claude session/)
})

test('install: what the update commands say is shown, so a stale update is visible', async () => {
  const t = setup()
  fakeClaude(t.home, '.antigravity-ide', '2.1.296')
  t.log.plan = args => (args[1] === 'update' ? { stdout: 'usage-monitor is already at the latest version (0.6.3)' } : {})
  t.start()
  t.log.confirm = 'Install'
  await t.cmds['claudeUsage.setup']()
  assert.match(t.log.info.at(-1), /already at the latest version \(0\.6\.3\)/)
})

const writeInstalled = (t, version) => {
  const dir = path.join(t.home, '.claude', 'plugins')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'installed_plugins.json'), JSON.stringify({ plugins: { 'usage-monitor@claude-usage-monitor': [{ version }] } }))
}

test('install: a plugin that stays outdated after the update is removed and installed again', async () => {
  const t = setup()
  fakeClaude(t.home, '.antigravity-ide', '2.1.296')
  writeInstalled(t, '0.6.3')
  t.start()
  t.log.confirm = 'Install'
  await t.cmds['claudeUsage.setup']()
  assert.deepEqual(t.log.calls.slice(4).map(c => c.args.slice(0, 3).join(' ')), [
    'plugin uninstall usage-monitor@claude-usage-monitor',
    'plugin marketplace remove',
    'plugin marketplace add',
    'plugin install usage-monitor@claude-usage-monitor',
  ])
  assert.match(t.log.warn.at(-1), /still version 0\.6\.3/, 'the fake CLI changed nothing, so the user is told the truth')
})

test('install: an up-to-date plugin is not reinstalled', async () => {
  const t = setup()
  fakeClaude(t.home, '.antigravity-ide', '2.1.296')
  writeInstalled(t, require('../src/constants').LATEST_PLUGIN)
  t.start()
  t.log.confirm = 'Install'
  await t.cmds['claudeUsage.setup']()
  assert.equal(t.log.calls.length, 4)
})

test('install: the newest known plugin version matches the plugin manifest', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'plugin', '.claude-plugin', 'plugin.json'), 'utf8'))
  assert.equal(setup().mod('constants').LATEST_PLUGIN, manifest.version)
})

test('install: declining runs nothing; an already-added catalogue is fine; a real failure is reported', async () => {
  const t = setup()
  fakeClaude(t.home, '.vscode', '2.1.296')
  t.start()
  t.log.confirm = undefined
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
  await t.cmds['claudeUsage.setup']()
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

test('first-run offer: asked once, with three buttons, and nothing runs until the person confirms the commands', async () => {
  const t = withoutPlugin()
  fakeClaude(t.home, '.antigravity-ide', '2.1.296')
  t.start()
  await t.flush()
  assert.equal(t.log.offers.length, 1)
  assert.match(t.log.offers[0].m, /needs a small plugin for Claude Code/)
  assert.deepEqual(t.log.offers[0].btns, ['Set up…', 'Later', "Don't ask again"])
  assert.equal(t.log.calls.length, 0, 'the question alone changes nothing')

  const yes = withoutPlugin()
  fakeClaude(yes.home, '.antigravity-ide', '2.1.296')
  yes.log.offerChoice = 'Set up…'
  yes.start()
  await yes.flush()
  assert.equal(yes.log.calls.length, 0, 'closing the confirmation runs nothing')
  assert.match(yes.log.warn.at(-1), /plugin marketplace add https:\/\/github\.com\/AndreyKilanov\/claude-usage-monitor\.git/)

  const confirmed = withoutPlugin()
  fakeClaude(confirmed.home, '.antigravity-ide', '2.1.296')
  confirmed.log.offerChoice = 'Set up…'
  confirmed.log.confirm = 'Install'
  confirmed.start()
  await confirmed.flush()
  assert.deepEqual(confirmed.log.calls.map(c => c.args[1]), ['marketplace', 'install', 'marketplace', 'update'])
})

test('first-run offer: "Later" asks again next start, "Don\'t ask again" never does', async () => {
  const store = {}
  const first = withoutPlugin({ store })
  first.log.offerChoice = 'Later'
  first.start()
  await first.flush()
  assert.equal(first.log.offers.length, 1)
  assert.equal(store.offerDismissed, undefined)

  const second = withoutPlugin({ store })
  second.log.offerChoice = "Don't ask again"
  second.start()
  await second.flush()
  assert.equal(second.log.offers.length, 1, 'asked again after "Later"')
  assert.equal(store.offerDismissed, true)

  const third = withoutPlugin({ store })
  third.start()
  await third.flush()
  assert.equal(third.log.offers.length, 0, 'never again')
})

test('first-run offer: never when there is data, a data folder, the plugin is switched on, or the setting is off', async () => {
  const withData = setup()
  withData.mod('plugin/offer').setOfferDelay(0)
  withData.write('a.json', session())
  withData.start()
  await withData.flush()
  assert.equal(withData.log.offers.length, 0, 'data present')

  const emptyFolder = setup()
  emptyFolder.mod('plugin/offer').setOfferDelay(0)
  emptyFolder.start()
  await emptyFolder.flush()
  assert.equal(emptyFolder.log.offers.length, 0, 'folder present')

  for (const key of ['usage-monitor@claude-usage-monitor', 'usage-monitor@some-other-catalogue']) {
    const listed = withoutPlugin()
    writeClaudeSettings(listed, { enabledPlugins: { [key]: true } })
    listed.start()
    await listed.flush()
    assert.equal(listed.log.offers.length, 0, `${key} is switched on`)
  }

  const off = withoutPlugin({ config: { offerPluginInstall: false } })
  off.start()
  await off.flush()
  assert.equal(off.log.offers.length, 0, 'switched off in settings')
})

test('first-run offer: a disabled or unreadable plugin list still gets the offer; it speaks Russian too', async () => {
  const disabled = withoutPlugin()
  writeClaudeSettings(disabled, { enabledPlugins: { 'usage-monitor@claude-usage-monitor': false } })
  disabled.start()
  await disabled.flush()
  assert.equal(disabled.log.offers.length, 1, 'listed but switched off counts as not installed')

  for (const junk of ['{ not json', '[]', 'null', JSON.stringify({ enabledPlugins: 'yes' })]) {
    const t = withoutPlugin()
    writeClaudeSettings(t, junk)
    t.start()
    await t.flush()
    assert.equal(t.log.offers.length, 1, `junk settings: ${junk}`)
  }

  const ru = withoutPlugin({ lang: 'ru' })
  ru.start()
  await ru.flush()
  assert.match(ru.log.offers[0].m, /нужен небольшой плагин для Claude Code/)
  assert.deepEqual(ru.log.offers[0].btns, ['Установить…', 'Позже', 'Больше не спрашивать'])
})

test('first-run offer: it waits for the editor to finish starting and disappears if the extension is stopped first', async () => {
  const t = setup()
  fs.rmSync(t.sessDir, { recursive: true })
  t.mod('plugin/offer').setOfferDelay(60_000)
  t.start()
  await t.flush()
  assert.equal(t.log.offers.length, 0, 'nothing at the very start')
  t.stop()

  const early = withoutPlugin()
  early.mod('plugin/offer').setOfferDelay(50)
  early.start()
  early.stop()
  await new Promise(r => setTimeout(r, 120))
  assert.equal(early.log.offers.length, 0)
})
