const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')
const read = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'))
const manifest = read('package.json')
const english = read('package.nls.json')
const russian = read('package.nls.ru.json')

const placeholders = value => {
  if (typeof value === 'string') return [...value.matchAll(/^%(.+)%$/g)].map(match => match[1])
  if (Array.isArray(value)) return value.flatMap(placeholders)
  if (value && typeof value === 'object') return Object.values(value).flatMap(placeholders)
  return []
}

test('nls: every placeholder in the manifest has an English and a Russian text', () => {
  const used = placeholders(manifest)
  assert.ok(used.length > 20)
  for (const key of used) {
    assert.ok(english[key], `missing in English: ${key}`)
    assert.ok(russian[key], `missing in Russian: ${key}`)
  }
})

test('nls: both files hold the same keys and no unused ones', () => {
  assert.deepEqual(Object.keys(english).sort(), Object.keys(russian).sort())
  const used = new Set(placeholders(manifest))
  for (const key of Object.keys(english)) assert.ok(used.has(key), `unused key: ${key}`)
})

test('nls: Russian texts are translated, not copied', () => {
  const copied = Object.keys(english).filter(key => english[key] === russian[key] && /[a-z]{4}/i.test(english[key]))
  assert.ok(copied.length <= 4, `untranslated: ${copied.join(', ')}`)
  assert.ok(Object.values(russian).some(text => /[а-я]/i.test(text)))
})

test('nls: every contributed command is registered by the extension', () => {
  const declared = manifest.contributes.commands.map(command => command.command).sort()
  const source = fs.readFileSync(path.join(root, 'src', 'extension.js'), 'utf8')
  for (const id of declared) assert.ok(source.includes(`'${id}'`), `not registered: ${id}`)
})
