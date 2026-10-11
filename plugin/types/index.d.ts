export type Usage = {
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
  detail: Record<string, { m: Record<string, number>; p: Record<string, number> }>
  limits: { kind: string; percentUsed: number; resetsAt: string | null }[]
}

declare module 'claude-code' {
  interface PluginState {
    'usage-monitor': { usage: Usage }
  }
}
