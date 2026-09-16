# Tasks+

> A fork of the Tasks plugin that keeps tasks as Markdown files on disk and adds native workflow fields — Type, Estimate, Check, time and budget.

## What it does

Tasks+ is a Linear-style tracker inside bb (plugin id `tasks-plus`) for planning work, delegating it to agents, and keeping the task record connected to the threads doing the work. It carries over everything the built-in Tasks plugin offers — projects and folders, task keys, statuses and priorities, labels, subtasks, Markdown comments, attachments, agent presets and delegation, task mentions, and the full `bb tasks` CLI — and takes over that CLI name so it can replace the built-in plugin.

On top of that base it adds native fields for the project-memory workflow, editable in a task's detail rail: **Type** (feature, bugfix, spike, refactor, migration, design), **Estimate** (xs, s, m, l, xl), **Check** (a multi-select of test, review, design, browser), **Planned Time** and **Actual Time** in whole minutes, and **Budget**, **Limit** and **Cost** in dollars to the cent. Type, Estimate, time and money are nullable — a task can be left unset, like `priority = none`.

The other defining difference from the original is where tasks live: a task is a Markdown file in a status folder on disk, not a row in a database. Board metadata (folders, presets, saved views) is still kept in plugin storage, but the tasks themselves are read fresh from their files, and every edit made from the panel is committed and pushed to the board's git repository.

## How it works

The frontend registers four host slots in [app.tsx](app.tsx):

- `app.slots.navPanel` — the main **Tasks+** panel at path `tasks`, rendered by `TasksAppShell`, with an `experimental_sidebarAccessory` (`TasksSidebarAccessory`) for the sidebar footer.
- `app.slots.threadPanelAction` (id `task`) — a **Task** tab in a thread's right panel (`TaskEmbedPanel`).
- `app.slots.experimental_threadHeaderAction` (id `current-task`) — a task action in the thread header (`CurrentTaskHeaderAction`).
- `app.slots.messageDirective` (id `task`) — renders the `::task{key="…"}` leaf directive inline in a message as a task card (`TaskDirectiveCard`).

The backend ([server.ts](server.ts)) wires the store and its feature modules: `registerTasksApi` (RPC — the only bridge the frontend uses), `registerAttachments`, `registerTasksCli` (the `bb tasks` CLI), `registerDelegation`, `registerMentions`, `registerFolders`, and `registerLifecycle`. Mentions register through `bb.ui.registerMentionProvider` (id `task`, label **Tasks**) so typing `@` in the composer searches tasks by key or title and hands the agent the task's context.

Data comes from disk, not SQL. `createStore` loads a file-backed store where each task is a Markdown file in a status folder (see [decisions/tasks-files-are-the-store.md](decisions/tasks-files-are-the-store.md) and [decisions/tasks-every-file-in-a-status-folder-is-a-task.md](decisions/tasks-every-file-in-a-status-folder-is-a-task.md)); tasks are re-read on every call, while boards, folders, presets, and saved views live in `bb.storage.kv`. The workflow fields are serialized into each file's YAML frontmatter — `type`, `estimate`, `checks`, `minutes` (Planned Time), `minutes_actual` (Actual Time), `budget`, `limit` and `cost` — by [filesync/task-file.ts](filesync/task-file.ts). Legacy `tokens` and `tokens_actual` lines are neither read nor removed; a saved view that still lists the retired `tokens` field is served without it.

Delegated agent threads are tracked live through bb lifecycle events (`thread.created/active/idle/failed/archived/deleted`) plus a `thread-status-reconcile` background service that recovers transitions missed while the plugin was unloaded ([lifecycle/index.ts](lifecycle/index.ts)); thread live-state is process memory and is deliberately not written back into the task file (see [decisions/tasks-plus-thread-state-is-not-a-file-field.md](decisions/tasks-plus-thread-state-is-not-a-file-field.md)).

## Layers

Dependencies run strictly downward: each layer knows only the ones above it in this table.

| Layer | Path | Responsibility |
| --- | --- | --- |
| Types | [db/types.ts](db/types.ts) | `Task`/`CreateTaskInput`/`UpdateTaskInput` DTOs and the workflow enum arrays `TASK_TYPES`, `TASK_ESTIMATES`, `TASK_CHECKS`. No I/O. |
| Contract | [shared/contract.ts](shared/contract.ts) | The RPC contract, zod schemas, and DTOs shared by server and app; [shared/format.ts](shared/format.ts) holds the presentation formatters declared once for every screen. |
| File store | [filesync](filesync) | Tasks-as-files: frontmatter parse/serialize, status folders, slugs, board config, patching, roots resolution. |
| API | [api/index.ts](api/index.ts) | RPC handlers over the file store; create/update/get thread the workflow fields and checks. |
| Features | [cli](cli), [delegate](delegate), [mentions](mentions), [folders](folders), [attachments](attachments), [lifecycle](lifecycle), [steer](steer), [threads](threads) | The `bb tasks` CLI, delegation and presets, the `@` mention provider, folders, attachments, thread lifecycle tracking, comment delivery, and live thread state. |
| Client | [client](client) | RPC hooks and queries, invalidation channels, route parsing and navigation, the refresh provider: the app-side seam over the contract, knows no view. |
| Components | [components](components), [editor](editor) | Design-system wrappers, dialogs, staged attachments, task metadata (labels, icons, thread and PR states in [components/task-meta.tsx](components/task-meta.tsx)) and the Markdown editor. |
| Views | [views](views) | Board, list, detail (the Type/Estimate/Check, time and budget editors in [views/detail/rail.tsx](views/detail/rail.tsx)), activity, analytics, manage, embed and header screens. |
| Shell | [shell](shell), [app.tsx](app.tsx) | Composition only: the nav panel, sidebar, top bar and the mounting of views. |

The exact order, server folders included, is declared once in [architecture.test.ts](architecture.test.ts) and enforced by that test through [packages/layer-guard](../packages/layer-guard): an import that points up, sideways within a layer, or at a folder no layer lists fails the suite.

---

# Tasks+ — по-русски

> Форк плагина Tasks: задачи хранятся Markdown-файлами на диске, добавлены нативные поля рабочего процесса — Type, Estimate, Check, время и бюджет.

## Для чего нужен

Tasks+ — трекер в стиле Linear внутри bb (id плагина `tasks-plus`) для планирования работы, делегирования её агентам и связи записи о задаче с тредами, которые её делают. Он переносит всё, что даёт встроенный плагин Tasks — проекты и папки, ключи задач, статусы и приоритеты, метки, подзадачи, Markdown-комментарии, вложения, пресеты агентов и делегирование, упоминания задач и полный CLI `bb tasks`, — и забирает себе имя этого CLI, чтобы заменить встроенный плагин.

Поверх этой базы он добавляет нативные поля для workflow проектной памяти, редактируемые в рейле задачи: **Type** (feature, bugfix, spike, refactor, migration, design), **Estimate** (xs, s, m, l, xl), **Check** (мультивыбор из test, review, design, browser), **Planned Time** и **Actual Time** в целых минутах, **Budget**, **Limit** и **Cost** в долларах с точностью до цента. Type, Estimate, время и деньги допускают пустое значение — задачу можно оставить без них, как `priority = none`.

Второе принципиальное отличие от оригинала — где живут задачи: задача это Markdown-файл в папке статуса на диске, а не строка в базе. Метаданные доски (папки, пресеты, сохранённые виды) по-прежнему хранятся в хранилище плагина, но сами задачи читаются заново из своих файлов, а каждая правка из панели коммитится и пушится в git-репозиторий доски.

## Как устроено

Фронтенд занимает четыре слота хоста в [app.tsx](app.tsx):

- `app.slots.navPanel` — основная панель **Tasks+** по пути `tasks`, её рисует `TasksAppShell`, с `experimental_sidebarAccessory` (`TasksSidebarAccessory`) в подвале сайдбара.
- `app.slots.threadPanelAction` (id `task`) — вкладка **Task** в правой панели треда (`TaskEmbedPanel`).
- `app.slots.experimental_threadHeaderAction` (id `current-task`) — действие задачи в шапке треда (`CurrentTaskHeaderAction`).
- `app.slots.messageDirective` (id `task`) — рендерит листовую директиву `::task{key="…"}` в сообщении карточкой задачи (`TaskDirectiveCard`).

Бэкенд ([server.ts](server.ts)) собирает store и его модули: `registerTasksApi` (RPC — единственный мост, которым пользуется фронтенд), `registerAttachments`, `registerTasksCli` (CLI `bb tasks`), `registerDelegation`, `registerMentions`, `registerFolders` и `registerLifecycle`. Упоминания регистрируются через `bb.ui.registerMentionProvider` (id `task`, метка **Tasks**): `@` в композере ищет задачи по ключу или заголовку и отдаёт агенту контекст задачи.

Данные берутся с диска, а не из SQL. `createStore` поднимает файловый store, где каждая задача — Markdown-файл в папке статуса (см. [decisions/tasks-files-are-the-store.md](decisions/tasks-files-are-the-store.md) и [decisions/tasks-every-file-in-a-status-folder-is-a-task.md](decisions/tasks-every-file-in-a-status-folder-is-a-task.md)); задачи перечитываются на каждый вызов, а доски, папки, пресеты и сохранённые виды лежат в `bb.storage.kv`. Поля workflow сериализуются в YAML-frontmatter каждого файла — `type`, `estimate`, `checks`, `minutes` (Planned Time), `minutes_actual` (Actual Time), `budget`, `limit` и `cost` — модулем [filesync/task-file.ts](filesync/task-file.ts). Старые строки `tokens` и `tokens_actual` плагин не читает и не стирает; сохранённый вид, где ещё значится снятое поле `tokens`, отдаётся без него.

Делегированные треды агентов отслеживаются вживую через события жизненного цикла bb (`thread.created/active/idle/failed/archived/deleted`) плюс фоновый сервис `thread-status-reconcile`, который восстанавливает переходы, пропущенные пока плагин был выгружен ([lifecycle/index.ts](lifecycle/index.ts)); живое состояние треда держится в памяти процесса и намеренно не пишется обратно в файл задачи (см. [decisions/tasks-plus-thread-state-is-not-a-file-field.md](decisions/tasks-plus-thread-state-is-not-a-file-field.md)).

## Слои

Зависимости идут строго вниз: каждый слой знает только про те, что выше него в таблице.

| Слой | Путь | Ответственность |
| --- | --- | --- |
| Типы | [db/types.ts](db/types.ts) | DTO `Task`/`CreateTaskInput`/`UpdateTaskInput` и enum-массивы полей workflow `TASK_TYPES`, `TASK_ESTIMATES`, `TASK_CHECKS`. Без I/O. |
| Контракт | [shared/contract.ts](shared/contract.ts) | RPC-контракт, zod-схемы и DTO, общие для сервера и приложения; в [shared/format.ts](shared/format.ts) — форматтеры показа, объявленные один раз для всех экранов. |
| Файловый store | [filesync](filesync) | Задачи-как-файлы: разбор/сериализация frontmatter, папки статусов, слаги, конфиг доски, патчи, разрешение корней. |
| API | [api/index.ts](api/index.ts) | RPC-обработчики поверх файлового store; create/update/get проводят поля workflow и checks. |
| Функции | [cli](cli), [delegate](delegate), [mentions](mentions), [folders](folders), [attachments](attachments), [lifecycle](lifecycle), [steer](steer), [threads](threads) | CLI `bb tasks`, делегирование и пресеты, провайдер упоминаний `@`, папки, вложения, отслеживание жизненного цикла тредов, доставка комментариев и живое состояние тредов. |
| Клиент | [client](client) | RPC-хуки и запросы, каналы инвалидации, разбор маршрута и навигация, провайдер рефреша: стык приложения с контрактом, про экраны не знает. |
| Компоненты | [components](components), [editor](editor) | Обёртки дизайн-системы, диалоги, черновик вложений, метаданные задачи (подписи, иконки, состояния тредов и PR в [components/task-meta.tsx](components/task-meta.tsx)) и Markdown-редактор. |
| Экраны | [views](views) | Доска, список, деталь (редакторы Type/Estimate/Check, времени и бюджета в [views/detail/rail.tsx](views/detail/rail.tsx)), активность, аналитика, управление, embed и шапка. |
| Оболочка | [shell](shell), [app.tsx](app.tsx) | Только композиция: нав-панель, сайдбар, топбар и монтаж экранов. |

Точный порядок, включая серверные папки, объявлен один раз в [architecture.test.ts](architecture.test.ts) и охраняется этим тестом через [packages/layer-guard](../packages/layer-guard): импорт вверх, вбок внутри слоя или в папку, которой нет в слоях, роняет прогон.
