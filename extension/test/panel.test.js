const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { setup, payloadOf } = require('./helpers/harness')
const { hourNow, session, day } = require('./helpers/fixtures')

test('the panel is a static shell: no innerHTML for data, a strict CSP', () => {
  const html = setup().mod('ui/panelHtml').panelHtml()
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
  assert.equal(t.log.posted.at(-1).data.scopes.all.today.projects[0].name, evil)
  t.stop()
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
  assert.ok(headerRow && headerRow.endsWith(`${link} |`), 'the version link closes the header row: ' + headerRow)
  assert.ok(tip.indexOf(link) < tip.indexOf('5-hour window'), 'above the limit bars, not under them')
  assert.ok(!tip.includes('### '), 'the title now lives in the same table row')
  assert.ok(!/plugin 0\.6\.3_?\s*$/.test(tip.trimEnd()), 'no version line at the bottom')

  const ru = setup({ lang: 'ru' })
  ru.write('a.json', day('p', 10))
  ru.start()
  assert.ok(ru.tooltip().includes(`[_v${ownVersion}_](https://github.com/AndreyKilanov/claude-usage-monitor "Расширение ${ownVersion} · плагин старый (до 0.6.3)")`), ru.tooltip())
  assert.match(ru.tooltip().trimEnd().split('\n').pop(), /^⚠ Плагин на этом компьютере устарел/, 'an old plugin is flagged at the end, once')
  assert.match(payloadOf(ru).versions.oldText, /Плагин на этом компьютере устарел/)
})

test('versions: the old-plugin banner replaces the token-split warning instead of doubling it; a remote old plugin is not this computer\'s problem', () => {
  const t = setup()
  t.write('a.json', session({ buckets: { [hourNow()]: 10 }, detail: { [hourNow()]: { m: { m: 10 }, p: { p: 10 } } } }))
  t.start()
  const data = payloadOf(t)
  assert.equal(data.versions.old, true)
  assert.equal(data.pluginOutdated, true)
  assert.match(t.log.panels[0].html, /showKindsWarn/, 'the page hides the second warning when the banner is up')

  const sync = fs.mkdtempSync(path.join(os.tmpdir(), 'cum-sync-'))
  const remote = setup({ config: { syncFolder: sync } })
  remote.write('mine.json', day('p', 10, { v: '0.6.3' }))
  remote.write('theirs.json', day('p', 10), path.join(sync, 'other-pc'))
  remote.start()
  assert.equal(payloadOf(remote).versions.old, false)
})

function sourceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return ['src', 'media'].includes(entry.name) || /[\\/](src|media)([\\/]|$)/.test(dir) ? sourceFiles(full) : []
    return /\.(js|html|css)$/.test(entry.name) ? [full] : []
  })
}

test('the version sits small in the top right of the panel: plain "v<number>", both versions on hover, no network involved', () => {
  const t = setup()
  t.write('a.json', day('p', 10, { v: '0.6.3' }))
  t.start()
  const html = t.log.panels.length ? t.log.panels[0].html : (t.cmds['claudeUsage.open'](), t.log.panels[0].html)
  assert.match(html, /<a class="ver" id="ver" href="#"><\/a>/)
  assert.match(html, /\.ver \{ position: absolute; top: 10px; right: 24px; font-size: 10px/)
  assert.match(html, /\$\('ver'\)\.textContent = 'v' \+ versions\.ext/)
  assert.ok(!html.includes('id="versions"'), 'the old footer line is gone')
  assert.ok(!/https?:\/\//.test(html.replace(/<\/?\w[^>]*>/g, '')), 'the page itself makes no requests')
  const src = sourceFiles(path.join(__dirname, '..')).map(file => fs.readFileSync(file, 'utf8')).join('\n')
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
  assert.match(html, /\$\('ver'\)\.onclick = event => \{\s+event\.preventDefault\(\)\s+vscode\.postMessage\(\{ type: 'repo' \}\)\s+\}/)
  assert.ok(!html.includes('github.com'), 'the page itself holds no address to navigate to')
  assert.match(html, /\.ver:hover \{ text-decoration: underline/)
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
