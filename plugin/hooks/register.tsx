import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Usage } from '../types'

const empty: Usage = {
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

const persist = async ($: any) => {
  try {
    const home = await $.env.get('HOME')
    if (!home) return
    const u = await read($, usage)
    const now = await $.clock.now()
    const sid = await $.session.id()
    // one file per session: a single writer each, so two windows can never tear each other's data
    await $.fs.write(`${home}/.claude/usage-monitor/${sid}.json`, JSON.stringify({ ...u, updatedAt: now }))
  } catch {
    // the status bar is a convenience: never let it break a turn
  }
}

export const register: Register = on => {
  on('turn.complete', async ($, e, next) => {
    if (e.usage) {
      const u = e.usage
      const spent = u.input_tokens + u.output_tokens + u.cache_creation_input_tokens + u.cache_read_input_tokens
      const now = await $.clock.now()
      const hour = String(Math.floor(now / HOUR) * HOUR)
      const model = u.model || 'unknown'
      let project = 'unknown'
      try {
        project = (await $.session.cwd()).split('/').filter(Boolean).pop() || 'unknown'
      } catch {
        // no cwd: keep "unknown"
      }
      await update($, usage, cur => {
        const buckets: Record<string, number> = {}
        const detail: Usage['detail'] = {}
        for (const [k, v] of Object.entries(cur.buckets)) if (now - Number(k) < KEEP) buckets[k] = v
        for (const [k, v] of Object.entries(cur.detail ?? {})) if (now - Number(k) < KEEP) detail[k] = v
        buckets[hour] = (buckets[hour] ?? 0) + spent
        const d = detail[hour] ?? { m: {}, p: {} }
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
