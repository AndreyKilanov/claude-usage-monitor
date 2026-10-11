const vscode = require('vscode')
const { cfg } = require('../settings')
const ru = require('./ru')
const en = require('./en')

const L = { ...en }
let russian = false

function pickLocale() {
  const choice = cfg('language', 'auto')
  const language = String(choice === 'auto' ? vscode.env.language : choice).toLowerCase()
  russian = language.startsWith('ru')
  for (const key of Object.keys(L)) delete L[key]
  Object.assign(L, russian ? ru : en)
}

module.exports = { L, pickLocale, isRussian: () => russian, dictionaries: { ru, en } }
