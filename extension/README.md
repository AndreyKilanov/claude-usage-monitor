<p align="center"><img src="https://raw.githubusercontent.com/AndreyKilanov/claude-usage-monitor/main/extension/icon.png" width="96" alt="Claude Usage Monitor"></p>

<h1 align="center">Claude Usage Monitor</h1>

<p align="center">
Your Claude Code <b>5-hour</b> and <b>weekly</b> limits, tokens by <b>day, model and project</b>,<br>
alerts and a pace forecast — right in the status bar of VS Code, Antigravity and Cursor.
</p>

<p align="center"><img src="https://raw.githubusercontent.com/AndreyKilanov/claude-usage-monitor/main/assets/statusbar.png" width="700" alt="Status bar item and its tooltip: limits, tokens, version"></p>
<p align="center"><sub>The status bar item and its hover tooltip.</sub></p>

<p align="center"><img src="https://raw.githubusercontent.com/AndreyKilanov/claude-usage-monitor/main/assets/panel-dark.png" width="640" alt="Usage panel, dark theme"></p>
<p align="center"><sub>The panel follows your editor theme. Mock-ups drawn from the extension's own output with sample data.</sub></p>

> **Unofficial.** Not affiliated with or endorsed by Anthropic. "Claude" is a trademark of its owner; it is used here only to say what the tool works with.

## What you get

| | |
| --- | --- |
| **Status bar** | `5h 38% · wk 5% · today 1.2M`; turns yellow / red at 80% / 90% (configurable) |
| **Hover** | progress bars, time to reset, Sonnet / Opus weekly windows when your plan has them |
| **Panel** (click) | ring gauges, 24-hour / 7-day / 30-day charts, breakdown by model and by project |
| **Alerts** | a notification when a limit crosses the warning / critical percent, and when it resets |
| **Forecast** | "at this pace the 5-hour limit runs out in 23 min" — only when it would happen before the reset |
| **All sessions** | every window and session on the machine is added up, so "today" is the real total |
| **Many devices** | optional shared folder (iCloud Drive, Dropbox, Syncthing…) adds up your other machines |
| **CSV export** | `date, dimension, name, tokens` for spreadsheets |
| **Languages** | Russian and English, picked from the editor language |

<p align="center"><img src="https://raw.githubusercontent.com/AndreyKilanov/claude-usage-monitor/main/assets/panel-light.png" width="640" alt="Usage panel, light theme, 30 days"></p>

## Setup

This extension reads the files written by the companion Claude Code plugin. Install it once per machine, in a Claude Code terminal session:

```
/plugin install usage-monitor --marketplace AndreyKilanov/claude-usage-monitor
```

Then start a new Claude session and send a message — the numbers appear after the first reply.

Nothing leaves your computer: no network calls, no sign-in, no keychain. Full documentation, settings and the Russian version: [GitHub](https://github.com/AndreyKilanov/claude-usage-monitor#readme).
