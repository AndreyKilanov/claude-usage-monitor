export type Usage = {
  /** the plugin's version, written into the data file so the extension can spot an outdated plugin */
  v?: string | null
  /** folder name of the session's working directory, written into the data file */
  project?: string | null
  /** id of the session these counters belong to */
  sid: string | null
  fiveHour: number | null
  fiveHourResetsAt: string | null
  sevenDay: number | null
  sevenDayResetsAt: string | null
  tokens: number
  usd: number | null
  /** tokens spent per hour of this session, keyed by the hour's start in ms */
  buckets: Record<string, number>
  /** every rate-limit window the last response reported (five_hour, seven_day, seven_day_sonnet, ...) */
  /** per hour of this session: tokens by model and by project folder */
  /** `k` splits the hour's tokens by kind: i = new input, o = output, w = cache writes, r = cache reads */
  detail: Record<string, { m: Record<string, number>; p: Record<string, number>; k?: Record<string, number> }>
  limits: { kind: string; percentUsed: number; resetsAt: string | null }[]
}

declare module 'claude-code' {
  interface PluginState {
    'usage-monitor': { usage: Usage }
  }
}
