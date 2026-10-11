const { L, isRussian } = require('../../i18n')
const { cfg } = require('../../settings')
const { groupNum, prettyModel } = require('../../util/format')
const { isoDay } = require('../../util/dates')

const MAX_COLUMNS = 8

function csvDelimiter() {
  const choice = cfg('csvDelimiter', 'auto')
  if (choice === 'tab') return '\t'
  if (choice === ',' || choice === ';') return choice
  return isRussian() ? ';' : ','
}

function aggregateByDay(raw) {
  const days = {}
  for (const row of raw) {
    const key = isoDay(row.t)
    const day = (days[key] = days[key] || { total: 0, model: {}, project: {}, kind: {} })
    day.total += row.v
    for (const [kind, n] of Object.entries(row.k || {})) day.kind[kind] = (day.kind[kind] || 0) + (Number(n) > 0 ? Number(n) : 0)
    for (const [model, n] of Object.entries(row.m || {})) day.model[prettyModel(model)] = (day.model[prettyModel(model)] || 0) + n
    for (const [project, n] of Object.entries(row.p || {})) day.project[project] = (day.project[project] || 0) + n
  }
  return days
}

const bySize = map => Object.entries(map).sort((a, b) => b[1] - a[1])

function rawRows(days) {
  const dimension = { total: L.csvDimTotal, model: L.csvDimModel, project: L.csvDimProject, type: L.csvDimType }
  const kindName = { r: L.kindCacheRead, w: L.kindCacheWrite, i: L.kindInput, o: L.kindOutput }
  const rows = [[L.csvDate, L.csvDimension, L.csvName, L.csvTokens]]
  for (const date of Object.keys(days).sort()) {
    const day = days[date]
    rows.push([date, dimension.total, '', groupNum(day.total)])
    for (const [name, n] of bySize(day.model)) rows.push([date, dimension.model, name, groupNum(n)])
    for (const [name, n] of bySize(day.project)) rows.push([date, dimension.project, name, groupNum(n)])
    for (const [key, n] of bySize(day.kind)) if (n > 0) rows.push([date, dimension.type, kindName[key] || key, groupNum(n)])
  }
  return rows
}

function tableRows(days, dimension) {
  const dates = Object.keys(days).sort()
  const sums = {}
  for (const date of dates) for (const [name, n] of Object.entries(days[date][dimension])) sums[name] = (sums[name] || 0) + n
  const columns = bySize(sums).slice(0, MAX_COLUMNS).map(([name]) => name)

  const rows = [[L.csvDate, L.csvTotal, ...columns, L.csvOther]]
  const columnTotals = new Array(columns.length).fill(0)
  let grandTotal = 0
  let otherTotal = 0
  for (const date of dates) {
    const day = days[date]
    const values = columns.map(name => day[dimension][name] || 0)
    const other = Math.max(0, day.total - values.reduce((a, b) => a + b, 0))
    rows.push([date, groupNum(day.total), ...values.map(groupNum), groupNum(other)])
    values.forEach((value, i) => (columnTotals[i] += value))
    grandTotal += day.total
    otherTotal += other
  }
  rows.push([L.csvTotal, groupNum(grandTotal), ...columnTotals.map(groupNum), groupNum(otherTotal)])
  return rows
}

function csvCell(value, delimiter) {
  const text = String(value)
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text
  return safe.includes(delimiter) || /["\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

function toCsv(rows, delimiter) {
  return '﻿' + rows.map(row => row.map(cell => csvCell(cell, delimiter)).join(delimiter)).join('\r\n') + '\r\n'
}

function buildCsv(raw, kind) {
  const days = aggregateByDay(raw)
  const rows = kind === 'long' ? rawRows(days) : tableRows(days, kind)
  return toCsv(rows, csvDelimiter())
}

module.exports = { buildCsv, csvDelimiter }
