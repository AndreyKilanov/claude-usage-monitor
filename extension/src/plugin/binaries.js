const vscode = require('vscode')
const fs = require('fs')
const os = require('os')
const path = require('path')
const cp = require('child_process')

const EDITOR_DIRS = /^\.(vscode|cursor|windsurf|antigravity|vscodium|positron)/i

function findClaudeBinaries() {
  const exe = process.platform === 'win32' ? 'claude.exe' : 'claude'
  const found = []
  const add = file => {
    try {
      const stat = fs.statSync(file)
      if (stat.isFile()) found.push({ file, time: stat.mtimeMs })
    } catch {}
  }

  try {
    for (const extension of vscode.extensions.all || []) {
      if (/claude-code/i.test(extension.id)) add(path.join(extension.extensionPath, 'resources', 'native-binary', exe))
    }
  } catch {}

  const home = os.homedir()
  let editors = []
  try { editors = fs.readdirSync(home).filter(name => EDITOR_DIRS.test(name)) } catch {}
  for (const editor of editors) {
    const extensionsDir = path.join(home, editor, 'extensions')
    let names = []
    try { names = fs.readdirSync(extensionsDir).filter(name => /^anthropic\.claude-code-/i.test(name)) } catch {}
    for (const name of names) add(path.join(extensionsDir, name, 'resources', 'native-binary', exe))
  }

  const seen = new Set()
  return found
    .sort((a, b) => b.time - a.time)
    .map(entry => entry.file)
    .filter(file => (seen.has(file) ? false : seen.add(file)))
}

const run = (file, args) =>
  new Promise(resolve => {
    cp.execFile(file, args, { timeout: 120_000, windowsHide: true, maxBuffer: 1 << 20 }, (err, stdout, stderr) => {
      resolve({ ok: !err, out: `${stdout || ''}${stderr || ''}`.trim(), err })
    })
  })

module.exports = { findClaudeBinaries, run }
