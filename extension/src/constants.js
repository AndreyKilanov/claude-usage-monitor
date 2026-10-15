const os = require('os')
const path = require('path')

const DIR = path.join(os.homedir(), '.claude')

module.exports = {
  DIR,
  SESS: path.join(DIR, 'usage-monitor'),
  DAY: 86400_000,
  HOUR: 3600_000,
  KEEP_DAYS: 36,
  MIN_PLUGIN: '0.6.3',
  LATEST_PLUGIN: '0.6.6',
  REPO_FALLBACK: 'https://github.com/AndreyKilanov/claude-usage-monitor',
  MARKETPLACE: 'claude-usage-monitor',
  PLUGIN_ID: 'usage-monitor@claude-usage-monitor',
  MARKETPLACE_SOURCE: 'AndreyKilanov/claude-usage-monitor',
}
