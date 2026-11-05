// @ts-check
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
    const day = (days[key] = days[key] || { total: 0, cost: 0, model: {}, project: {}, kind: {} })
    day.total += row.v
    day.cost += Number(row.c) > 0 ? Number(row.c) : 0
    for (const [kind, n] of Object.entries(row.k || {})) day.kind[kind] = (day.kind[kind] || 0) + (Number(n) > 0 ? Number(n) : 0)
    for (const [model, n] of Object.entries(row.m || {})) day.model[prettyModel(model)] = (day.model[prettyModel(model)] || 0) + n
    for (const [project, n] of Object.entries(row.p || {})) day.project[project] = (day.project[project] || 0) + n
  }
  return days
}

const bySize = map => Object.entries(map).sort((a, b) => b[1] - a[1])

const hasCost = days => Object.values(days).some(day => day.cost > 0)

// a decimal comma where the cells are split by ';' or tabs in a Russian Excel, a point otherwise
function moneyCell(usd, delimiter) {
  const decimal = delimiter !== ',' && isRussian() ? ',' : '.'
  return usd.toFixed(2).replace('.', decimal)
}

function rawRows(days, delimiter) {
  const dimension = { total: L.csvDimTotal, model: L.csvDimModel, project: L.csvDimProject, type: L.csvDimType }
  const kindName = { r: L.kindCacheRead, w: L.kindCacheWrite, i: L.kindInput, o: L.kindOutput }
  const withCost = hasCost(days)
  const rows = [[L.csvDate, L.csvDimension, L.csvName, withCost ? L.csvValue : L.csvTokens]]
  for (const date of Object.keys(days).sort()) {
    const day = days[date]
    rows.push([date, dimension.total, '', groupNum(day.total)])
    if (withCost && day.cost > 0) rows.push([date, L.csvDimCost, '', moneyCell(day.cost, delimiter)])
    for (const [name, n] of bySize(day.model)) rows.push([date, dimension.model, name, groupNum(n)])
    for (const [name, n] of bySize(day.project)) rows.push([date, dimension.project, name, groupNum(n)])
    for (const [key, n] of bySize(day.kind)) if (n > 0) rows.push([date, dimension.type, kindName[key] || key, groupNum(n)])
  }
  return rows
}

function tableRows(days, dimension, delimiter) {
  const dates = Object.keys(days).sort()
  const sums = {}
  for (const date of dates) for (const [name, n] of Object.entries(days[date][dimension])) sums[name] = (sums[name] || 0) + n
  const columns = bySize(sums).slice(0, MAX_COLUMNS).map(([name]) => name)
  const withCost = hasCost(days)
  const costCell = usd => (withCost ? [moneyCell(usd, delimiter)] : [])

  const rows = [[L.csvDate, L.csvTotal, ...columns, L.csvOther, ...(withCost ? [L.csvCost] : [])]]
  const columnTotals = new Array(columns.length).fill(0)
  let grandTotal = 0
  let otherTotal = 0
  let costTotal = 0
  for (const date of dates) {
    const day = days[date]
    const values = columns.map(name => day[dimension][name] || 0)
    const other = Math.max(0, day.total - values.reduce((a, b) => a + b, 0))
    rows.push([date, groupNum(day.total), ...values.map(groupNum), groupNum(other), ...costCell(day.cost)])
    values.forEach((value, i) => (columnTotals[i] += value))
    grandTotal += day.total
    otherTotal += other
    costTotal += day.cost
  }
  rows.push([L.csvTotal, groupNum(grandTotal), ...columnTotals.map(groupNum), groupNum(otherTotal), ...costCell(costTotal)])
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
  const delimiter = csvDelimiter()
  const rows = kind === 'long' ? rawRows(days, delimiter) : tableRows(days, kind, delimiter)
  return toCsv(rows, delimiter)
}

module.exports = { buildCsv, csvDelimiter }
