const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const { setup, fakeClaude } = require('./helpers/harness')
const { session } = require('./helpers/fixtures')

const LATEST = require('../src/constants').LATEST_PLUGIN

// Claude Code's own list of installed plugins, as it keeps it in ~/.claude/plugins
function installed(t, version) {
  const dir = path.join(t.home, '.claude', 'plugins')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'installed_plugins.json'), JSON.stringify({
    version: 2,
    plugins: { 'usage-monitor@claude-usage-monitor': [{ scope: 'user', version, installPath: path.join(dir, 'cache', version) }] },
  }))
}

function withPlugin(version, options = {}) {
  const t = setup(options)
  t.write('a.json', session())
  if (version) installed(t, version)
  t.mod('plugin/offer').setOfferDelay(0)
  return t
}

test('plugin update: an older plugin than the extension expects is offered an update, with three buttons', async () => {
  const t = withPlugin('0.6.7')
  t.start()
  await t.flush()
  assert.equal(t.log.offers.length, 1)
  assert.match(t.log.offers[0].m, new RegExp(`on this computer is 0\\.6\\.7; ${LATEST.replace(/\./g, '\\.')} is out`))
  assert.match(t.log.offers[0].m, /start a new Claude session/)
  assert.deepEqual(t.log.offers[0].btns, ['Update…', 'Later', 'Skip this version'])
  assert.equal(t.log.calls.length, 0, 'the question alone runs nothing')
})

test('plugin update: "Update…" opens the usual setup, which still asks before running any command', async () => {
  const t = withPlugin('0.6.7')
  fakeClaude(t.home, '.antigravity-ide', '2.1.318')
  t.log.offerChoice = 'Update…'
  t.start()
  await t.flush()
  assert.match(t.log.warn.at(-1), /plugin install usage-monitor --scope user/, 'the confirmation with the exact commands')
  assert.equal(t.log.calls.length, 0, 'closing that confirmation runs nothing')

  const confirmed = withPlugin('0.6.7')
  fakeClaude(confirmed.home, '.antigravity-ide', '2.1.318')
  confirmed.log.offerChoice = 'Update…'
  confirmed.log.confirm = 'Install'
  confirmed.start()
  await confirmed.flush()
  assert.ok(confirmed.log.calls.some(c => c.args.join(' ') === 'plugin update usage-monitor@claude-usage-monitor'))
})

test('plugin update: no offer when the plugin is current or newer, not installed, or offers are switched off', async () => {
  for (const version of [LATEST, '9.0.0', null]) {
    const t = withPlugin(version)
    t.start()
    await t.flush()
    assert.equal(t.log.offers.length, 0, `installed: ${version}`)
  }
  const off = withPlugin('0.6.7', { config: { offerPluginInstall: false } })
  off.start()
  await off.flush()
  assert.equal(off.log.offers.length, 0, 'switched off in settings')
})

test('plugin update: "Later" asks again next start; "Skip this version" is quiet until a newer plugin is out', async () => {
  const store = {}
  const later = withPlugin('0.6.7', { store })
  later.log.offerChoice = 'Later'
  later.start()
  await later.flush()
  const again = withPlugin('0.6.7', { store })
  again.log.offerChoice = 'Skip this version'
  again.start()
  await again.flush()
  assert.equal(again.log.offers.length, 1, 'asked again after "Later"')
  assert.equal(store.updateSkipped, LATEST)

  const quiet = withPlugin('0.6.7', { store })
  quiet.start()
  await quiet.flush()
  assert.equal(quiet.log.offers.length, 0, 'this version was skipped')

  const newerOut = withPlugin('0.6.7', { store: { updateSkipped: '0.6.9' } })
  newerOut.start()
  await newerOut.flush()
  assert.equal(newerOut.log.offers.length, 1, 'skipping an older version does not silence a newer one')
})

test('plugin update: the question speaks Russian, and a broken plugin list never raises it', async () => {
  const ru = withPlugin('0.6.7', { lang: 'ru' })
  ru.start()
  await ru.flush()
  assert.match(ru.log.offers[0].m, /на этом компьютере — версии 0\.6\.7/)
  assert.deepEqual(ru.log.offers[0].btns, ['Обновить…', 'Позже', 'Пропустить эту версию'])

  const broken = setup()
  broken.write('a.json', session())
  fs.mkdirSync(path.join(broken.home, '.claude', 'plugins'), { recursive: true })
  fs.writeFileSync(path.join(broken.home, '.claude', 'plugins', 'installed_plugins.json'), '{"plugins": 7')
  broken.mod('plugin/offer').setOfferDelay(0)
  broken.start()
  await broken.flush()
  assert.equal(broken.log.offers.length, 0)
})
