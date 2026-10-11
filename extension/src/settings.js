const vscode = require('vscode')

const cfg = (key, fallback) => vscode.workspace.getConfiguration('claudeUsage').get(key, fallback)

module.exports = { cfg }
