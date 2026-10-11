<p align="center"><img src="extension/icon.png" width="96" alt="Claude Usage Monitor"></p>

<h1 align="center">Claude Usage Monitor</h1>

<p align="center">
Your Claude Code <b>5-hour</b> and <b>weekly</b> limits, tokens by <b>day, model and project</b>,<br>
alerts and a pace forecast — right in the status bar of VS Code, Antigravity and Cursor.
</p>

<p align="center">
<a href="https://open-vsx.org/extension/andreykilanov/claude-usage-monitor"><img alt="Open VSX version" src="https://img.shields.io/open-vsx/v/andreykilanov/claude-usage-monitor?label=Open%20VSX&color=ffb547"></a>
<a href="https://open-vsx.org/extension/andreykilanov/claude-usage-monitor"><img alt="Open VSX installs" src="https://img.shields.io/open-vsx/dt/andreykilanov/claude-usage-monitor?label=installs&color=40e0d0"></a>
<a href="LICENSE"><img alt="MIT license" src="https://img.shields.io/badge/license-MIT-7aa2ff"></a>
</p>

<p align="center"><a href="#русская-версия">Русская версия ↓</a></p>

<p align="center"><img src="assets/panel-dark.png" width="640" alt="Usage panel, dark theme"></p>
<p align="center"><sub>Sample data. The panel follows your editor theme.</sub></p>

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
| **CSV export** | by day and model, by day and project, or raw rows; opens cleanly in Excel / Numbers |
| **Languages** | Russian and English, picked from the editor language |

<p align="center"><img src="assets/panel-light.png" width="640" alt="Usage panel, light theme, 30 days"></p>

## How it works

Two small parts that talk through plain files on your disk:

```
Claude Code ── plugin/ (usage-monitor) ──▶ ~/.claude/usage-monitor/<session>.json ──▶ extension/ ──▶ status bar + panel
```

- **plugin/** is a Claude Code plugin. After each reply it writes the limits Claude Code already knows (5-hour, weekly, per-model) and the tokens spent into one file per session. It also draws a small band above the prompt in the terminal and the desktop app.
- **extension/** is the editor extension. It reads those files and shows them.

Why two parts: the Claude panel inside VS Code-style editors cannot draw custom UI, so the numbers are handed to a normal status-bar item.

**Nothing leaves your computer.** No network calls, no sign-in, no tokens or keychain access. The extension only reads the files above. If you turn on the optional sync folder, it copies those same files there — they contain token counts and the names of your project folders.

## Install

### 1. The plugin (every machine)

In a Claude Code terminal session:

```
/plugin install usage-monitor --marketplace AndreyKilanov/claude-usage-monitor
```

Answer `y` to add the marketplace, then pick the user scope.

### 2. The extension

- **Open VSX** (Antigravity, VSCodium, Cursor…): search **Claude Usage Monitor** in the Extensions view, or open the [listing](https://open-vsx.org/extension/andreykilanov/claude-usage-monitor).
- **From a file:** download `claude-usage-monitor-<version>.vsix` from [Releases](https://github.com/AndreyKilanov/claude-usage-monitor/releases), then Extensions → **⋯** → *Install from VSIX…*.

### 3. Start a new Claude session

Send any message. The numbers appear after the first reply (sessions started before the plugin was installed are not counted).

## Settings

| Setting | Default | What it does |
| --- | --- | --- |
| `claudeUsage.language` | `auto` | `auto`, `en` or `ru` |
| `claudeUsage.showFiveHour` / `showWeek` / `showToday` | `true` | choose what the status bar shows |
| `claudeUsage.showResetTimer` | `false` | time to reset next to the 5-hour percentage |
| `claudeUsage.warnAt` / `critAt` | `80` / `90` | yellow and red thresholds |
| `claudeUsage.notifications` | `true` | notify when a threshold is crossed |
| `claudeUsage.notifyOnReset` | `true` | notify when a limit that was high resets |
| `claudeUsage.syncFolder` | empty | shared folder to add up several devices |
| `claudeUsage.csvDelimiter` | `auto` | `auto` (`;` for Russian, `,` otherwise), `,`, `;` or `tab` |
| `claudeUsage.numberGrouping` | `auto` | `13 240 843` (`auto` follows the language: space for Russian, comma for English), `space`, `dot`, `comma` or `none` |
| `claudeUsage.refreshIntervalSeconds` | `30` | how often the bar redraws (files are also watched every 3 s) |

Commands (Command Palette): **Claude Usage: Open Panel**, **Refresh**, **Export CSV**.

## Good to know

- **Percentages are account-wide**, the same on every device. **Tokens are counted per machine** unless you set a sync folder.
- Token counts include cache reads, so the numbers are large. Go by the percentages for how much of your limit is left.
- Sonnet / Opus weekly windows and the 5-hour window only appear if your plan reports them.
- Needs a Claude subscription that reports usage windows. On other setups the percentages show "—" and tokens still count.
- Developed and tested on macOS. Windows is supported (home folder from `USERPROFILE`) but only covered by automated tests, not by daily use; Linux is untested. Please [open an issue](https://github.com/AndreyKilanov/claude-usage-monitor/issues) if something is off.

## Troubleshooting: the status bar says "no data"

Hover it — the tooltip says which case you are in and which folder it checks (`~/.claude/usage-monitor/`).

1. **Folder not found:** the plugin is not installed *on this machine*. Install it (see above) and start a new Claude session.
2. **Folder exists but is empty:** send a message in a **new** session. Sessions started before the plugin was installed or updated are not counted.
3. **Remote / WSL / SSH windows:** the extension and the plugin must run on the same machine and read the same home folder.
4. **Still nothing:** run `/plugin` in Claude Code and check that `usage-monitor` is enabled.

## Build from source

```bash
git clone https://github.com/AndreyKilanov/claude-usage-monitor
cd claude-usage-monitor
./scripts/build-vsix.sh        # writes dist/claude-usage-monitor-<version>.vsix
claude plugin validate plugin   # plugin checks
claude plugin test plugin       # plugin tests
node --test extension/test/extension.test.js   # extension tests
```

No dependencies and no build step: the extension is a single JavaScript file.

## License

[MIT](LICENSE) © Andrey Kilanov

---

# Русская версия

<p align="center"><b>Claude Usage Monitor</b> — лимиты Claude Code за <b>5 часов</b> и <b>неделю</b>, токены по <b>дням, моделям и проектам</b>, оповещения и прогноз — в строке состояния VS Code, Antigravity и Cursor.</p>

> **Неофициальный проект.** Не связан с Anthropic и не одобрен ею. Название «Claude» принадлежит правообладателю и используется только чтобы сказать, с чем работает инструмент.

## Возможности

| | |
| --- | --- |
| **Строка состояния** | `5ч 38% · нед 5% · сегодня 1.2M`; жёлтая / красная при 80% / 90% (настраивается) |
| **Подсказка** | шкалы, время до сброса, недельные окна Sonnet / Opus, если они есть в тарифе |
| **Панель** (клик) | кольца лимитов, графики за сутки / 7 / 30 дней, разбивка по моделям и проектам |
| **Оповещения** | уведомление при пересечении порога и при сбросе лимита |
| **Прогноз** | «при таком темпе лимит 5 часов закончится через 23 мин» — только если это случится до сброса |
| **Все сессии** | все окна и сессии на машине суммируются, «сегодня» — реальный итог |
| **Несколько устройств** | необязательная общая папка (iCloud Drive, Dropbox, Syncthing…) суммирует ваши машины |
| **Экспорт CSV** | по дням и моделям, по дням и проектам или сырые строки; корректно открывается в Excel / Numbers |
| **Языки** | русский и английский по языку редактора |

## Как это работает

Две небольшие части, которые общаются через обычные файлы на вашем диске:

- **plugin/** — плагин Claude Code. После каждого ответа пишет лимиты, которые Claude Code уже знает, и потраченные токены — по одному файлу на сессию. Также рисует полоску над полем ввода в терминале и десктопном приложении.
- **extension/** — расширение редактора. Читает эти файлы и показывает.

Две части нужны потому, что панель Claude внутри редакторов на базе VS Code не умеет рисовать чужой интерфейс, поэтому цифры передаются обычному элементу строки состояния.

**Ничего не уходит с компьютера.** Нет сетевых запросов, входа, токенов и доступа к связке ключей. Если включить необязательную папку синхронизации, расширение копирует туда эти же файлы — в них числа токенов и названия папок ваших проектов.

## Установка

1. **Плагин** (на каждой машине), в терминальной сессии Claude Code:

   ```
   /plugin install usage-monitor --marketplace AndreyKilanov/claude-usage-monitor
   ```

   Ответьте `y`, затем выберите пользовательский уровень (user scope).

2. **Расширение:** найдите **Claude Usage Monitor** в Open VSX ([страница](https://open-vsx.org/extension/andreykilanov/claude-usage-monitor); Antigravity, VSCodium, Cursor) или установите `.vsix` из [Releases](https://github.com/AndreyKilanov/claude-usage-monitor/releases): Extensions → **⋯** → *Install from VSIX…*.

3. **Начните новую сессию Claude** и отправьте сообщение. Цифры появятся после первого ответа; сессии, начатые до установки плагина, не учитываются.

## Нужно знать

- **Проценты — по всему аккаунту**, одинаковые на всех устройствах. **Токены считаются на каждой машине отдельно**, если не задана папка синхронизации.
- В токены входят кэш-чтения, поэтому цифры большие. Сколько осталось от лимита — смотрите по процентам.
- Окна Sonnet / Opus показываются, только если тариф их отдаёт.
- Разрабатывалось и проверялось на macOS. Windows поддерживается (домашняя папка берётся из `USERPROFILE`), но проверено только автотестами; Linux не проверялся.

## Если в строке «no data»

Наведите курсор: подсказка скажет, какой из случаев ваш, и покажет папку, которую расширение проверяет (`~/.claude/usage-monitor/`).

1. **Папка не найдена** — плагин не установлен *на этой машине*. Поставьте его и начните новую сессию Claude.
2. **Папка есть, но пустая** — отправьте сообщение в **новой** сессии. Сессии, начатые до установки или обновления плагина, не учитываются.
3. **Удалённые окна (WSL / SSH):** расширение и плагин должны работать на одной машине и читать одну домашнюю папку.
4. **Всё равно пусто** — выполните `/plugin` в Claude Code и проверьте, что `usage-monitor` включён.
