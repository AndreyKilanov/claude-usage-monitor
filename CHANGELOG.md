# Changelog

## 0.6.3

- **"Only this project" switch** in the panel: *All projects* / *📁 the open folder*. It narrows tokens, charts, the token split and models to the sessions of the project open in this editor window (matched by folder name, case-insensitive; older data falls back to the folder with most of the session's tokens). Limits stay account-wide, and the status bar keeps counting every project.
- **Version, as a link to the project page on GitHub.** Small, in the top right corner of the panel and in the right-hand corner of the status bar tooltip's header row, above the limit bars (hover it for the extension and plugin versions). The address is fixed in the extension: nothing the page sends can change where it goes. There is no update check: the extension still makes no network requests.
- **Outdated-plugin banner.** The plugin now writes its own version into every data file; if the plugin on this computer is older than 0.6.3 or reports no version, the panel says so and points to *menu → Install the usage-monitor plugin*. An outdated plugin is also flagged with one line at the end of the tooltip.
- The plugin also records the project folder name of each session.
- The tooltip's reset column is right-aligned to sit under the version.
- Tests: 18 plugin tests, 55 extension tests.

**Update the plugin on every machine** (menu → *Install the usage-monitor plugin*), then start a new Claude session.

## 0.6.2

- **Install / update fixed.** The install command now refreshes the catalogue's version list (`plugin marketplace update`) before `plugin update`; without it an already-installed old plugin could be reported as "up to date" and never pick up 0.6.
- **Outdated plugin is detected.** If the newest data on this computer has no token split, the panel says the plugin here is an old version and points to *menu → Install the usage-monitor plugin*, instead of just showing "Not split (older data)".
- Tests: 16 plugin tests, 42 extension tests.

## 0.6.1

- Russian interface and README rewritten in natural language: «5-часовой лимит» / «Недельный лимит» instead of «Окно 5 часов», «Состав токенов», «Новый запрос», «Сообщение плагина», clearer notices and alerts, no more «2 устройств». The Russian README is rewritten as a whole.
- A test now checks that every string exists in both languages and that known awkward phrases do not come back.

## 0.6.0

- **Token breakdown.** The panel has a new card, *What the tokens are made of*: cache reads, cache writes, new input and output, as a stacked bar with counts and shares, and a note explaining why the total looks so large. The plugin now records the split per hour; data from before this version is shown as "Not split (older data)". The raw-rows CSV gets `type` rows with the same split.
- **Status bar menu.** A click opens a small menu: open the panel, copy a one-line summary, export CSV, refresh, settings, install / update the plugin, help. Prefer the old behaviour? Set `claudeUsage.clickAction` to `panel`.
- Tests: 16 plugin tests, 39 extension tests.

**Update the plugin on every machine** to start recording the split: `/plugin marketplace update claude-usage-monitor`, then `/plugin update usage-monitor@claude-usage-monitor` (or use *Install / update the plugin* in the new menu), then start a new session.

## 0.5.5

- **One-click plugin install from the editor.** New command **Claude Usage: Install the plugin**, and the status bar item runs it when the data folder is missing (click it). The extension finds the Claude Code copy bundled with your editor (VS Code, Antigravity, Cursor, Windsurf, VSCodium), asks for confirmation naming exactly what will run, then runs `plugin marketplace add` and `plugin install usage-monitor --scope user` — no shell, no terminal. If no Claude Code is found you can point to `claude` by hand.
- Nothing runs on its own: the install happens only after you confirm.
- Tests: 14 plugin tests, 33 extension tests.

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
