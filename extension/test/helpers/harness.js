const test = require('node:test')
const fs = require('fs')
const os = require('os')
const path = require('path')
const Module = require('module')

const SRC = path.join(__dirname, '..', '..', 'src')
const live = []

test.afterEach(() => {
  for (const instance of live.splice(0)) instance.stop()
})

function freshLog() {
  return {
    warn: [], error: [], info: [], offers: [], offered: [], executed: [], calls: [], panels: [], posted: [],
    saved: null, clip: null, opened: null, pick: undefined, confirm: undefined, offerChoice: undefined,
    errorChoice: undefined, openPick: undefined, folders: undefined, extensions: [], onMessage: null, plan: () => ({}),
  }
}

function fakeEditor({ lang, config }, log, items, commands) {
  return {
    env: {
      language: lang,
      clipboard: { writeText: async value => { log.clip = value } },
      openExternal: async uri => { log.opened = uri.value },
    },
    workspace: {
      get workspaceFolders() { return log.folders },
      getConfiguration: () => ({ get: (key, fallback) => (key in config ? config[key] : fallback) }),
      onDidChangeConfiguration: () => ({ dispose() {} }),
    },
    window: {
      createStatusBarItem: () => {
        const item = { show() {}, dispose() {} }
        items.push(item)
        return item
      },
      createWebviewPanel: () => {
        const panel = {
          webview: {
            postMessage: message => { log.posted.push(message) },
            onDidReceiveMessage: callback => { log.onMessage = callback },
            set html(value) { panel.html = value },
          },
          onDidDispose() {},
          reveal() {},
        }
        log.panels.push(panel)
        return panel
      },
      showWarningMessage: (message, ...rest) => {
        log.warn.push(message)
        return Promise.resolve(rest.length ? log.confirm : undefined)
      },
      showErrorMessage: message => {
        log.error.push(message)
        return Promise.resolve(log.errorChoice)
      },
      showInformationMessage: (message, ...buttons) => {
        if (buttons.length) {
          log.offers.push({ m: message, btns: buttons })
          return Promise.resolve(log.offerChoice)
        }
        log.info.push(message)
        return Promise.resolve()
      },
      showQuickPick: async (list, options) => {
        log.offered.push({ ids: list.map(entry => entry.id), placeHolder: options && options.placeHolder })
        return log.pick === null ? undefined : list.find(entry => entry.id === (log.pick || 'model'))
      },
      showSaveDialog: async () => (log.saved ? { fsPath: log.saved } : undefined),
      showOpenDialog: async () => (log.openPick ? [{ fsPath: log.openPick }] : undefined),
      withProgress: (_options, task) => task(),
    },
    StatusBarAlignment: { Right: 1 },
    ThemeColor: class { constructor(id) { this.id = id } },
    MarkdownString: class { constructor(value) { this.value = value } },
    commands: {
      registerCommand: (name, handler) => { commands[name] = handler; return { dispose() {} } },
      executeCommand: (...args) => { log.executed.push(args) },
    },
    ViewColumn: { Beside: 2 },
    ProgressLocation: { Notification: 15 },
    extensions: { get all() { return log.extensions } },
    Uri: { file: fsPath => ({ fsPath }), parse: value => ({ value }) },
  }
}

function loadExtension(editor, log) {
  const fakeChildProcess = {
    execFile: (file, args, _options, callback) => {
      log.calls.push({ file, args })
      const result = log.plan(args) || {}
      setImmediate(() => callback(result.err || null, result.stdout || '', result.stderr || ''))
    },
  }
  const original = Module._load
  Module._load = function (request, ...rest) {
    if (request === 'vscode') return editor
    if (request === 'child_process') return fakeChildProcess
    return original.call(this, request, ...rest)
  }
  for (const key of Object.keys(require.cache)) if (key.startsWith(SRC)) delete require.cache[key]
  try {
    return require(path.join(SRC, 'extension'))
  } finally {
    Module._load = original
  }
}

function setup({ lang = 'en', config = {}, store = {} } = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cum-'))
  process.env.HOME = home
  const sessDir = path.join(home, '.claude', 'usage-monitor')
  fs.mkdirSync(sessDir, { recursive: true })

  const log = freshLog()
  const items = []
  const cmds = {}
  const extension = loadExtension(fakeEditor({ lang, config }, log, items, cmds), log)
  const context = {
    subscriptions: [],
    globalState: { get: (key, fallback) => (key in store ? store[key] : fallback), update: (key, value) => { store[key] = value } },
  }

  const api = {
    home, sessDir, log, items, cmds, store,
    mod: relative => require(path.join(SRC, relative)),
    start() {
      extension.activate(context)
      live.push(api)
      return api
    },
    write(name, data, dir = sessDir) {
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(path.join(dir, name), typeof data === 'string' ? data : JSON.stringify(data))
    },
    text: () => items[0].text,
    tooltip: () => items[0].tooltip.value || items[0].tooltip,
    refresh: () => cmds['claudeUsage.refresh'](),
    flush: () => new Promise(resolve => setTimeout(resolve, 40)),
    stop() { context.subscriptions.forEach(entry => entry.dispose && entry.dispose()) },
  }
  return api
}

function payloadOf(instance) {
  instance.cmds['claudeUsage.open']()
  instance.refresh()
  return instance.log.posted.at(-1).data
}

function withoutPlugin(options = {}) {
  const instance = setup(options)
  fs.rmSync(instance.sessDir, { recursive: true })
  instance.mod('plugin/offer').setOfferDelay(0)
  return instance
}

const exeName = process.platform === 'win32' ? 'claude.exe' : 'claude'

function fakeClaude(home, editorDir, version) {
  const dir = path.join(home, editorDir, 'extensions', `anthropic.claude-code-${version}`, 'resources', 'native-binary')
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, exeName)
  fs.writeFileSync(file, 'x')
  return file
}

const writeClaudeSettings = (instance, data) =>
  fs.writeFileSync(path.join(instance.home, '.claude', 'settings.json'), typeof data === 'string' ? data : JSON.stringify(data))

module.exports = { setup, payloadOf, withoutPlugin, fakeClaude, exeName, writeClaudeSettings }
