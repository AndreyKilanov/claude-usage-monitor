const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { setup, payloadOf } = require('./helpers/harness')
const { HOUR: H, hourNow, session, folder } = require('./helpers/fixtures')

const DAY = 24 * H

// a session of plugin 0.7.0 in a project folder: name, fingerprint and parent, as the plugin writes them
const inFolder = (project, pid, parent, tokens, extra = {}) => session({
  v: '0.7.0', project, pid, parent,
  buckets: { [hourNow()]: tokens },
  detail: { [hourNow()]: { m: { 'claude-opus-5-5': tokens }, p: { [project]: tokens }, k: { i: 0, o: 0, w: 0, r: tokens }, c: tokens / 1000 } },
  ...extra,
})

test('fingerprint: the extension computes the same value as the plugin for the same folder', () => {
  const { projectId } = setup().mod('util/projects')
  // the same vectors are checked in plugin/tests/usage.test.ts
  assert.equal(projectId('/work/my-project'), '3caa0aaa')
  assert.equal(projectId('C:\\work\\client app'), '551fe0c1')
  assert.equal(projectId('c:/work/client app/'), '551fe0c1', 'slashes, a trailing slash and case do not matter')
})

test('two folders with the same name are two projects, labelled by their parent folder', () => {
  const t = setup()
  t.write('a.json', inFolder('api', '3c61e2c4', 'client-a', 700))
  t.write('b.json', inFolder('api', '2544ca11', 'client-b', 300))
  t.write('c.json', inFolder('web', 'aaaaaaaa', 'client-a', 100))
  t.start()
  const today = payloadOf(t).scopes.all.today
  assert.deepEqual(today.projects, [{ name: 'api (client-a)', v: 700 }, { name: 'api (client-b)', v: 300 }, { name: 'web', v: 100 }])
  assert.deepEqual(today.costProjects.map(p => p.name), ['api (client-a)', 'api (client-b)', 'web'])
})

test('a name used by one folder keeps its plain name, and older files without a fingerprint join it', () => {
  const t = setup()
  t.write('new.json', inFolder('api', '3c61e2c4', 'client-a', 700))
  t.write('old.json', session({ v: '0.6.7', project: 'api', buckets: { [hourNow()]: 50 }, detail: { [hourNow()]: { m: { m: 50 }, p: { api: 50 } } } }))
  t.start()
  assert.deepEqual(payloadOf(t).scopes.all.today.projects, [{ name: 'api', v: 750 }])
})

test('same name and same parent name on two paths: a piece of the fingerprint tells them apart', () => {
  const t = setup()
  t.write('a.json', inFolder('api', '3c61e2c4', 'src', 10))
  t.write('b.json', inFolder('api', '2544ca11', 'src', 20))
  t.start()
  assert.deepEqual(payloadOf(t).scopes.all.today.projects.map(p => p.name).sort(), ['api (src · 2544)', 'api (src · 3c61)'])
})

test('a broken fingerprint from another device is ignored, never shown', () => {
  const t = setup()
  t.write('a.json', inFolder('api', '<img src=x>', 'client-a', 10))
  t.write('b.json', inFolder('api', '2544ca11', 'client-b', 20))
  t.start()
  const names = payloadOf(t).scopes.all.today.projects.map(p => p.name)
  assert.ok(names.every(name => !name.includes('<img')), names.join(','))
})

test('"only this project" follows the folder open in the editor, not every folder with its name', () => {
  const t = setup()
  t.log.folders = [folder('/a/client-a/api')]
  t.write('a.json', inFolder('api', '3c61e2c4', 'client-a', 700))
  t.write('b.json', inFolder('api', '2544ca11', 'client-b', 300))
  t.write('old.json', session({ v: '0.6.7', project: 'api', buckets: { [hourNow()]: 50 } }))
  t.start()
  const data = payloadOf(t)
  assert.equal(data.projectName, 'api (client-a)')
  assert.equal(data.scopes.project.today.total, 750, "its own sessions, plus older ones matched by name; not the other client's api")
})

test('recent sessions: newest first, with project, time span, active hours, tokens, cost and top models', () => {
  const t = setup()
  const now = Date.now()
  t.write('11111111-aaaa.json', inFolder('web', 'aaaaaaaa', 'w', 400, { updatedAt: now - 2 * H }))
  t.write('22222222-bbbb.json', session({ v: '0.7.0', project: 'api', usd: 1.25, updatedAt: now - 60000, buckets: { [hourNow() - 2 * H]: 100, [hourNow()]: 300 }, detail: { [hourNow()]: { m: { 'claude-opus-5-5': 200, 'claude-haiku-5-5': 100 }, p: { api: 300 }, k: { i: 10, o: 20, w: 30, r: 240 } } } }))
  t.write('33333333-cccc.json', session({ v: '0.6.7', project: 'old', updatedAt: now - 3 * H, buckets: { [hourNow() - 3 * H]: 50 } }))
  t.write('44444444-dddd.json', session({ v: '0.7.0', project: 'idle', usd: null, updatedAt: now, buckets: {}, detail: {} }))
  t.start()
  const recent = payloadOf(t).scopes.all.recent
  assert.deepEqual(recent.map(s => s.id), ['22222222', '11111111', '33333333'], 'newest first; a session with nothing spent is left out')
  const [api, , old] = recent
  assert.equal(api.project, 'api')
  assert.equal(api.tokens, 400)
  assert.equal(api.hours, 2)
  assert.equal(api.first, hourNow() - 2 * H)
  assert.equal(api.cost, 1.25)
  assert.deepEqual(api.models, [{ name: 'Opus 5.5', v: 200 }, { name: 'Haiku 5.5', v: 100 }])
  assert.equal(api.kinds.cacheRead, 240)
  assert.equal(api.kinds.unknown, 100, 'the hour without a split')
  assert.equal(api.device, null)
  assert.equal(old.cost, null, 'a plugin before 0.7.0 recorded no cost: unknown, not zero')
})

test('recent sessions: other devices are named, the project scope narrows the list, the list is capped', () => {
  const sync = fs.mkdtempSync(path.join(os.tmpdir(), 'cum-sync-'))
  const t = setup({ config: { syncFolder: sync } })
  t.log.folders = [folder('/a/client-a/api')]
  t.write('mine.json', inFolder('api', '3c61e2c4', 'client-a', 10))
  t.write('theirs.json', inFolder('api', '2544ca11', 'client-b', 20), path.join(sync, 'laptop-1234'))
  for (let i = 0; i < 14; i++) t.write(`more-${i}.json`, inFolder('web', 'aaaaaaaa', 'w', 5, { updatedAt: Date.now() - (i + 1) * DAY / 10 }))
  t.start()
  const data = payloadOf(t)
  assert.equal(data.scopes.all.recent.length, 10)
  const theirs = data.scopes.all.recent.find(s => s.id === 'theirs')
  assert.equal(theirs.device, 'laptop-1234')
  assert.equal(theirs.project, 'api', 'one api per device: the same project at another path, not a second one')
  assert.deepEqual(data.scopes.project.recent.map(s => s.id).sort(), ['mine', 'theirs'])
})

test('two devices: the same project at two different paths stays one project, also for "this project"', () => {
  const sync = fs.mkdtempSync(path.join(os.tmpdir(), 'cum-sync-'))
  const t = setup({ config: { syncFolder: sync } })
  t.log.folders = [folder('/Users/a/dev/api')]
  const here = t.mod('util/projects').projectId('/Users/a/dev/api')
  t.write('mac.json', inFolder('api', here, 'dev', 100))
  t.write('win.json', inFolder('api', '22222222', 'projects', 40), path.join(sync, 'windows-pc'))
  t.start()
  const data = payloadOf(t)
  assert.deepEqual(data.scopes.all.today.projects, [{ name: 'api', v: 140 }])
  assert.equal(data.scopes.project.today.total, 140, "the other device's sessions of the same project count")
})

test('two devices, one of them with two api folders: the parent folder links the other device to the right one', () => {
  const sync = fs.mkdtempSync(path.join(os.tmpdir(), 'cum-sync-'))
  const t = setup({ config: { syncFolder: sync } })
  t.log.folders = [folder('/w/client-a/api')]
  t.write('a.json', inFolder('api', t.mod('util/projects').projectId('/w/client-a/api'), 'client-a', 100))
  t.write('b.json', inFolder('api', '2544ca11', 'client-b', 10))
  t.write('remote-a.json', inFolder('api', '99999999', 'client-a', 5), path.join(sync, 'laptop'))
  t.start()
  const data = payloadOf(t)
  assert.deepEqual(data.scopes.all.today.projects, [{ name: 'api (client-a)', v: 105 }, { name: 'api (client-b)', v: 10 }])
  assert.equal(data.scopes.project.today.total, 105, 'this machine by fingerprint, the laptop by parent folder')
  assert.equal(data.projectName, 'api (client-a)', 'the switch names the open folder the way the lists do')
})

test('recent sessions are worked out only while the panel is open, and the page draws them as text', () => {
  const t = setup()
  t.write('a.json', inFolder('<b>x</b>', 'aaaaaaaa', 'w', 10))
  t.start()
  const { recentSessions } = t.mod('data/recent')
  assert.equal(typeof recentSessions, 'function')
  t.cmds['claudeUsage.open']()
  t.log.onMessage({ type: 'ready' })
  assert.equal(t.log.posted.at(-1).data.scopes.all.recent[0].project, '<b>x</b>')
  const html = t.log.panels[0].html
  assert.match(html, /id="recent"/)
  assert.match(html, /el\('span', 'sp', session\.project \|\| '—'\)/, 'the name goes in as text, not markup')
  assert.equal((html.match(/innerHTML/g) || []).length, 1)
})
