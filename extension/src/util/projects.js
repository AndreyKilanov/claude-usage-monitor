// @ts-check
const vscode = require('vscode')

/** @param {unknown} path */
const folderName = path => String(path || '').split(/[\\/]/).filter(Boolean).pop() || null

/**
 * The session's project folder name: what the plugin wrote, or, in older files, the folder with most tokens.
 * @param {any} data
 * @returns {string | null}
 */
function fileProject(data) {
  if (typeof data.project === 'string' && data.project) return data.project
  /** @type {Record<string, number>} */
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

/**
 * @param {string | null} a
 * @param {string | null} b
 */
const sameProject = (a, b) => !!a && !!b && String(a).toLowerCase() === String(b).toLowerCase()

/**
 * The one-way fingerprint of a folder path the plugin writes as `pid` (FNV-1a, 32 bits, 8 hex digits)
 * of the path with forward slashes, no trailing slash, in lower case. Must stay in step with
 * `projectId` in plugin/hooks/register.ts.
 * @param {string} path
 */
function projectId(path) {
  const normal = String(path).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
  let hash = 0x811c9dc5
  for (let i = 0; i < normal.length; i++) {
    hash ^= normal.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

/**
 * The project open in this editor window: its folder name, fingerprint and parent folder name.
 * @returns {{ name: string, pid: string, parent: string | null } | null}
 */
function workspaceWhere() {
  try {
    const folders = vscode.workspace.workspaceFolders
    if (!folders || !folders.length) return null
    const path = folders[0].uri.fsPath
    const parts = String(path).split(/[\\/]/).filter(Boolean)
    const name = parts.length ? parts[parts.length - 1] : null
    return name ? { name, pid: projectId(path), parent: parts.length > 1 ? parts[parts.length - 2] : null } : null
  } catch {
    return null
  }
}

const workspaceProject = () => {
  const where = workspaceWhere()
  return where ? where.name : null
}

module.exports = { folderName, fileProject, sameProject, projectId, workspaceWhere, workspaceProject }
