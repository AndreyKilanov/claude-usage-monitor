// @ts-check
const { L, isRussian } = require('../i18n')
const { cfg } = require('../settings')
const { num } = require('./numbers')

const pct = value => {
  const n = num(value)
  return n === null ? '—' : `${Math.round(n)}%`
}

const groupNum = value => {
  const style = cfg('numberGrouping', 'auto')
  const rounded = Math.round(Number(value))
  if (!Number.isFinite(rounded)) return '0'
  const separator = { none: '', space: ' ', dot: '.', comma: ',' }[style] ?? (isRussian() ? ' ' : ',')
  const digits = String(Math.abs(rounded))
  const grouped = separator ? digits.replace(/\B(?=(\d{3})+(?!\d))/g, separator) : digits
  return (rounded < 0 ? '-' : '') + grouped
}

const tok = value => {
  if (!Number.isFinite(Number(value))) return '0'
  if (value >= 1e6) return `${(value / 1e6).toFixed(2)}M`
  if (value >= 1e3) return `${(value / 1e3).toFixed(1)}k`
  return String(Math.round(value || 0))
}

const fmtMs = ms => {
  const minutes = Math.round(ms / 60000)
  if (minutes < 60) return `${Math.max(minutes, 1)} ${L.min}`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return `${hours} ${L.h} ${minutes % 60} ${L.min}`
  return `${Math.floor(hours / 24)} ${L.d} ${hours % 24} ${L.h}`
}

const timeLeft = iso => {
  const ms = iso ? Date.parse(iso) - Date.now() : NaN
  return ms > 0 ? fmtMs(ms) : ''
}

// building an Intl formatter costs about a millisecond, so one is kept per locale and style
const formatters = new Map()
const formatter = (kind, locale, options, style) => {
  const key = `${kind}|${locale}|${style}`
  if (!formatters.has(key)) formatters.set(key, kind === 'time' ? new Intl.DateTimeFormat(locale, options) : new Intl.NumberFormat(locale, options))
  return formatters.get(key)
}

/** Wall-clock time of a moment: "23:40" today, "Thu 09:15" on another day. */
const clockAt = ms => {
  if (!Number.isFinite(ms)) return ''
  const date = new Date(ms)
  const time = formatter('time', L.locale, { hour: '2-digit', minute: '2-digit' }, 'hm').format(date)
  return date.toDateString() === new Date().toDateString() ? time : `${L.days[date.getDay()]} ${time}`
}

/** "1 h 32 min · at 23:40", or '' when the moment has passed or is unknown. */
const untilText = ms => {
  const left = Number.isFinite(ms) ? ms - Date.now() : NaN
  return left > 0 ? `${fmtMs(left)} · ${L.at} ${clockAt(ms)}` : ''
}

const money = usd => {
  const value = Number(usd)
  if (!Number.isFinite(value) || value < 0) return '—'
  const format = n => {
    const digits = n >= 100 ? 0 : 2
    return formatter('number', L.locale, { style: 'currency', currency: 'USD', minimumFractionDigits: digits, maximumFractionDigits: digits }, `usd${digits}`).format(n)
  }
  return value > 0 && value < 0.01 ? `< ${format(0.01)}` : format(value)
}

const METER = { width: 96, height: 10, bar: 6 }
const METER_COLORS = { ok: '#3fb950', warn: '#d29922', crit: '#f85149' }

/**
 * A limit bar for the tooltip: a small SVG drawn inline as a data: image, so it looks the same in
 * every editor font, carries the warning colour, and needs no network. If an editor does not show
 * the image, its alt text — the percentage — is shown instead.
 */
const bar = (percent, level = 'ok') => {
  const p = Math.max(0, Math.min(100, Number(percent) || 0))
  const { width, height, bar: thick } = METER
  const y = (height - thick) / 2
  const filled = p > 0 ? Math.max(thick, Math.round((p / 100) * width)) : 0
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`
    + `<rect x="0" y="${y}" width="${width}" height="${thick}" rx="${thick / 2}" fill="#8b949e" fill-opacity="0.28"/>`
    + (filled ? `<rect x="0" y="${y}" width="${filled}" height="${thick}" rx="${thick / 2}" fill="${METER_COLORS[level] || METER_COLORS.ok}"/>` : '')
    + '</svg>'
  return `![${Math.round(p)}%](data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')})`
}

const prettyModel = id => {
  const base = String(id || 'unknown').replace(/^claude-/, '').replace(/-\d{8}$/, '').replace(/\[.*\]$/, '')
  const spaced = base.replace(/(\d)-(\d)/g, '$1.$2').replace(/-/g, ' ')
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

module.exports = { pct, groupNum, tok, fmtMs, timeLeft, clockAt, untilText, money, bar, prettyModel }
