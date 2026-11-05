// @ts-check
const PID = /^[0-9a-f]{8}$/

const validPid = value => (typeof value === 'string' && PID.test(value) ? value : null)
const ownName = data => (typeof data.project === 'string' && data.project ? data.project : null)
const parentOf = data => (typeof data.parent === 'string' && data.parent ? data.parent : null)

/**
 * Labels for projects. Two different folders with the same name (two clients' `api`) are told apart
 * by the fingerprint the plugin writes (`pid`) and labelled with their parent folder: `api (client-a)`.
 *
 * The same project on two devices sits at two different paths, so fingerprints only compare within
 * one device: a name is ambiguous when one device has two folders with it. Then the parent folder
 * name is what links a device's folder to another device's. A name no device uses twice keeps its
 * plain name everywhere, as do files from plugins before 0.7.0, which carry no fingerprint.
 *
 * @param {{ d: any, machine?: string }[]} sessions
 */
function projectLabels(sessions) {
  /** @type {Map<string, Map<string, Map<string, string | null>>>} name (lower case) → device → fingerprint → parent */
  const names = new Map()
  for (const { d: data, machine } of sessions) {
    const name = ownName(data)
    const pid = validPid(data.pid)
    if (!name || !pid) continue
    const key = name.toLowerCase()
    if (!names.has(key)) names.set(key, new Map())
    const devices = names.get(key)
    if (!devices) continue
    const device = String(machine || '')
    if (!devices.has(device)) devices.set(device, new Map())
    devices.get(device)?.set(pid, parentOf(data))
  }

  /** @param {string | null} name */
  const ambiguous = name => {
    const devices = name ? names.get(name.toLowerCase()) : null
    return !!devices && [...devices.values()].some(folders => folders.size > 1)
  }

  /**
   * @param {string} name
   * @param {string | null} pid
   * @param {string | null} parent
   * @param {string} [machine]
   */
  const labelOf = (name, pid, parent, machine = '') => {
    if (!pid || !ambiguous(name)) return name
    const folders = names.get(name.toLowerCase())?.get(String(machine)) || new Map()
    // two folders on one device with the same parent name too (D:\x\src\api, E:\x\src\api) need a piece of the fingerprint
    const twin = parent !== null && [...folders.entries()].some(([other, otherParent]) => other !== pid && otherParent === parent)
    if (parent === null) return `${name} (${pid.slice(0, 4)})`
    return twin ? `${name} (${parent} · ${pid.slice(0, 4)})` : `${name} (${parent})`
  }

  /**
   * How to rename one session file's project keys, or null when its names stay as they are.
   * @param {any} data
   * @param {string} [machine]
   * @returns {((key: string) => string) | null}
   */
  const forSession = (data, machine = '') => {
    const own = ownName(data)
    const pid = validPid(data.pid)
    if (!own || !pid) return null
    const label = labelOf(own, pid, parentOf(data), machine)
    return label === own ? null : key => (key === own ? label : key)
  }

  return { labelOf, forSession, ambiguous }
}

/**
 * Whether a session file belongs to the project open in the editor. This device's files compare by
 * fingerprint; other devices' files (another path for the same project) and older files compare by
 * folder name, and by parent folder too when the name is ambiguous.
 * @param {any} data
 * @param {{ name: string | null, pid: string | null, parent?: string | null }} project
 * @param {{ local: boolean, nameOf: (data: any) => string | null, sameName: (a: string | null, b: string | null) => boolean, ambiguous: (name: string | null) => boolean }} how
 */
function belongsTo(data, project, how) {
  const pid = validPid(data.pid)
  if (how.local && pid && project.pid) return pid === project.pid
  if (!how.sameName(how.nameOf(data), project.name)) return false
  if (!pid || !project.parent || !how.ambiguous(project.name)) return true
  const parent = parentOf(data)
  return !parent || parent.toLowerCase() === project.parent.toLowerCase()
}

module.exports = { projectLabels, belongsTo, validPid }
