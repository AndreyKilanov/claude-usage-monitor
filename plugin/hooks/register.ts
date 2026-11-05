import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Usage } from '../types'

const empty: Usage = {
  sid: null,
  fiveHour: null,
  fiveHourResetsAt: null,
  sevenDay: null,
  sevenDayResetsAt: null,
  tokens: 0,
  usd: null,
  costSeen: null,
  buckets: {},
  detail: {},
  limits: [],
}

const usage = atom({ plugin: 'usage-monitor', key: 'usage' } as const, empty)

const HOUR = 3600_000
const KEEP = 35 * 24 * HOUR

const homeDir = async ($: any): Promise<string | undefined> => {
  const home = (await $.env.get('HOME')) || (await $.env.get('USERPROFILE'))
  if (home) return home
  const drive = await $.env.get('HOMEDRIVE')
  const path = await $.env.get('HOMEPATH')
  return drive && path ? `${drive}${path}` : undefined
}

const joinPath = (base: string, ...parts: string[]) => {
  const sep = base.includes('\\') ? '\\' : '/'
  return [base.replace(/[\\/]+$/, ''), ...parts].join(sep)
}
const dataFile = (home: string, sid: string) => joinPath(home, '.claude', 'usage-monitor', `${sid}.json`)

const diag = async ($: any, kind: 'loaded' | 'error', detail: string) => {
  try {
    const now = await $.clock.now()
    await $.fs.write(
      joinPath($.plugin.root, 'diagnostics.txt'),
      `${kind} at ${new Date(now).toISOString()}\n${detail}\n`,
    )
  } catch {
  }
}

let versionCache: string | null | undefined
const pluginVersion = async ($: any): Promise<string | null> => {
  if (versionCache !== undefined) return versionCache
  try {
    const manifest = JSON.parse(await $.fs.read(joinPath($.plugin.root, '.claude-plugin', 'plugin.json')))
    versionCache = typeof manifest.version === 'string' ? manifest.version : null
  } catch {
    versionCache = null
  }
  return versionCache
}

const sessionCwd = async ($: any): Promise<string | null> => {
  try {
    const cwd = await $.session.cwd()
    return typeof cwd === 'string' && cwd ? cwd : null
  } catch {
    return null
  }
}

const projectName = async ($: any): Promise<string | null> =>
  ((await sessionCwd($)) ?? '').split(/[\\/]/).filter(Boolean).pop() || null

/**
 * Two projects can share a folder name (two `api` folders of two clients). The full path tells them
 * apart, but it is not written: the files may be copied to a cloud sync folder. Instead the file gets
 * a short one-way fingerprint of the path (FNV-1a, 32 bits) and the parent folder's name, enough for
 * the extension to tell the two apart and to label them `api (client-a)` / `api (client-b)`.
 * The extension computes the same fingerprint for the folder open in the editor; keep both in step.
 */
const projectId = (cwd: string): string => {
  const normal = cwd.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
  let hash = 0x811c9dc5
  for (let i = 0; i < normal.length; i++) {
    hash ^= normal.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

const projectWhere = async ($: any): Promise<{ pid: string | null; parent: string | null }> => {
  const cwd = await sessionCwd($)
  if (!cwd) return { pid: null, parent: null }
  const parts = cwd.split(/[\\/]/).filter(Boolean)
  return { pid: projectId(cwd), parent: parts.length > 1 ? parts[parts.length - 2] : null }
}

const maxMerge = (a: Record<string, number>, b: Record<string, number>) => {
  const out = { ...a }
  for (const [k, v] of Object.entries(b)) out[k] = Math.max(out[k] ?? 0, Number(v) || 0)
  return out
}

const money = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) && x >= 0 ? x : null)
const round6 = (x: number) => Math.round(x * 1e6) / 1e6

/**
 * How much of a reported cost is new since the last report of the same session.
 * Claude Code's figure is a running total per session (checked on 2.1.318): it starts at zero
 * in a new session and after /clear, and a resumed session continues from its earlier total.
 * So the base is the session's own last figure, kept in its data file; a drop is read as a
 * restarted counter, so the whole new figure is new spending.
 */
const costDelta = (raw: number, previous: number | null) => {
  if (previous === null || raw < previous) return raw
  return raw - previous
}

let hydrated = false

const adopt = async ($: any) => {
  try {
    const sid: string = await $.session.id()
    const cur = await read($, usage)
    if (cur.sid !== sid) {
      await update($, usage, c => ({
        ...empty,
        sid,
        fiveHour: c.fiveHour,
        fiveHourResetsAt: c.fiveHourResetsAt,
        sevenDay: c.sevenDay,
        sevenDayResetsAt: c.sevenDayResetsAt,
        limits: c.limits,
      }))
      hydrated = false
    }
    if (hydrated) return
    hydrated = true
    const home = await homeDir($)
    if (!home) return
    let old: Partial<Usage> | null = null
    try {
      old = JSON.parse(await $.fs.read(dataFile(home, sid)))
    } catch {
      return
    }
    if (!old || typeof old !== 'object') return
    await update($, usage, c => {
      const detail: Usage['detail'] = { ...(old.detail ?? {}) }
      for (const [k, d] of Object.entries(c.detail ?? {})) {
        const o = detail[k] ?? { m: {}, p: {} }
        const merged: Usage['detail'][string] = { m: maxMerge(o.m, d.m), p: maxMerge(o.p, d.p), k: maxMerge(o.k ?? {}, d.k ?? {}) }
        const cost = Math.max(money(o.c) ?? 0, money(d.c) ?? 0)
        if (cost > 0) merged.c = cost
        detail[k] = merged
      }
      const oldUsd = money(old.usd)
      return {
        ...c,
        buckets: maxMerge(old.buckets ?? {}, c.buckets),
        detail,
        tokens: Math.max(c.tokens, Number(old.tokens) || 0),
        usd: c.usd === null ? oldUsd : Math.max(c.usd, oldUsd ?? 0),
        // files from plugins before 0.7.0 hold Claude Code's own figure in usd and no base
        costSeen: c.costSeen ?? money(old.costSeen) ?? oldUsd,
      }
    })
  } catch {
  }
}

const persist = async ($: any) => {
  try {
    const home = await homeDir($)
    if (!home) return
    await adopt($)
    const u = await read($, usage)
    const now = await $.clock.now()
    const sid = await $.session.id()
    const target = dataFile(home, sid)
    try {
      await $.fs.write(target, JSON.stringify({
        ...u,
        v: await pluginVersion($),
        project: await projectName($),
        ...(await projectWhere($)),
        updatedAt: now,
      }))
    } catch (err) {
      await diag($, 'error', `could not write ${target}\n${String(err)}`)
    }
  } catch (err) {
    await diag($, 'error', `persist failed\n${String(err)}`)
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const home = await homeDir($)
    await diag($, 'loaded', `home: ${home ?? '(none found)'}\nplugin: ${$.plugin.root}`)
    await persist($)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    await adopt($)
    if (e.usage) {
      const u = e.usage
      const part = (x: unknown) => (Number(x) > 0 ? Number(x) : 0)
      const kinds = { i: part(u.input_tokens), o: part(u.output_tokens), w: part(u.cache_creation_input_tokens), r: part(u.cache_read_input_tokens) }
      const spent = kinds.i + kinds.o + kinds.w + kinds.r
      const now = await $.clock.now()
      const hour = String(Math.floor(now / HOUR) * HOUR)
      const model = u.model || 'unknown'
      const project = (await projectName($)) ?? 'unknown'
      await update($, usage, cur => {
        const buckets: Record<string, number> = {}
        const detail: Usage['detail'] = {}
        for (const [k, v] of Object.entries(cur.buckets)) if (now - Number(k) < KEEP) buckets[k] = v
        for (const [k, v] of Object.entries(cur.detail ?? {})) if (now - Number(k) < KEEP) detail[k] = v
        buckets[hour] = (buckets[hour] ?? 0) + spent
        const d = detail[hour] ?? { m: {}, p: {} }
        const k = d.k ?? {}
        for (const [name, n] of Object.entries(kinds)) k[name] = (k[name] ?? 0) + n
        d.k = k
        d.m[model] = (d.m[model] ?? 0) + spent
        d.p[project] = (d.p[project] ?? 0) + spent
        detail[hour] = d
        return { ...cur, tokens: cur.tokens + spent, buckets, detail }
      })
      await persist($)
    }

    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    await adopt($)
    const five = e.rateLimits.find(r => r.kind === 'five_hour')
    const week = e.rateLimits.find(r => r.kind === 'seven_day')
    const raw = money(e.cost?.usd)
    const now = await $.clock.now()
    const hour = String(Math.floor(now / HOUR) * HOUR)
    await update($, usage, cur => {
      const measured: Usage = {
        ...cur,
        fiveHour: five?.percentUsed ?? null,
        fiveHourResetsAt: five?.resetsAt ?? null,
        sevenDay: week?.percentUsed ?? null,
        sevenDayResetsAt: week?.resetsAt ?? null,
        limits: e.rateLimits.map(r => ({ kind: r.kind, percentUsed: r.percentUsed, resetsAt: r.resetsAt ?? null })),
      }
      if (raw === null) return measured
      const delta = round6(costDelta(raw, cur.costSeen))
      measured.costSeen = raw
      if (delta <= 0) return { ...measured, usd: cur.usd ?? 0 }
      const detail = { ...(cur.detail ?? {}) }
      const d = { ...(detail[hour] ?? { m: {}, p: {} }) }
      d.c = round6((money(d.c) ?? 0) + delta)
      detail[hour] = d
      return { ...measured, detail, usd: round6((cur.usd ?? 0) + delta) }
    })
    await persist($)

    return next(e)
  })
}
