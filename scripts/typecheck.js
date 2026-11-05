#!/usr/bin/env node
// Type-checks the extension's JavaScript (files marked `// @ts-check`) with TypeScript, emitting nothing.
// The project has no dependencies, so this looks for TypeScript, @types/node and the VS Code API
// types first in node_modules, then inside an installed editor (VS Code, Antigravity, Cursor, VSCodium),
// which ships all three. Nothing is downloaded. Set TYPESCRIPT_DIR / VSCODE_DTS / NODE_TYPES_DIR to override.
const fs = require('fs')
const os = require('os')
const path = require('path')

const repo = path.join(__dirname, '..')
const src = path.join(repo, 'extension', 'src')

function editorRoots() {
  const roots = []
  const local = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local')
  for (const name of ['Microsoft VS Code', 'Antigravity IDE', 'Antigravity', 'cursor', 'VSCodium']) {
    roots.push(path.join(local, 'Programs', name, 'resources', 'app'))
  }
  for (const name of ['Visual Studio Code', 'Antigravity', 'Cursor', 'VSCodium']) {
    roots.push(path.join('/Applications', `${name}.app`, 'Contents', 'Resources', 'app'))
  }
  roots.push('/usr/share/code/resources/app', '/opt/visual-studio-code/resources/app', '/usr/lib/code/resources/app')
  return roots.filter(root => fs.existsSync(root))
}

function firstExisting(candidates) {
  return candidates.find(candidate => candidate && fs.existsSync(candidate)) || null
}

const roots = editorRoots()
const tsDir = firstExisting([
  process.env.TYPESCRIPT_DIR,
  path.join(repo, 'node_modules', 'typescript'),
  ...roots.map(root => path.join(root, 'extensions', 'node_modules', 'typescript')),
])
const vscodeDts = firstExisting([
  process.env.VSCODE_DTS,
  path.join(repo, 'node_modules', '@types', 'vscode', 'index.d.ts'),
  ...roots.map(root => path.join(root, 'out', 'vscode-dts', 'vscode.d.ts')),
])
// some editors ship @types/node stripped down to its package.json, so the definitions must be there
const nodeTypes = firstExisting([
  process.env.NODE_TYPES_DIR,
  path.join(repo, 'node_modules', '@types', 'node'),
  ...roots.map(root => path.join(root, 'node_modules', '@types', 'node')),
].filter(dir => dir && fs.existsSync(path.join(dir, 'index.d.ts'))))

const missing = [!tsDir && 'typescript', !vscodeDts && 'vscode.d.ts', !nodeTypes && '@types/node'].filter(Boolean)
if (missing.length) {
  console.error(`typecheck: could not find ${missing.join(', ')}. Install an editor based on VS Code, or run`)
  console.error('  npm i --no-save typescript @types/node @types/vscode')
  process.exit(2)
}

const ts = require(path.join(tsDir, 'lib', 'typescript.js'))

const files = []
const walk = dir => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full)
    else if (entry.name.endsWith('.js')) files.push(full)
  }
}
walk(src)

const unmarked = files.filter(file => !fs.readFileSync(file, 'utf8').startsWith('// @ts-check'))
if (unmarked.length) {
  console.error('typecheck: every file in extension/src must start with "// @ts-check":')
  for (const file of unmarked) console.error(`  ${path.relative(repo, file)}`)
  process.exit(1)
}

const program = ts.createProgram([...files, vscodeDts], {
  allowJs: true,
  checkJs: false, // only files that opt in with // @ts-check
  noEmit: true,
  target: ts.ScriptTarget.ES2022,
  lib: ['lib.es2022.d.ts'],
  module: ts.ModuleKind.CommonJS,
  moduleResolution: ts.ModuleResolutionKind.Node10,
  resolveJsonModule: true,
  types: ['node'],
  typeRoots: [path.dirname(nodeTypes)],
  strictNullChecks: true,
  noImplicitAny: false,
  skipLibCheck: true,
})

const diagnostics = ts.getPreEmitDiagnostics(program).filter(d => !d.file || d.file.fileName.startsWith(src.replace(/\\/g, '/')))
for (const d of diagnostics) {
  const message = ts.flattenDiagnosticMessageText(d.messageText, '\n')
  if (d.file && d.start !== undefined) {
    const { line, character } = d.file.getLineAndCharacterOfPosition(d.start)
    console.log(`${path.relative(repo, d.file.fileName)}:${line + 1}:${character + 1} ${message}`)
  } else console.log(message)
}
console.log(`typecheck: ${files.length} files, ${diagnostics.length} problem(s) (TypeScript ${ts.version})`)
process.exit(diagnostics.length ? 1 : 0)
