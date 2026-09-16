# Token Usage Analytics

> Tracks Claude Code token usage and cost — a live counter in the thread header plus session and project analytics.

## What it does

Every open thread grows a compact control in its header showing the running Claude Code token spend and cost of that thread's session (e.g. `1.2M · $3.40`). Clicking it opens a popover with the full breakdown: a session bar chart, tokens and cost split by phase (cache read, cache write, input, output, with thinking nested under output), response count, and one row per agent invocation — the main agent and every subagent call — sorted by spend. Each agent row links to that agent's detailed timeline.

Beyond the header, the plugin adds a **Usage Analytics** nav panel: a feed of recent Claude Code sessions drawn as horizontal stacked bar charts (agents as coloured segments over time), a cost-summary block with a spend-by-project donut and an hourly burn chart over a rolling day/week/month window, and a per-agent detail view showing an event-by-event timeline with git markers (push, PR, commit, and live-resolved PR-merge status).

## How it works

The frontend (`app.tsx`) claims two host slots. `app.slots.experimental_threadHeaderAction` mounts the counter button and its popover once per visible thread. `app.slots.navPanel` (id `threads-timeline`, path `THREADS_TIMELINE_PANEL_PATH`) registers the "Usage Analytics" panel, whose own router renders the feed (`ThreadsTimelinePage`) for an empty `subPath` and the agent-detail view (`AgentTimelinePage`) for any non-empty one. Chart geometry and behaviour (time unit, fill/hug width, column/gap/radius sizes, height mode, frame colour, …) are declared with `bb.settings.define` so bb renders them on the plugin's own native Settings page; the frontend reads them live via `useSettings()` + `parseGearSettings`.

Data comes from Python scripts under `tools/` that read the raw Claude Code transcripts in `~/.claude/projects` and emit versioned `--json` reports. `server.ts` registers an RPC contract (`sessionTokenUsage`, `agentTimeline`, `threadsTimeline`, plus `loadVizSettings`/`saveVizSettings`); its handlers drive the service layer, which spawns the interpreter, parses and caches the output. A BB `threadId` is resolved to its Claude Code session id through `bb.sdk.threads.events.list` (the `thread/identity` event) — the plugin never reads `bb.db` directly. Visualization state that can't be a declared setting (per-agent legend colours, sort, filters) persists across sessions in `bb.storage.kv`, reachable only from the server, hence the two `*VizSettings` RPCs. Some overlays are enriched live in the service layer: commit markers from `git log`, and PR-merge status from `gh pr view`.

## Layers

Dependencies run strictly downward — each layer depends only on the ones above it.

| Layer | File | Responsibility |
| --- | --- | --- |
| Transcripts (Python) | [tools/tokens.py](tools/tokens.py), [tools/agent_timeline.py](tools/agent_timeline.py), [tools/threads_timeline.py](tools/threads_timeline.py), [tools/git_events.py](tools/git_events.py) | Read `~/.claude/projects` transcripts; emit versioned `--json` reports: token counting/pricing, one agent's timeline, the recent-sessions feed, and mined git facts (push/PR/blocked). |
| Core (pure TS) | [src/core/](src/core/index.ts) | Types, parsing of each script's `--json` report (schema-version checked), formatting, and aggregation — project costs, hourly burn, agent/threads timelines, viz/gear settings. No I/O, depends on nothing else in the plugin. |
| Service (shell) | [src/service/](src/service/index.ts) | Spawns the interpreter ([process-runner.ts](src/service/process-runner.ts)), runs each script ([tokens-runner.ts](src/service/tokens-runner.ts), [agent-timeline-service.ts](src/service/agent-timeline-service.ts), [threads-timeline-service.ts](src/service/threads-timeline-service.ts)), caches slices ([cache.ts](src/service/cache.ts)), resolves `threadId`→`sessionId` ([thread-session.ts](src/service/thread-session.ts)), and enriches commit/PR-merge markers. |
| Backend entry | [server.ts](server.ts) | Defines and registers the RPC contract and handlers; declares the native chart settings via `bb.settings.define`. |
| Frontend | [app.tsx](app.tsx), [pages/](pages/), [components/](components/ui/button.tsx) | Header counter + popover, the "Usage Analytics" panel (feed, cost summary, agent detail), and the shared chart frame. |

---

# Token Usage Analytics — по-русски

> Считает расход токенов и стоимость Claude Code — живой счётчик в шапке треда плюс аналитика по сессиям и проектам.

## Для чего нужен

У каждого открытого треда в шапке появляется компактный элемент, показывающий текущий расход токенов и стоимость сессии этого треда (например `1.2M · $3.40`). По клику открывается поповер с полной разбивкой: столбчатый график сессии, токены и стоимость по фазам (cache read, cache write, input, output, с thinking вложенным под output), число ответов и по строке на каждый вызов агента — главный агент и каждый вызов субагента — отсортированные по расходу. Каждая строка агента ведёт на его подробный таймлайн.

Кроме шапки, плагин добавляет нав-панель **Usage Analytics**: ленту недавних сессий Claude Code в виде горизонтальных стековых столбчатых графиков (агенты — цветные сегменты во времени), блок сводки по стоимости с бубликом расхода по проектам и почасовым графиком сжигания за скользящее окно день/неделя/месяц, и представление детализации агента с поэлементным таймлайном и git-маркерами (push, PR, commit и живой статус слияния PR).

## Как устроено

Фронтенд (`app.tsx`) занимает два слота хоста. `app.slots.experimental_threadHeaderAction` монтирует кнопку-счётчик и её поповер по одному на каждый видимый тред. `app.slots.navPanel` (id `threads-timeline`, путь `THREADS_TIMELINE_PANEL_PATH`) регистрирует панель «Usage Analytics», собственный роутер которой рисует ленту (`ThreadsTimelinePage`) при пустом `subPath` и представление детализации агента (`AgentTimelinePage`) при любом непустом. Геометрия и поведение графиков (единица времени, fill/hug ширина, размеры колонок/зазоров/радиусов, режим высоты, цвет рамки, …) объявлены через `bb.settings.define`, поэтому bb рисует их на собственной странице настроек плагина; фронтенд читает их живьём через `useSettings()` + `parseGearSettings`.

Данные приходят из Python-скриптов в `tools/`, которые читают сырые транскрипты Claude Code в `~/.claude/projects` и выдают версионированные `--json`-отчёты. `server.ts` регистрирует RPC-контракт (`sessionTokenUsage`, `agentTimeline`, `threadsTimeline`, плюс `loadVizSettings`/`saveVizSettings`); его обработчики управляют слоем сервиса, который запускает интерпретатор, парсит и кэширует вывод. BB `threadId` разрешается в id сессии Claude Code через `bb.sdk.threads.events.list` (событие `thread/identity`) — плагин никогда не читает `bb.db` напрямую. Состояние визуализации, которое не может быть объявленной настройкой (цвета легенды по агентам, сортировка, фильтры), сохраняется между сессиями в `bb.storage.kv`, доступном только со стороны сервера, отсюда две RPC `*VizSettings`. Часть оверлеев обогащается живьём в слое сервиса: маркеры коммитов из `git log` и статус слияния PR из `gh pr view`.

## Слои

Зависимости идут строго вниз — каждый слой зависит только от вышестоящих.

| Слой | Файл | Ответственность |
| --- | --- | --- |
| Транскрипты (Python) | [tools/tokens.py](tools/tokens.py), [tools/agent_timeline.py](tools/agent_timeline.py), [tools/threads_timeline.py](tools/threads_timeline.py), [tools/git_events.py](tools/git_events.py) | Читают транскрипты `~/.claude/projects`; выдают версионированные `--json`-отчёты: подсчёт токенов/цен, таймлайн одного агента, ленту недавних сессий и добытые git-факты (push/PR/blocked). |
| Ядро (чистый TS) | [src/core/](src/core/index.ts) | Типы, парсинг `--json`-отчёта каждого скрипта (с проверкой версии схемы), форматирование и агрегация — стоимость по проектам, почасовое сжигание, таймлайны агента/тредов, viz/gear-настройки. Без I/O, ни от чего в плагине не зависит. |
| Сервис (оболочка) | [src/service/](src/service/index.ts) | Запускает интерпретатор ([process-runner.ts](src/service/process-runner.ts)), гоняет каждый скрипт ([tokens-runner.ts](src/service/tokens-runner.ts), [agent-timeline-service.ts](src/service/agent-timeline-service.ts), [threads-timeline-service.ts](src/service/threads-timeline-service.ts)), кэширует срезы ([cache.ts](src/service/cache.ts)), разрешает `threadId`→`sessionId` ([thread-session.ts](src/service/thread-session.ts)) и обогащает маркеры коммитов/слияния PR. |
| Точка входа бэкенда | [server.ts](server.ts) | Определяет и регистрирует RPC-контракт и обработчики; объявляет нативные настройки графиков через `bb.settings.define`. |
| Фронтенд | [app.tsx](app.tsx), [pages/](pages/), [components/](components/ui/button.tsx) | Счётчик в шапке + поповер, панель «Usage Analytics» (лента, сводка стоимости, детализация агента) и общий фрейм графика. |
