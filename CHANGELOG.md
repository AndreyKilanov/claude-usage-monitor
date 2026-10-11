# Changelog

## 0.5.4

Diagnosing and hardening Windows.

- The plugin writes its data file as soon as a session starts, not only after the first reply, so the data folder exists immediately.
- One path separator throughout (backslashes on Windows) instead of a mix.
- The plugin leaves a note, `diagnostics.txt`, inside its own folder: `loaded` when it starts, `error` with the failing path and the system message if a write is refused. Nothing was reported before.
- The status bar's "no data" tooltip reads that note and shows it, or says the plugin left none (not installed / not enabled / this Claude version does not run plugin modules).
- Tests: 14 plugin tests, 28 extension tests; verified end to end on the real Claude Code engine (headless run).

## 0.5.3

- **Windows fix.** The plugin looked for the home folder only in `HOME`, which Windows does not set, so nothing was written and the status bar said "no data". It now also reads `USERPROFILE` (and `HOMEDRIVE` + `HOMEPATH`), and takes the project name from backslash paths.
- The "no data" tooltip now says why (folder missing, folder empty, files unreadable), shows the exact folder it is looking in, and gives the install command.
- Tests: 12 plugin tests, 27 extension tests.

**Update the plugin on every machine** (the extension needs no change for the fix): in a Claude Code session run `/plugin marketplace update claude-usage-monitor`, then `/plugin update usage-monitor@claude-usage-monitor`, and start a new session.

## 0.5.2

- CSV export redone for readability: pick **by day and model** (date, total, one column per model, a total row), **by day and project**, or the raw rows. Tokens that have no model / project split go to "Other".
- Russian Excel opens it correctly: `;` as the separator (setting `claudeUsage.csvDelimiter`, `auto` by default), a UTF-8 BOM, localized headers, CRLF line ends.
- Long token counts are grouped for reading: `13 240 843` (Russian, no-break space), `13,240,843` (English), or dots / none — setting `claudeUsage.numberGrouping`. Applies to the tooltip, the panel and all three CSV exports; set `none` for plain numbers when a CSV feeds a pivot table or a script.
- Tests: 26 extension tests.

## 0.5.1

Robustness pass, found by testing the edge cases.

- Plugin: a session cleared with `/clear` no longer inherits the previous session's counters (they would have been counted twice); a resumed session merges with its own file instead of overwriting it; odd usage numbers (negative, `NaN`, missing) can no longer poison the totals.
- Extension: a limit window that has already reset is shown as empty instead of the stale percentage; a session that appears twice (local copy + synced copy, or after a reinstall) counts once; day boundaries stay correct across daylight-saving changes; unchanged session files are cached instead of re-read every few seconds; a missing or unmounted sync folder is never created and `~` is expanded; CSV cells that start with `=`, `+`, `-` or `@` are neutralised so a project folder name cannot run as a spreadsheet formula; unreadable or wrongly-typed data files show as "no data" rather than `NaN`; several editor windows no longer repeat the same notification.
- Tests: 9 plugin tests and 19 extension tests (`node --test extension/test/extension.test.js`).

## 0.5.0

- Panel redrawn: ring gauges, Today / 7 days / 30 days tabs with charts, breakdown by model and by project.
- Tokens recorded by model and project folder; 35 days of history.
- Optional sync folder (`claudeUsage.syncFolder`) to add up several devices.
- CSV export (`Claude Usage: Export CSV`).
- One data file per session: two windows can no longer corrupt each other's data; half-written files are skipped.
- Plugin renamed to `usage-monitor`; data moved to `~/.claude/usage-monitor/`.

## 0.4.0

- Alerts at the warning / critical percent and on reset.
- Pace forecast for the 5-hour window.
- Settings for what the status bar shows and for thresholds.
- Sonnet / Opus weekly windows when reported.

## 0.1.0

- Status bar item with the 5-hour and weekly limits and tokens for today.
- Russian and English.
