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
  buckets: {},
  detail: {},
  limits: [],
}

const usage = atom({ plugin: 'usage-monitor', key: 'usage' } as const, empty)

const fmtTokens = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(2)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)

const fmtPct = (p: number | null) => (p === null ? '—' : `${Math.round(p)}%`)

const fmtReset = (iso: string | null, now: number, ru = true) => {
  if (!iso) return ''
  const ms = Date.parse(iso) - now
  if (Number.isNaN(ms) || ms <= 0) return ''
  const m = Math.round(ms / 60000)
  if (m < 60) return ` (${m}${ru ? 'м' : 'm'})`
  const h = Math.floor(m / 60)
  return h < 48 ? ` (${h}${ru ? 'ч' : 'h'} ${m % 60}${ru ? 'м' : 'm'})` : ` (${Math.floor(h / 24)}${ru ? 'д' : 'd'})`
}

const isRu = async ($: any) => {
  const lang = ((await $.env.get('LC_ALL')) || (await $.env.get('LANG')) || '').toLowerCase()
  return lang.startsWith('ru')
}

const line = (u: Usage, now: number, ru: boolean) => {
  const cost = u.usd === null ? '' : ` · $${u.usd.toFixed(2)}`
  return (
    `${ru ? '5ч' : '5h'}: ${fmtPct(u.fiveHour)}${fmtReset(u.fiveHourResetsAt, now, ru)} · ` +
    `${ru ? 'нед' : 'wk'}: ${fmtPct(u.sevenDay)}${fmtReset(u.sevenDayResetsAt, now, ru)} · ` +
    `${ru ? 'токенов' : 'tokens'}: ${fmtTokens(u.tokens)}${cost}`
  )
}

const HOUR = 3600_000
const KEEP = 35 * 24 * HOUR

// macOS and Linux set HOME; Windows sets USERPROFILE (or HOMEDRIVE + HOMEPATH) instead.
const homeDir = async ($: any): Promise<string | undefined> => {
  const home = (await $.env.get('HOME')) || (await $.env.get('USERPROFILE'))
  if (home) return home
  const drive = await $.env.get('HOMEDRIVE')
  const path = await $.env.get('HOMEPATH')
  return drive && path ? `${drive}${path}` : undefined
}

// One separator for the whole path: Windows homes use backslashes, and a path half "\\" and half "/" is asked for trouble.
const joinPath = (base: string, ...parts: string[]) => {
  const sep = base.includes('\\') ? '\\' : '/'
  return [base.replace(/[\\/]+$/, ''), ...parts].join(sep)
}
const dataFile = (home: string, sid: string) => joinPath(home, '.claude', 'usage-monitor', `${sid}.json`)

// A note left inside the plugin's own folder, so a machine where nothing shows up can say why:
// "loaded" proves the plugin runs; "error" carries what failed and where.
const diag = async ($: any, kind: 'loaded' | 'error', detail: string) => {
  try {
    const now = await $.clock.now()
    await $.fs.write(
      joinPath($.plugin.root, 'diagnostics.txt'),
      `${kind} at ${new Date(now).toISOString()}\n${detail}\n`,
    )
  } catch {
    // nowhere left to report to
  }
}

// The plugin's own version, read once from its manifest, so the editor extension can tell an old plugin from a current one.
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

// The folder name of the session's working directory: the project this session belongs to.
const projectName = async ($: any): Promise<string | null> => {
  try {
    return (await $.session.cwd()).split(/[\\/]/).filter(Boolean).pop() || null
  } catch {
    return null
  }
}

const maxMerge = (a: Record<string, number>, b: Record<string, number>) => {
  const out = { ...a }
  for (const [k, v] of Object.entries(b)) out[k] = Math.max(out[k] ?? 0, Number(v) || 0)
  return out
}

let hydrated = false

// Makes the counters belong to the live session: after /clear the state may still hold the previous
// session's numbers (they are already in its own file, so keep them out of the new one), and a resumed
// session starts from what its file already holds instead of overwriting it with less.
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
        usd: c.usd,
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
      return // no file yet, or half-written: nothing to merge
    }
    if (!old || typeof old !== 'object') return
    await update($, usage, c => {
      const detail: Usage['detail'] = { ...(old.detail ?? {}) }
      for (const [k, d] of Object.entries(c.detail ?? {})) {
        const o = detail[k] ?? { m: {}, p: {} }
        detail[k] = { m: maxMerge(o.m, d.m), p: maxMerge(o.p, d.p), k: maxMerge(o.k ?? {}, d.k ?? {}) }
      }
      return {
        ...c,
        buckets: maxMerge(old.buckets ?? {}, c.buckets),
        detail,
        tokens: Math.max(c.tokens, Number(old.tokens) || 0),
      }
    })
  } catch {
    // never let bookkeeping break a turn
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
    // one file per session: a single writer each, so two windows can never tear each other's data
    const target = dataFile(home, sid)
    try {
      await $.fs.write(target, JSON.stringify({ ...u, v: await pluginVersion($), project: await projectName($), updatedAt: now }))
    } catch (err) {
      await diag($, 'error', `could not write ${target}\n${String(err)}`)
    }
  } catch (err) {
    await diag($, 'error', `persist failed\n${String(err)}`)
    // the status bar is a convenience: never let it break a turn
  }
}

export const register: Register = on => {
  // The data folder shows up the moment a session starts, not only after its first reply.
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
    await update($, usage, cur => ({
      ...cur,
      fiveHour: five?.percentUsed ?? null,
      fiveHourResetsAt: five?.resetsAt ?? null,
      sevenDay: week?.percentUsed ?? null,
      sevenDayResetsAt: week?.resetsAt ?? null,
      usd: e.cost?.usd ?? cur.usd,
      limits: e.rateLimits.map(r => ({ kind: r.kind, percentUsed: r.percentUsed, resetsAt: r.resetsAt ?? null })),
    }))
    $.ui.status(line(await read($, usage), await $.clock.now(), await isRu($)))
    await persist($)

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)

    const u = await read($, usage)
    const now = await $.clock.now()
    const { Box, Text } = $.ui.resolve(e)
    const ru = await isRu($)
    const hot = (p: number | null) => p !== null && p >= 80

    return (
      <Box>
        <Text color={hot(u.fiveHour) ? 'red' : undefined}>
          {ru ? '5ч' : '5h'}: {fmtPct(u.fiveHour)}
          {fmtReset(u.fiveHourResetsAt, now, ru)}
        </Text>
        <Text dimColor> · </Text>
        <Text color={hot(u.sevenDay) ? 'red' : undefined}>
          {ru ? 'нед' : 'wk'}: {fmtPct(u.sevenDay)}
          {fmtReset(u.sevenDayResetsAt, now, ru)}
        </Text>
        <Text dimColor> · {ru ? 'токенов' : 'tokens'}: {fmtTokens(u.tokens)}</Text>
        {u.usd !== null ? <Text dimColor> · ${u.usd.toFixed(2)}</Text> : null}
      </Box>
    )
  })
}
