const vscode = require('vscode')
const fs = require('fs')
const os = require('os')
const path = require('path')
const crypto = require('crypto')
const cp = require('child_process')

const DIR = path.join(os.homedir(), '.claude')
const SESS = path.join(DIR, 'usage-monitor')
const DAY = 86400_000
const KEEP_DAYS = 36

// local midnight, `back` days before `now`; built from the calendar so a 23 / 25-hour day cannot shift it
const dayStart = (now, back) => {
  const d = new Date(now)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - back).getTime()
}

const STR = {
  ru: {
    noData: 'Claude: нет данных',
    noDataTip: 'Цифры появятся после первого ответа Claude (мод usage-monitor)',
    noFolder: 'Папка не найдена — плагин ещё ничего не записал. Поставьте плагин и начните новую сессию Claude:',
    noFiles: 'Папка есть, но файлов сессий пока нет. Отправьте сообщение в НОВОЙ сессии Claude (плагин должен быть установлен и включён).',
    noReadable: 'Файлы сессий есть, но их не удалось прочитать (повреждены или не те права доступа).',
    lookingIn: 'Ищу данные в:',
    setupTitle: 'Установить плагин usage-monitor',
    setupAsk: 'Установить плагин usage-monitor для Claude Code?\n\nБудут выполнены две команды встроенной копии Claude Code:\n• plugin marketplace add AndreyKilanov/claude-usage-monitor\n• plugin install usage-monitor --scope user\n\nПлагин берётся с GitHub (AndreyKilanov/claude-usage-monitor) и только записывает цифры лимитов и токенов в папку ~/.claude/usage-monitor.',
    setupYes: 'Установить', setupBusy: 'Устанавливаю плагин…',
    setupDone: 'Плагин установлен. Начните НОВУЮ сессию Claude и отправьте сообщение — цифры появятся после первого ответа.',
    setupNoClaude: 'Не нашёл Claude Code на этой машине. Установите расширение Claude Code (или укажите claude вручную) и повторите.',
    setupPick: 'Указать claude вручную…',
    setupFail: 'Не удалось установить плагин:',
    setupClick: 'Нажмите, чтобы установить плагин автоматически.',
    pluginSays: 'Записка плагина:',
    pluginSilent: 'Плагин на этой машине не оставил записки: он не установлен, не включён или эта версия Claude не запускает модули плагинов. Выполните /plugin в Claude Code и проверьте, что usage-monitor включён.',
    h5: '5ч', week: 'нед', today: 'сегодня',
    title: 'Claude — расход', win5: 'Окно 5 часов', winWeek: 'Неделя',
    sonnet: 'Неделя · Sonnet', opus: 'Неделя · Opus', spend: 'Лимит трат', other: 'Лимит',
    resets: 'сброс через', resetsCap: 'Сброс через', noReset: 'Нет данных о сбросе',
    todayLine: 'Сегодня', tokens: 'токенов', sessions: 'сессий',
    curSession: 'Текущая сессия', updated: 'Обновлено',
    forecast: 'При таком темпе лимит 5 часов закончится через',
    warnMsg: (name, p) => `Claude: ${name} — израсходовано ${p}%`,
    critMsg: (name, p) => `Claude: ${name} — ${p}%, лимит почти исчерпан`,
    resetMsg: name => `Claude: ${name} — лимит сброшен, можно продолжать`,
    note: 'Проценты — по всему аккаунту. Токены включают кэш-чтения, поэтому цифра большая; ориентируйтесь на проценты.',
    tabToday: 'Сегодня', tab7: '7 дней', tab30: '30 дней',
    byModel: 'По моделям', byProject: 'По проектам', noBreakdown: 'Пока нет данных', perDay: 'в день', total: 'Всего',
    devices: 'устройств', exportCsv: 'Экспорт CSV', csvDone: 'Сохранено', csvNone: 'Нет данных для экспорта',
    csvPick: 'Какую таблицу сохранить?',
    csvByModel: 'По дням и моделям', csvByModelHint: 'Дата, всего и колонка на каждую модель — удобно открыть в Excel или Numbers',
    csvByProject: 'По дням и проектам', csvByProjectHint: 'Дата, всего и колонка на каждый проект',
    csvLong: 'Сырые данные', csvLongHint: 'Одна строка на срез (для сводных таблиц)',
    csvDate: 'Дата', csvTotal: 'Всего', csvOther: 'Прочее', csvDimension: 'Срез', csvName: 'Название', csvTokens: 'Токены',
    csvDimTotal: 'всего', csvDimModel: 'модель', csvDimProject: 'проект',
    syncOn: 'Синхронизация включена', min: 'мин', h: 'ч', d: 'д',
    days: ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'], locale: 'ru-RU',
  },
  en: {
    noData: 'Claude: no data',
    noDataTip: 'Numbers appear after the first Claude reply (usage-monitor mod)',
    noFolder: 'Folder not found — the plugin has not written anything yet. Install the plugin and start a new Claude session:',
    noFiles: 'The folder exists but has no session files yet. Send a message in a NEW Claude session (the plugin must be installed and enabled).',
    noReadable: 'Session files exist but could not be read (damaged, or no permission).',
    lookingIn: 'Looking for data in:',
    setupTitle: 'Install the usage-monitor plugin',
    setupAsk: 'Install the usage-monitor plugin for Claude Code?\n\nTwo commands will run with the Claude Code copy bundled in your editor:\n• plugin marketplace add AndreyKilanov/claude-usage-monitor\n• plugin install usage-monitor --scope user\n\nThe plugin comes from GitHub (AndreyKilanov/claude-usage-monitor) and only writes limit and token numbers to ~/.claude/usage-monitor.',
    setupYes: 'Install', setupBusy: 'Installing the plugin…',
    setupDone: 'The plugin is installed. Start a NEW Claude session and send a message — numbers appear after the first reply.',
    setupNoClaude: 'Could not find Claude Code on this machine. Install the Claude Code extension (or point to claude manually) and try again.',
    setupPick: 'Choose claude manually…',
    setupFail: 'Could not install the plugin:',
    setupClick: 'Click to install the plugin automatically.',
    pluginSays: 'Note from the plugin:',
    pluginSilent: 'The plugin has left no note on this machine: it is not installed, not enabled, or this Claude version does not run plugin modules. Run /plugin in Claude Code and check that usage-monitor is enabled.',
    h5: '5h', week: 'wk', today: 'today',
    title: 'Claude — usage', win5: '5-hour window', winWeek: 'Week',
    sonnet: 'Week · Sonnet', opus: 'Week · Opus', spend: 'Spend limit', other: 'Limit',
    resets: 'resets in', resetsCap: 'Resets in', noReset: 'No reset time yet',
    todayLine: 'Today', tokens: 'tokens', sessions: 'sessions',
    curSession: 'Current session', updated: 'Updated',
    forecast: 'At this pace the 5-hour limit runs out in',
    warnMsg: (name, p) => `Claude: ${name} — ${p}% used`,
    critMsg: (name, p) => `Claude: ${name} is almost used up — ${p}%`,
    resetMsg: name => `Claude: ${name} limit has reset, you can continue`,
    note: 'Percentages cover your whole account. Tokens include cache reads, so the number is large; go by the percentages.',
    tabToday: 'Today', tab7: '7 days', tab30: '30 days',
    byModel: 'By model', byProject: 'By project', noBreakdown: 'No data yet', perDay: 'per day', total: 'Total',
    devices: 'devices', exportCsv: 'Export CSV', csvDone: 'Saved', csvNone: 'Nothing to export',
    csvPick: 'Which table to save?',
    csvByModel: 'By day and model', csvByModelHint: 'Date, total and one column per model — opens cleanly in Excel or Numbers',
    csvByProject: 'By day and project', csvByProjectHint: 'Date, total and one column per project',
    csvLong: 'Raw rows', csvLongHint: 'One row per slice (for pivot tables)',
    csvDate: 'Date', csvTotal: 'Total', csvOther: 'Other', csvDimension: 'Dimension', csvName: 'Name', csvTokens: 'Tokens',
    csvDimTotal: 'total', csvDimModel: 'model', csvDimProject: 'project',
    syncOn: 'Sync is on', min: 'min', h: 'h', d: 'd',
    days: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], locale: 'en-US',
  },
}
let L = STR.en

const cfg = (k, d) => vscode.workspace.getConfiguration('claudeUsage').get(k, d)
const pickLocale = () => {
  const c = cfg('language', 'auto')
  L = String(c === 'auto' ? vscode.env.language : c).toLowerCase().startsWith('ru') ? STR.ru : STR.en
}

const num = v => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v))
// Excel in a Russian locale expects ';', most other tools ','
const csvDelimiter = () => {
  const v = cfg('csvDelimiter', 'auto')
  if (v === 'tab') return '\t'
  if (v === ',' || v === ';') return v
  return L === STR.ru ? ';' : ','
}

const pct = p => (num(p) === null ? '—' : `${Math.round(num(p))}%`)
// 13240843 -> "13 240 843" (a no-break space, which is also what Russian Excel / Numbers read as a thousands separator)
// or "13,240,843" / "13.240.843"; `auto` follows the interface language.
const groupNum = n => {
  const style = cfg('numberGrouping', 'auto')
  const v = Math.round(Number(n))
  if (!Number.isFinite(v)) return '0'
  const sep = { none: '', space: '\u00A0', dot: '.', comma: ',' }[style] ?? (L === STR.ru ? '\u00A0' : ',')
  const digits = String(Math.abs(v))
  return (v < 0 ? '-' : '') + (sep ? digits.replace(/\B(?=(\d{3})+(?!\d))/g, sep) : digits)
}

const tok = n => (!Number.isFinite(Number(n)) ? '0' : n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(Math.round(n || 0)))
const fmtMs = ms => {
  const m = Math.round(ms / 60000)
  if (m < 60) return `${Math.max(m, 1)} ${L.min}`
  const h = Math.floor(m / 60)
  return h < 48 ? `${h} ${L.h} ${m % 60} ${L.min}` : `${Math.floor(h / 24)} ${L.d} ${h % 24} ${L.h}`
}
const left = iso => {
  const ms = iso ? Date.parse(iso) - Date.now() : NaN
  return ms > 0 ? fmtMs(ms) : ''
}
const bar = (p, n = 12) => {
  const f = Math.max(0, Math.min(n, Math.round(((p || 0) / 100) * n)))
  return '▰'.repeat(f) + '▱'.repeat(n - f)
}
const levelOf = p => (p >= cfg('critAt', 90) ? 'crit' : p >= cfg('warnAt', 80) ? 'warn' : 'ok')

// "claude-haiku-5-5-20260101" -> "Haiku 5.5"
const prettyModel = id => {
  let s = String(id || 'unknown').replace(/^claude-/, '').replace(/-\d{8}$/, '').replace(/\[.*\]$/, '')
  s = s.replace(/(\d)-(\d)/g, '$1.$2').replace(/-/g, ' ')
  return s.charAt(0).toUpperCase() + s.slice(1)
}

const cache = new Map() // full path -> { mtimeMs, size, d }

function readJson(file) {
  try {
    const st = fs.statSync(file)
    const hit = cache.get(file)
    if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit.d
    const d = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (!d || typeof d !== 'object' || Array.isArray(d)) return null
    cache.set(file, { mtimeMs: st.mtimeMs, size: st.size, d })
    return d
  } catch {
    cache.delete(file)
    return null // missing, or half-written: skip it
  }
}

function readDir(dir, machine) {
  const out = []
  let files = []
  try {
    files = fs.readdirSync(dir).filter(f => f.endsWith('.json'))
  } catch {}
  for (const f of files) {
    const full = path.join(dir, f)
    const d = readJson(full)
    if (d) out.push({ full, name: f, d, machine })
  }
  return out
}

const syncRoot = () => {
  const raw = String(cfg('syncFolder', '') || '').trim()
  if (!raw) return ''
  return raw.startsWith('~') ? path.join(os.homedir(), raw.slice(1)) : raw
}

// This machine's sessions, plus the other machines' when a sync folder is set.
// A session id is unique, so a file seen twice (a mirror of our own, a reinstall) counts once: the fresher copy wins.
function scan(machineId) {
  const all = readDir(SESS, machineId)
  const sync = syncRoot()
  if (sync) {
    let dirs = []
    try {
      dirs = fs.readdirSync(sync, { withFileTypes: true }).filter(e => e.isDirectory() && e.name !== machineId)
    } catch {}
    for (const e of dirs) all.push(...readDir(path.join(sync, e.name), e.name))
  }
  const byName = new Map()
  for (const x of all) {
    const prev = byName.get(x.name)
    if (!prev || (x.d.updatedAt || 0) > (prev.d.updatedAt || 0)) byName.set(x.name, x)
  }
  return [...byName.values()]
}

// Copy this machine's session files into <sync>/<machineId>/ (write to a temp name, then rename).
function pushSync(machineId) {
  const sync = syncRoot()
  if (!sync) return
  try {
    if (!fs.statSync(sync).isDirectory()) return // an unmounted or mistyped folder is left alone, never created
  } catch {
    return
  }
  const dest = path.join(sync, machineId)
  try {
    fs.mkdirSync(dest, { recursive: true })
    for (const f of fs.readdirSync(SESS).filter(n => n.endsWith('.json'))) {
      const src = path.join(SESS, f)
      const target = path.join(dest, f)
      const st = fs.statSync(src)
      let same = false
      try { same = fs.statSync(target).mtimeMs >= st.mtimeMs } catch {}
      if (same) continue
      const body = fs.readFileSync(src)
      try { JSON.parse(body) } catch { continue }
      const tmp = `${target}.tmp`
      fs.writeFileSync(tmp, body)
      fs.renameSync(tmp, target)
      fs.utimesSync(target, st.atime, st.mtime)
    }
  } catch {}
}

// The limits are account-wide, so the freshest session that has a reading is the truth.
// Values are sanitized; a window whose reset time has passed since the reading is shown as empty, not stale.
function readLimits(sessions) {
  const has = x => num(x.d.fiveHour) !== null || num(x.d.sevenDay) !== null || (Array.isArray(x.d.limits) && x.d.limits.length > 0)
  const pool = sessions.filter(has)
  const newest = (pool.length ? pool : sessions).reduce((a, b) => (!a || (num(b.d.updatedAt) || 0) > (num(a.d.updatedAt) || 0) ? b : a), null)
  if (!newest) return null
  const d = newest.d
  const now = Date.now()
  const fresh = (p, iso) => {
    const v = num(p)
    const t = iso ? Date.parse(iso) : NaN
    if (v !== null && Number.isFinite(t) && t < now) return { p: 0, resetsAt: null }
    return { p: v, resetsAt: Number.isFinite(t) ? iso : null }
  }
  const five = fresh(d.fiveHour, d.fiveHourResetsAt)
  const week = fresh(d.sevenDay, d.sevenDayResetsAt)
  const limits = (Array.isArray(d.limits) ? d.limits : [])
    .filter(l => l && typeof l.kind === 'string' && num(l.percentUsed) !== null)
    .map(l => {
      const f = fresh(l.percentUsed, l.resetsAt)
      return { kind: String(l.kind).slice(0, 40), percentUsed: f.p, resetsAt: f.resetsAt }
    })
  return {
    fiveHour: five.p, fiveHourResetsAt: five.resetsAt, sevenDay: week.p, sevenDayResetsAt: week.resetsAt,
    limits, tokens: num(d.tokens) || 0, usd: num(d.usd), updatedAt: num(d.updatedAt) || 0,
  }
}

// every window the mod saw, five_hour and seven_day first
function windows(u) {
  const list = (u.limits || []).map(l => ({ kind: l.kind, p: l.percentUsed, resetsAt: l.resetsAt }))
  if (!list.length) {
    if (u.fiveHour !== null) list.push({ kind: 'five_hour', p: u.fiveHour, resetsAt: u.fiveHourResetsAt })
    if (u.sevenDay !== null) list.push({ kind: 'seven_day', p: u.sevenDay, resetsAt: u.sevenDayResetsAt })
  }
  const order = { five_hour: 0, seven_day: 1 }
  return list.sort((a, b) => (order[a.kind] ?? 9) - (order[b.kind] ?? 9))
}
const nameOf = kind =>
  ({ five_hour: L.win5, seven_day: L.winWeek, seven_day_sonnet: L.sonnet, seven_day_opus: L.opus, spend_limit: L.spend })[kind] || `${L.other} ${kind}`

// several dated ids of one model ("…-20260101", "…-20260301") count as one
const mergeModels = map => {
  const out = {}
  for (const [k, v] of Object.entries(map)) out[prettyModel(k)] = (out[prettyModel(k)] || 0) + v
  return out
}

const top = (map, n = 6) => {
  const rows = Object.entries(map).sort((a, b) => b[1] - a[1])
  const head = rows.slice(0, n)
  const rest = rows.slice(n).reduce((s, r) => s + r[1], 0)
  if (rest > 0) head.push(['…', rest])
  return head.map(([name, v]) => ({ name, v }))
}

// Tokens for every session on every device: today (by hour), 7 and 30 days (by day), and breakdowns.
function readTotals(list) {
  const now = Date.now()
  const midnight = dayStart(now, 0)
  const mk = n => ({ bars: [], total: 0, models: {}, projects: {} })
  const periods = { today: mk(), d7: mk(), d30: mk() }
  periods.today.bars = Array.from({ length: 24 }, (_, h) => ({ label: String(h), v: 0, cur: h === new Date().getHours() }))
  const dayBars = n => Array.from({ length: n }, (_, i) => {
    const start = dayStart(now, n - 1 - i)
    return { start, end: dayStart(now, n - 2 - i), label: L.days[new Date(start).getDay()], day: new Date(start).getDate(), v: 0, cur: i === n - 1 }
  })
  periods.d7.bars = dayBars(7)
  periods.d30.bars = dayBars(30)
  const raw = []
  let sessionsToday = 0
  const devices = new Set()
  for (const { full, d, machine } of list) {
    devices.add(machine)
    if (now - (num(d.updatedAt) || 0) > KEEP_DAYS * DAY) {
      if (full.startsWith(SESS)) { try { fs.unlinkSync(full) } catch {} }
      continue
    }
    let hitToday = false
    for (const [k, v0] of Object.entries(d.buckets && typeof d.buckets === 'object' ? d.buckets : {})) {
      const t = Number(k)
      const v = Number(v0)
      if (!Number.isFinite(t) || !(v > 0)) continue
      const det = d.detail && typeof d.detail === 'object' ? d.detail[k] : null
      raw.push({ t, v, m: det ? det.m : null, p: det ? det.p : null })
      const add = (per, bar) => {
        per.total += v
        if (bar) bar.v += v
        if (det) {
          for (const [m, n] of Object.entries(det.m || {})) if (Number(n) > 0) per.models[m] = (per.models[m] || 0) + Number(n)
          for (const [p, n] of Object.entries(det.p || {})) if (Number(n) > 0) per.projects[p] = (per.projects[p] || 0) + Number(n)
        }
      }
      if (t >= midnight) {
        hitToday = true
        add(periods.today, periods.today.bars[new Date(t).getHours()])
      }
      for (const [key, n] of [['d7', 7], ['d30', 30]]) {
        const bar = periods[key].bars.find(b => t >= b.start && t < b.end)
        if (bar) add(periods[key], bar)
      }
    }
    if (hitToday) sessionsToday++
  }
  return { periods, sessionsToday, devices: devices.size, raw }
}

// Time until the 5-hour window hits 100% at the pace of the last hour; null when there is no honest answer.
function forecast(history, u) {
  const now = Date.now()
  const pts = history.filter(s => now - s.t < 3600_000)
  if (pts.length < 2) return null
  const a = pts[0]
  const b = pts[pts.length - 1]
  const dt = b.t - a.t
  const dp = b.p - a.p
  if (dt < 180_000 || dp < 1 || b.p >= 100) return null
  const eta = ((100 - b.p) / dp) * dt
  const reset = u.fiveHourResetsAt ? Date.parse(u.fiveHourResetsAt) - now : Infinity
  return eta < reset ? eta : null
}

// Where a Claude Code binary may live: the Claude Code extension of any VS Code-style editor, newest first.
function findClaudeBinaries() {
  const exe = process.platform === 'win32' ? 'claude.exe' : 'claude'
  const found = []
  const add = f => { try { if (fs.statSync(f).isFile()) found.push({ f, t: fs.statSync(f).mtimeMs }) } catch {} }
  // 1. the extension the editor itself has loaded
  try {
    for (const e of vscode.extensions.all || []) {
      if (/claude-code/i.test(e.id)) add(path.join(e.extensionPath, 'resources', 'native-binary', exe))
    }
  } catch {}
  // 2. extension folders of the usual editors in the home directory
  const home = os.homedir()
  let roots = []
  try { roots = fs.readdirSync(home).filter(n => /^\.(vscode|cursor|windsurf|antigravity|vscodium|positron)/i.test(n)) } catch {}
  for (const r of roots) {
    const ext = path.join(home, r, 'extensions')
    let names = []
    try { names = fs.readdirSync(ext).filter(n => /^anthropic\.claude-code-/i.test(n)) } catch {}
    for (const n of names) add(path.join(ext, n, 'resources', 'native-binary', exe))
  }
  const seen = new Set()
  return found.sort((a, b) => b.t - a.t).map(x => x.f).filter(f => (seen.has(f) ? false : seen.add(f)))
}

const run = (file, args) =>
  new Promise(resolve => {
    cp.execFile(file, args, { timeout: 120_000, windowsHide: true, maxBuffer: 1 << 20 }, (err, stdout, stderr) => {
      resolve({ ok: !err, out: `${stdout || ''}${stderr || ''}`.trim(), err })
    })
  })

// The plugin leaves diagnostics.txt in its own folder (under ~/.claude/plugins/...). Find it without walking the whole disk.
function findPluginNote() {
  const root = path.join(DIR, 'plugins')
  const stack = [[root, 0]]
  let seen = 0
  while (stack.length && seen < 3000) {
    const [dir, depth] = stack.pop()
    let entries = []
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { continue }
    for (const e of entries) {
      seen++
      const full = path.join(dir, e.name)
      if (e.isFile() && e.name === 'diagnostics.txt' && /usage-monitor/.test(dir)) {
        try { return fs.readFileSync(full, 'utf8').trim().slice(0, 600) } catch { return null }
      }
      if (e.isDirectory() && depth < 6 && e.name !== 'node_modules' && e.name !== '.git') stack.push([full, depth + 1])
    }
  }
  return null
}

// Says why there is nothing to show, so "no data" is never a mystery (wrong machine, plugin missing, unreadable files).
function noDataHelp() {
  let names = []
  let exists = true
  try {
    names = fs.readdirSync(SESS).filter(f => f.endsWith('.json'))
  } catch {
    exists = false
  }
  const why = !exists ? `${L.noFolder}\n\n\`/plugin install usage-monitor --marketplace AndreyKilanov/claude-usage-monitor\`\n\n**${L.setupClick}**`
    : names.length === 0 ? L.noFiles
    : L.noReadable
  const note = findPluginNote()
  const plugin = note ? `${L.pluginSays}\n\n\`\`\`\n${note}\n\`\`\`` : !exists ? L.pluginSilent : ''
  return [L.noDataTip, why, plugin, `${L.lookingIn}\n\n\`${SESS}\``].filter(Boolean).join('\n\n')
}

function activate(context) {
  pickLocale()
  let machineId = context.globalState.get('machineId')
  if (!machineId) {
    machineId = `${os.hostname().replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 24)}-${crypto.randomBytes(3).toString('hex')}`
    context.globalState.update('machineId', machineId)
  }
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100)
  item.command = 'claudeUsage.open'
  let panel
  let history = []
  let lastStamp = 0
  let last = null

  const alerts = u => {
    if (!cfg('notifications', true)) return
    const seen = context.globalState.get('alerts', {})
    const warn = cfg('warnAt', 80)
    const crit = cfg('critAt', 90)
    for (const w of windows(u)) {
      if (w.kind !== 'five_hour' && w.kind !== 'seven_day') continue
      const st = seen[w.kind] || { resetsAt: w.resetsAt, level: 0 }
      const moved = st.resetsAt && w.resetsAt && Math.abs(Date.parse(st.resetsAt) - Date.parse(w.resetsAt)) > 600_000
      if (moved) {
        if (st.level > 0 && cfg('notifyOnReset', true)) vscode.window.showInformationMessage(L.resetMsg(nameOf(w.kind)))
        st.level = 0
        st.resetsAt = w.resetsAt
      }
      const lvl = w.p >= crit ? 2 : w.p >= warn ? 1 : 0
      if (lvl > st.level) {
        const msg = (lvl === 2 ? L.critMsg : L.warnMsg)(nameOf(w.kind), Math.round(w.p))
        if (lvl === 2) vscode.window.showErrorMessage(msg)
        else vscode.window.showWarningMessage(msg)
        st.level = lvl
      }
      st.resetsAt = st.resetsAt || w.resetsAt
      seen[w.kind] = st
    }
    context.globalState.update('alerts', seen)
  }

  const render = () => {
    pushSync(machineId)
    const all = scan(machineId)
    const u = readLimits(all)
    const t = readTotals(all)
    if (!u) {
      item.text = `$(pulse) ${L.noData}`
      item.tooltip = new vscode.MarkdownString(noDataHelp(), false)
      item.command = fs.existsSync(SESS) ? 'claudeUsage.open' : 'claudeUsage.setup'
      item.backgroundColor = undefined
      item.show()
      return
    }
    item.command = 'claudeUsage.open'
    if (u.updatedAt && u.updatedAt !== lastStamp && u.fiveHour != null) {
      lastStamp = u.updatedAt
      if (history.length && u.fiveHour < history[history.length - 1].p) history = []
      history.push({ t: u.updatedAt, p: u.fiveHour })
      history = history.slice(-60)
    }
    alerts(u)
    const eta = forecast(history, u)
    last = { u, t, eta }
    const today = t.periods.today

    const worst = Math.max(...windows(u).filter(w => w.kind === 'five_hour' || w.kind === 'seven_day').map(w => w.p), 0)
    const parts = []
    if (cfg('showFiveHour', true)) {
      const r = cfg('showResetTimer', false) ? left(u.fiveHourResetsAt) : ''
      parts.push(`${L.h5} ${pct(u.fiveHour)}${r ? ` ⏱${r}` : ''}`)
    }
    if (cfg('showWeek', true)) parts.push(`${L.week} ${pct(u.sevenDay)}`)
    if (cfg('showToday', true)) parts.push(`${L.today} ${tok(today.total)}`)
    const icon = worst >= cfg('critAt', 90) ? '$(error)' : worst >= cfg('warnAt', 80) ? '$(warning)' : '$(pulse)'
    item.text = `${icon} ${parts.join(' · ') || L.title}`
    item.backgroundColor =
      worst >= cfg('critAt', 90) ? new vscode.ThemeColor('statusBarItem.errorBackground')
      : worst >= cfg('warnAt', 80) ? new vscode.ThemeColor('statusBarItem.warningBackground')
      : undefined

    const lines = [`### ${L.title}`]
    // one table row per window, so names, bars, percents and resets line up in columns
    const rows = windows(u).map(w => {
      const r = left(w.resetsAt)
      return `| **${nameOf(w.kind)}** | \`${bar(w.p)}\` | **${pct(w.p)}** | ${r ? `${L.resets} ${r}` : ''} |`
    })
    lines.push(['| | | | |', '|:--|:--|--:|:--|', ...rows].join('\n'))
    if (eta) lines.push(`$(flame) ${L.forecast} **${fmtMs(eta)}**`)
    lines.push('---')
    lines.push(`${L.todayLine}: **${groupNum(today.total)}** ${L.tokens} · ${L.sessions}: ${t.sessionsToday}`)
    lines.push(u.usd != null ? `${L.curSession}: ${tok(u.tokens)} ${L.tokens} · $${Number(u.usd).toFixed(2)}` : `${L.curSession}: ${tok(u.tokens)} ${L.tokens}`)
    item.tooltip = new vscode.MarkdownString(lines.join('\n\n'), true)
    item.show()
    pushPanel()
  }

  const payload = () => {
    const { u, t, eta } = last
    const per = key => {
      const p = t.periods[key]
      return {
        total: p.total,
        totalText: groupNum(p.total),
        bars: p.bars.map(b => ({ label: b.label, day: b.day, v: b.v, cur: b.cur })),
        models: top(mergeModels(p.models)),
        projects: top(p.projects),
      }
    }
    return {
      L: {
        title: L.title, updated: L.updated, resetsCap: L.resetsCap, noReset: L.noReset, forecast: L.forecast, note: L.note,
        tabToday: L.tabToday, tab7: L.tab7, tab30: L.tab30, byModel: L.byModel, byProject: L.byProject, noBreakdown: L.noBreakdown,
        tokens: L.tokens, sessions: L.sessions, devices: L.devices, curSession: L.curSession, exportCsv: L.exportCsv, total: L.total, perDay: L.perDay,
      },
      locale: L.locale,
      time: new Date().toLocaleTimeString(L.locale),
      warnAt: cfg('warnAt', 80),
      critAt: cfg('critAt', 90),
      windows: windows(u).map(w => ({ name: nameOf(w.kind), p: w.p, reset: left(w.resetsAt) })),
      eta: eta ? fmtMs(eta) : null,
      periods: { today: per('today'), d7: per('d7'), d30: per('d30') },
      sessionsToday: t.sessionsToday,
      devicesCount: t.devices,
      session: { tokens: u.tokens || 0, usd: u.usd ?? null },
    }
  }

  const pushPanel = () => {
    if (!panel || !last) return
    try {
      panel.webview.postMessage({ type: 'data', data: payload() })
    } catch {}
  }

  const open = () => {
    if (panel) return panel.reveal()
    panel = vscode.window.createWebviewPanel('claudeUsage', L.title, vscode.ViewColumn.Beside, { enableScripts: true })
    panel.webview.html = panelHtml()
    panel.onDidDispose(() => (panel = undefined), null, context.subscriptions)
    panel.webview.onDidReceiveMessage(m => {
      if (m && m.type === 'ready') pushPanel()
      if (m && m.type === 'csv') vscode.commands.executeCommand('claudeUsage.exportCsv')
    }, null, context.subscriptions)
  }

  const exportCsv = async () => {
    const all = scan(machineId)
    const t = readTotals(all)
    if (!t.raw.length) return vscode.window.showInformationMessage(L.csvNone)

    const pick = await vscode.window.showQuickPick(
      [
        { label: L.csvByModel, detail: L.csvByModelHint, id: 'model' },
        { label: L.csvByProject, detail: L.csvByProjectHint, id: 'project' },
        { label: L.csvLong, detail: L.csvLongHint, id: 'long' },
      ],
      { placeHolder: L.csvPick },
    )
    if (!pick) return

    const delim = csvDelimiter()
    const day = ms => {
      const d = new Date(ms)
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    }
    // a cell that starts with = + - @ would run as a formula in a spreadsheet: a project folder named "=1+1" must not
    const q = v => {
      const s = String(v)
      const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s
      return safe.includes(delim) || /["\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
    }
    const line = cells => cells.map(q).join(delim)

    const days = {}
    for (const r of t.raw) {
      const d = (days[day(r.t)] = days[day(r.t)] || { total: 0, model: {}, project: {} })
      d.total += r.v
      for (const [m, n] of Object.entries(r.m || {})) d.model[prettyModel(m)] = (d.model[prettyModel(m)] || 0) + n
      for (const [p, n] of Object.entries(r.p || {})) d.project[p] = (d.project[p] || 0) + n
    }
    const dates = Object.keys(days).sort()

    let rows
    if (pick.id === 'long') {
      const dim = { total: L.csvDimTotal, model: L.csvDimModel, project: L.csvDimProject }
      rows = [[L.csvDate, L.csvDimension, L.csvName, L.csvTokens]]
      for (const date of dates) {
        rows.push([date, dim.total, '', groupNum(days[date].total)])
        for (const [m, n] of Object.entries(days[date].model).sort((a, b) => b[1] - a[1])) rows.push([date, dim.model, m, groupNum(n)])
        for (const [p, n] of Object.entries(days[date].project).sort((a, b) => b[1] - a[1])) rows.push([date, dim.project, p, groupNum(n)])
      }
    } else {
      // one column per model / project (the biggest eight), the rest and anything unattributed in "Other"
      const sums = {}
      for (const date of dates) for (const [k, n] of Object.entries(days[date][pick.id])) sums[k] = (sums[k] || 0) + n
      const cols = Object.entries(sums).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k]) => k)
      const g = groupNum
      rows = [[L.csvDate, L.csvTotal, ...cols, L.csvOther]]
      const totals = new Array(cols.length).fill(0)
      let grand = 0
      let otherAll = 0
      for (const date of dates) {
        const d = days[date]
        const vals = cols.map(c => d[pick.id][c] || 0)
        const other = Math.max(0, d.total - vals.reduce((x, y) => x + y, 0))
        rows.push([date, g(d.total), ...vals.map(g), g(other)])
        vals.forEach((v, i) => (totals[i] += v))
        grand += d.total
        otherAll += other
      }
      rows.push([L.csvTotal, g(grand), ...totals.map(g), g(otherAll)])
    }

    const csv = '\uFEFF' + rows.map(line).join('\r\n') + '\r\n' // BOM: Excel reads UTF-8 (Cyrillic) correctly with it
    const uri = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(path.join(os.homedir(), `claude-usage-${pick.id}-${day(Date.now())}.csv`)),
      filters: { CSV: ['csv'] },
    })
    if (!uri) return
    try {
      fs.writeFileSync(uri.fsPath, csv)
    } catch (e) {
      return vscode.window.showErrorMessage(`CSV: ${e && e.message ? e.message : e}`)
    }
    vscode.window.showInformationMessage(`${L.csvDone}: ${uri.fsPath}`)
  }

  const setup = async () => {
    let bins = findClaudeBinaries()
    if (!bins.length) {
      const pick = await vscode.window.showErrorMessage(L.setupNoClaude, L.setupPick)
      if (pick !== L.setupPick) return
      const chosen = await vscode.window.showOpenDialog({ canSelectMany: false, title: L.setupPick })
      if (!chosen || !chosen[0]) return
      bins = [chosen[0].fsPath]
    }
    const yes = await vscode.window.showWarningMessage(`${L.setupAsk}\n\n${bins[0]}`, { modal: true }, L.setupYes)
    if (yes !== L.setupYes) return
    const claude = bins[0]
    const steps = [
      { args: ['plugin', 'marketplace', 'add', 'AndreyKilanov/claude-usage-monitor'], okIfSays: /already/i },
      { args: ['plugin', 'install', 'usage-monitor@claude-usage-monitor', '--scope', 'user'], okIfSays: /already installed/i },
    ]
    const result = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: L.setupBusy },
      async () => {
        for (const step of steps) {
          const r = await run(claude, step.args)
          if (!r.ok && !step.okIfSays.test(r.out)) return r
        }
        await run(claude, ['plugin', 'update', 'usage-monitor@claude-usage-monitor']) // best effort: pick up a newer version
        return { ok: true }
      },
    )
    if (result.ok) vscode.window.showInformationMessage(L.setupDone)
    else vscode.window.showErrorMessage(`${L.setupFail} ${(result.out || String(result.err && result.err.message)).slice(0, 400)}`)
    render()
  }

  render()
  const watchTimer = setInterval(render, 3000)
  if (watchTimer.unref) watchTimer.unref()
  let timer
  const schedule = () => {
    clearInterval(timer)
    timer = setInterval(render, Math.max(10, cfg('refreshIntervalSeconds', 30)) * 1000)
    if (timer.unref) timer.unref()
  }
  schedule()

  context.subscriptions.push(
    item,
    vscode.workspace.onDidChangeConfiguration(e => {
      if (!e.affectsConfiguration('claudeUsage')) return
      pickLocale()
      schedule()
      render()
    }),
    vscode.commands.registerCommand('claudeUsage.open', open),
    vscode.commands.registerCommand('claudeUsage.refresh', render),
    vscode.commands.registerCommand('claudeUsage.exportCsv', exportCsv),
    vscode.commands.registerCommand('claudeUsage.setup', setup),
    { dispose: () => { clearInterval(watchTimer); clearInterval(timer) } },
  )
}

// The panel is a static shell; the extension posts data and the page draws it (textContent only, never innerHTML).
function panelHtml() {
  const nonce = crypto.randomBytes(12).toString('hex')
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style>
  :root { --ok: var(--vscode-charts-green, #3fb950); --warn: var(--vscode-charts-yellow, #d29922); --crit: var(--vscode-charts-red, #f85149);
          --blue: var(--vscode-charts-blue, #388bfd); --accent: #ffb547; --accent2: #ff6363; --teal: #40e0d0;
          --card: var(--vscode-editorWidget-background, rgba(127,127,127,.1)); --line: var(--vscode-editorWidget-border, rgba(127,127,127,.25));
          --muted: var(--vscode-descriptionForeground, #9aa); }
  * { box-sizing: border-box; }
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 0 24px 32px; max-width: 720px; margin: 0 auto; }
  .hero { margin: 0 -24px 22px; padding: 22px 24px 18px; background: linear-gradient(135deg, rgba(255,181,71,.16), rgba(64,224,208,.10) 60%, transparent); border-bottom: 1px solid var(--line); }
  .hero h1 { font-size: 20px; font-weight: 650; margin: 0 0 2px; letter-spacing: -.01em; }
  .muted { color: var(--muted); font-size: 12px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 12px; margin-bottom: 14px; }
  .card { background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 16px; }
  .ringcard { display: flex; align-items: center; gap: 14px; }
  .ring { width: 74px; height: 74px; flex: none; position: relative; }
  .ring svg { width: 100%; height: 100%; transform: rotate(-90deg); }
  .ring .trk { stroke: rgba(127,127,127,.22); } .ring .val { transition: stroke-dasharray .6s ease; stroke-linecap: round; }
  .ring .pc { position: absolute; inset: 0; display: grid; place-items: center; font-weight: 650; font-size: 17px; font-variant-numeric: tabular-nums; }
  .label { font-size: 11px; text-transform: uppercase; letter-spacing: .07em; color: var(--muted); }
  .sub { font-size: 12px; color: var(--muted); margin-top: 4px; }
  .warn .pc { color: var(--warn); } .crit .pc { color: var(--crit); }
  .forecast { margin: 0 0 14px; padding: 10px 14px; border-radius: 10px; border: 1px solid var(--warn); font-size: 13px; background: rgba(210,153,34,.08); }
  .tabs { display: inline-flex; gap: 2px; padding: 3px; border-radius: 999px; background: rgba(127,127,127,.15); margin-bottom: 14px; }
  .tab { border: 0; background: transparent; color: var(--muted); padding: 5px 14px; border-radius: 999px; cursor: pointer; font: inherit; font-size: 12px; }
  .tab.on { background: var(--vscode-button-background, #0e639c); color: var(--vscode-button-foreground, #fff); }
  .head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 4px; }
  .big { font-size: 30px; font-weight: 650; font-variant-numeric: tabular-nums; letter-spacing: -.02em; }
  .chart { display: flex; gap: 3px; align-items: flex-end; height: 120px; margin-top: 14px; }
  .col { flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: center; height: 100%; }
  .stick { flex: 1; width: 100%; display: flex; align-items: flex-end; }
  .stick i { display: block; width: 100%; border-radius: 4px 4px 0 0; background: rgba(127,127,127,.42); min-height: 0; transition: height .4s ease; }
  .col.cur .stick i { background: linear-gradient(180deg, var(--accent), var(--accent2)); }
  .tick { font-size: 9px; height: 12px; margin-top: 4px; color: var(--muted); overflow: hidden; white-space: nowrap; }
  .cols2 { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 12px; margin-top: 12px; }
  .row { margin: 10px 0 0; }
  .rl { display: flex; justify-content: space-between; gap: 10px; font-size: 12px; }
  .rl span:first-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .rl span:last-child { color: var(--muted); font-variant-numeric: tabular-nums; flex: none; }
  .meter { height: 6px; border-radius: 3px; background: rgba(127,127,127,.2); margin-top: 4px; overflow: hidden; }
  .meter i { display: block; height: 100%; border-radius: 3px; transition: width .4s ease; }
  .actions { display: flex; justify-content: space-between; align-items: center; margin-top: 16px; gap: 10px; flex-wrap: wrap; }
  .btn { border: 1px solid var(--line); background: var(--card); color: inherit; padding: 6px 12px; border-radius: 8px; cursor: pointer; font: inherit; font-size: 12px; }
  .btn:hover { border-color: var(--accent); }
  .hidden { display: none; }
</style></head><body>
  <div class="hero"><h1 id="title"></h1><div class="muted" id="updated"></div></div>
  <div class="grid" id="rings"></div>
  <div class="forecast hidden" id="forecast"></div>
  <div class="tabs" id="tabs"></div>
  <div class="card">
    <div class="head"><span class="label" id="plabel"></span><span class="big" id="ptotal"></span></div>
    <div class="sub" id="psub"></div>
    <div class="chart" id="chart"></div>
  </div>
  <div class="cols2">
    <div class="card"><div class="label" id="mlabel"></div><div id="models"></div></div>
    <div class="card"><div class="label" id="plabel2"></div><div id="projects"></div></div>
  </div>
  <div class="actions"><span class="muted" id="note"></span><button class="btn" id="csv"></button></div>
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi()
  const $ = id => document.getElementById(id)
  const PALETTE = ['#ffb547', '#40e0d0', '#7aa2ff', '#ff6363', '#c792ea', '#8bd17c', '#f78fb3']
  let data = null
  let tab = (vscode.getState() || {}).tab || 'today'
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e }
  const fmt = n => n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : String(Math.round(n || 0))
  const level = p => p >= data.critAt ? 'crit' : p >= data.warnAt ? 'warn' : 'ok'
  const color = p => ({ ok: 'var(--ok)', warn: 'var(--warn)', crit: 'var(--crit)' })[level(p)]

  function ring(w) {
    const card = el('div', 'card ringcard ' + level(Number(w.p) || 0))
    const R = 32, C = 2 * Math.PI * R, p0 = Number(w.p) || 0, v = Math.min(100, Math.max(0, p0)) / 100 * C
    const wrap = el('div', 'ring')
    wrap.innerHTML = '<svg viewBox="0 0 80 80"><circle class="trk" cx="40" cy="40" r="' + R + '" fill="none" stroke-width="8"/><circle class="val" cx="40" cy="40" r="' + R + '" fill="none" stroke-width="8" stroke="' + color(p0) + '" stroke-dasharray="' + v + ' ' + C + '"/></svg>'
    wrap.appendChild(el('div', 'pc', Math.round(p0) + '%'))
    const txt = el('div')
    txt.appendChild(el('div', 'label', w.name))
    txt.appendChild(el('div', 'sub', w.reset ? data.L.resetsCap + ' ' + w.reset : data.L.noReset))
    card.append(wrap, txt)
    return card
  }

  function rows(host, list, total) {
    host.replaceChildren()
    if (!list.length || !total) { host.appendChild(el('div', 'sub', data.L.noBreakdown)); return }
    list.forEach((r, i) => {
      const row = el('div', 'row'), rl = el('div', 'rl')
      rl.append(el('span', '', r.name), el('span', '', fmt(r.v) + ' · ' + Math.round(r.v / total * 100) + '%'))
      const m = el('div', 'meter'), bar = el('i')
      bar.style.width = Math.max(2, r.v / total * 100) + '%'
      bar.style.background = PALETTE[i % PALETTE.length]
      m.appendChild(bar); row.append(rl, m); host.appendChild(row)
    })
  }

  function draw() {
    if (!data) return
    $('title').textContent = data.L.title
    $('updated').textContent = data.L.updated + ' ' + data.time + (data.devicesCount > 1 ? ' · ' + data.devicesCount + ' ' + data.L.devices : '')
    $('rings').replaceChildren(...data.windows.map(ring))
    $('forecast').classList.toggle('hidden', !data.eta)
    $('forecast').textContent = data.eta ? '🔥 ' + data.L.forecast + ' ' + data.eta : ''
    const tabs = $('tabs'); tabs.replaceChildren()
    for (const [k, label] of [['today', data.L.tabToday], ['d7', data.L.tab7], ['d30', data.L.tab30]]) {
      const b = el('button', 'tab' + (k === tab ? ' on' : ''), label)
      b.onclick = () => { tab = k; vscode.setState({ tab }); draw() }
      tabs.appendChild(b)
    }
    const p = data.periods[tab]
    $('plabel').textContent = data.L.total + ' · ' + data.L.tokens
    $('ptotal').textContent = fmt(p.total)
    const days = tab === 'today' ? 1 : tab === 'd7' ? 7 : 30
    $('psub').textContent = p.totalText + ' · ' + fmt(p.total / days) + ' ' + data.L.perDay + ' · ' + data.L.sessions + ': ' + data.sessionsToday
    const max = Math.max(1, ...p.bars.map(b => b.v)), chart = $('chart'); chart.replaceChildren()
    p.bars.forEach((b, i) => {
      const c = el('div', 'col' + (b.cur ? ' cur' : '')), st = el('div', 'stick'), bar = el('i')
      bar.style.height = (b.v ? Math.max(4, b.v / max * 100) : 0) + '%'
      bar.title = (tab === 'today' ? b.label + ':00' : b.label + ' ' + (b.day || '')) + ' — ' + fmt(b.v)
      st.appendChild(bar)
      const every = tab === 'd30' ? 5 : tab === 'today' ? 4 : 1
      const showTick = tab === 'd7' || i % every === 0 || b.cur
      c.append(st, el('div', 'tick', showTick ? (tab === 'd30' ? String(b.day) : b.label) : ''))
      chart.appendChild(c)
    })
    $('mlabel').textContent = data.L.byModel; $('plabel2').textContent = data.L.byProject
    rows($('models'), p.models, p.total); rows($('projects'), p.projects, p.total)
    $('note').textContent = data.L.note
    $('csv').textContent = data.L.exportCsv
  }

  $('csv').onclick = () => vscode.postMessage({ type: 'csv' })
  window.addEventListener('message', e => { if (e.data && e.data.type === 'data') { data = e.data.data; draw() } })
  vscode.postMessage({ type: 'ready' })
</script></body></html>`
}

function deactivate() {}

module.exports = { activate, deactivate, __test: { findClaudeBinaries, noDataHelp, prettyModel, readTotals, forecast, panelHtml, dayStart, readLimits, scan } }
