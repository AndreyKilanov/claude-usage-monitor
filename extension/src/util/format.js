const { L, isRussian } = require('../i18n')
const { cfg } = require('../settings')
const { num } = require('./numbers')

const pct = value => (num(value) === null ? '—' : `${Math.round(num(value))}%`)

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

const bar = (percent, length = 12) => {
  const filled = Math.max(0, Math.min(length, Math.round(((percent || 0) / 100) * length)))
  return '▰'.repeat(filled) + '▱'.repeat(length - filled)
}

const prettyModel = id => {
  const base = String(id || 'unknown').replace(/^claude-/, '').replace(/-\d{8}$/, '').replace(/\[.*\]$/, '')
  const spaced = base.replace(/(\d)-(\d)/g, '$1.$2').replace(/-/g, ' ')
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

module.exports = { pct, groupNum, tok, fmtMs, timeLeft, bar, prettyModel }
