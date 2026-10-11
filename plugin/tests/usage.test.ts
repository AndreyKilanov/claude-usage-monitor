import { expect, mock, test } from 'claude-code/testing'

const HOUR = 3600_000
const NOW = 1_800_000_000_000
const usageOf = (model: string, n: number) => ({
  model,
  input_tokens: n,
  output_tokens: 0,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
})

// A tiny world under the plugin: a session id, a folder name, a file system in a Map.
const world = (on: any, sid: { v: string }, files: Map<string, string>) => {
  mock.clock(on, { now: NOW })
  mock.env(on, { HOME: '/home/u', LANG: 'en_US.UTF-8' })
  on('session.id', () => ({ value: sid.v }))
  on('session.cwd', () => ({ value: '/work/my-project' }))
  on('fs.write', (_$: any, e: any) => {
    files.set(e.path, e.text)
    return { value: undefined }
  })
  on('fs.read', (_$: any, e: any) => {
    if (!files.has(e.path)) throw new Error('ENOENT')
    return { value: files.get(e.path) }
  })
  on('ui.status', () => ({ value: undefined }))
  // what the engine itself answers beneath the plugin
  on('turn.complete', () => ({ text: '' }))
  on('session.measure', (_$: any, e: any) => ({ changed: e.changed }))
}
const complete = ($: any, usage: unknown) =>
  $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer', usage })
const fileOf = (files: Map<string, string>, sid: string) => JSON.parse(files.get(`/home/u/.claude/usage-monitor/${sid}.json`) ?? 'null')

test('a turn adds its tokens to the hour, the model and the project', async ($, on) => {
  const files = new Map<string, string>()
  world(on, { v: 's1' }, files)
  await complete($, usageOf('claude-opus-5-5-20260101', 1000))
  await complete($, usageOf('claude-opus-5-5-20260101', 500))
  const f = fileOf(files, 's1')
  const hour = String(Math.floor(NOW / HOUR) * HOUR)
  expect(f.tokens).toBe(1500)
  expect(f.buckets[hour]).toBe(1500)
  expect(f.detail[hour].m['claude-opus-5-5-20260101']).toBe(1500)
  expect(f.detail[hour].p['my-project']).toBe(1500)
})

test('odd usage numbers never poison the totals', async ($, on) => {
  const files = new Map<string, string>()
  world(on, { v: 's1' }, files)
  await complete($, { model: 'm', input_tokens: -5, output_tokens: Number.NaN, cache_creation_input_tokens: undefined, cache_read_input_tokens: 7 })
  expect(fileOf(files, 's1').tokens).toBe(7)
  await complete($, undefined) // an interrupted turn has no usage
  expect(fileOf(files, 's1').tokens).toBe(7)
})

test('after /clear the new session starts from zero and the old file is untouched', async ($, on) => {
  const files = new Map<string, string>()
  const sid = { v: 's1' }
  world(on, sid, files)
  await complete($, usageOf('m', 1000))
  const before = files.get('/home/u/.claude/usage-monitor/s1.json')
  sid.v = 's2'
  await complete($, usageOf('m', 200))
  expect(files.get('/home/u/.claude/usage-monitor/s1.json')).toBe(before)
  expect(fileOf(files, 's2').tokens).toBe(200)
})

test('a resumed session keeps what its file already holds', async ($, on) => {
  const files = new Map<string, string>()
  const hour = String(Math.floor(NOW / HOUR) * HOUR)
  files.set('/home/u/.claude/usage-monitor/s1.json', JSON.stringify({ tokens: 900, buckets: { [hour]: 900 }, detail: { [hour]: { m: { m: 900 }, p: { 'my-project': 900 } } }, updatedAt: NOW - 1 }))
  world(on, { v: 's1' }, files)
  await complete($, usageOf('m', 100))
  const f = fileOf(files, 's1')
  expect(f.buckets[hour]).toBe(1000)
  expect(f.detail[hour].m.m).toBe(1000)
})

test('a half-written file from an earlier run is ignored, not fatal', async ($, on) => {
  const files = new Map<string, string>()
  files.set('/home/u/.claude/usage-monitor/s1.json', '{"tokens":9,"buckets":{"17')
  world(on, { v: 's1' }, files)
  await complete($, usageOf('m', 40))
  expect(fileOf(files, 's1').tokens).toBe(40)
})

test('the limits the engine reports are written for the extension', async ($, on) => {
  const files = new Map<string, string>()
  world(on, { v: 's1' }, files)
  await $.session.measure({
    context: { window: 200000 },
    rateLimits: [
      { kind: 'five_hour', percentUsed: 43, resetsAt: '2026-10-11T14:00:00.000Z' },
      { kind: 'seven_day', percentUsed: 6 },
    ],
    cost: { usd: 1.5 },
    changed: ['rateLimits'],
  })
  const f = fileOf(files, 's1')
  expect(f.fiveHour).toBe(43)
  expect(f.sevenDay).toBe(6)
  expect(f.sevenDayResetsAt).toBe(null)
  expect(f.usd).toBe(1.5)
  expect(f.limits.length).toBe(2)
})

test('a session with no subscription limits still counts tokens', async ($, on) => {
  const files = new Map<string, string>()
  world(on, { v: 's1' }, files)
  await $.session.measure({ context: { window: 200000 }, rateLimits: [], changed: ['context'] })
  await complete($, usageOf('m', 10))
  const f = fileOf(files, 's1')
  expect(f.fiveHour).toBe(null)
  expect(f.tokens).toBe(10)
})

// Windows: no HOME, a USERPROFILE, backslash paths
const winWorld = (on: any, files: Map<string, string>, env: Record<string, string>, cwd: string) => {
  mock.clock(on, { now: NOW })
  mock.env(on, env)
  on('session.id', () => ({ value: 'w1' }))
  on('session.cwd', () => ({ value: cwd }))
  on('fs.write', (_$: any, e: any) => {
    files.set(e.path, e.text)
    return { value: undefined }
  })
  on('fs.read', (_$: any, e: any) => {
    if (!files.has(e.path)) throw new Error('ENOENT')
    return { value: files.get(e.path) }
  })
  on('turn.complete', () => ({ text: '' }))
}

test('Windows: the home folder comes from USERPROFILE and the project from a backslash path', async ($, on) => {
  const files = new Map<string, string>()
  winWorld(on, files, { USERPROFILE: 'C:\\Users\\andy' }, 'C:\\work\\my-project')
  await complete($, usageOf('m', 10))
  // the test engine runs on a POSIX host and prefixes a drive path with its cwd; a real Windows host does not
  const key = [...files.keys()].find(k => k.endsWith('C:\\Users\\andy\\.claude\\usage-monitor\\w1.json'))
  expect(key).toBeDefined()
  const f = JSON.parse(files.get(key!) ?? 'null')
  expect(f.tokens).toBe(10)
  expect(Object.values(f.detail as Record<string, { p: Record<string, number> }>)[0]!.p['my-project']).toBe(10)
})

test('Windows: HOMEDRIVE + HOMEPATH is the last resort; with none, nothing is written and nothing breaks', async ($, on) => {
  const files = new Map<string, string>()
  winWorld(on, files, { HOMEDRIVE: 'D:', HOMEPATH: '\\Users\\andy' }, 'D:\\p')
  await complete($, usageOf('m', 5))
  expect([...files.keys()].some(k => k.endsWith('D:\\Users\\andy\\.claude\\usage-monitor\\w1.json'))).toBe(true)
})

test('no home folder at all: the turn still completes', async ($, on) => {
  const files = new Map<string, string>()
  winWorld(on, files, {}, '/p')
  await complete($, usageOf('m', 5))
  expect(files.size).toBe(0)
})

test('the data file appears when the session starts, before any reply', async ($, on) => {
  const files = new Map<string, string>()
  world(on, { v: 's1' }, files)
  on('session.start', (_$: any, e: any) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/work/my-project' })
  const f = fileOf(files, 's1')
  expect(f).not.toBe(null)
  expect(f.tokens).toBe(0)
  expect(f.fiveHour).toBe(null)
})

test('a note in the plugin folder says the plugin loaded, and what failed when a write is refused', async ($, on) => {
  const files = new Map<string, string>()
  mock.clock(on, { now: NOW })
  mock.env(on, { HOME: '/home/u' })
  on('session.id', () => ({ value: 's1' }))
  on('session.cwd', () => ({ value: '/p' }))
  on('fs.read', () => { throw new Error('ENOENT') })
  on('fs.write', (_$: any, e: any) => {
    if (e.path.includes('/.claude/usage-monitor/')) return { deny: 'EACCES: permission denied' }
    files.set(e.path, e.text)
    return { value: undefined }
  })
  on('session.start', (_$: any, e: any) => ({ cwd: e.cwd }))
  on('turn.complete', () => ({ text: '' }))
  await $.session.start({ cwd: '/p' })
  await complete($, usageOf('m', 5)) // the refused write must not break the turn
  const note = [...files.entries()].find(([k]) => k.endsWith('diagnostics.txt'))
  expect(note).toBeDefined()
  expect(note![1]).toContain('error at')
  expect(note![1]).toContain('EACCES')
  expect(note![1]).toContain('/home/u/.claude/usage-monitor/s1.json')
})
