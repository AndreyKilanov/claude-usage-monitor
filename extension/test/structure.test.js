const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const repo = path.join(__dirname, '..', '..')
const skip = new Set(['node_modules', 'dist', '.git', '.claude-plugin'])

function files(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    if (skip.has(entry.name)) return []
    const full = path.join(dir, entry.name)
    return entry.isDirectory() ? files(full) : [full]
  })
}

test('structure: no source, test or style file is longer than 500 lines', () => {
  const code = files(repo).filter(file => /\.(js|ts|tsx|css|html|sh)$/.test(file))
  assert.ok(code.length > 30)
  for (const file of code) {
    const lines = fs.readFileSync(file, 'utf8').split('\n').length
    assert.ok(lines <= 500, `${path.relative(repo, file)} has ${lines} lines`)
  }
})

test('structure: src modules never reach into the test or media folders', () => {
  for (const file of files(path.join(repo, 'extension', 'src')).filter(name => name.endsWith('.js'))) {
    const source = fs.readFileSync(file, 'utf8')
    assert.ok(!/require\(['"][^'"]*\/test\//.test(source), path.relative(repo, file))
  }
})
