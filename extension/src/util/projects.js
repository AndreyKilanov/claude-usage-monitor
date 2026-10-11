const vscode = require('vscode')

const folderName = path => String(path || '').split(/[\\/]/).filter(Boolean).pop() || null

function fileProject(data) {
  if (typeof data.project === 'string' && data.project) return data.project
  const sums = {}
  const detail = data.detail && typeof data.detail === 'object' ? Object.values(data.detail) : []
  for (const hour of detail) {
    for (const [name, tokens] of Object.entries((hour && hour.p) || {})) {
      if (Number(tokens) > 0) sums[name] = (sums[name] || 0) + Number(tokens)
    }
  }
  const best = Object.entries(sums).sort((a, b) => b[1] - a[1])[0]
  return best ? best[0] : null
}

const sameProject = (a, b) => !!a && !!b && String(a).toLowerCase() === String(b).toLowerCase()

function workspaceProject() {
  try {
    const folders = vscode.workspace.workspaceFolders
    return folders && folders.length ? folderName(folders[0].uri.fsPath) : null
  } catch {
    return null
  }
}

module.exports = { folderName, fileProject, sameProject, workspaceProject }
