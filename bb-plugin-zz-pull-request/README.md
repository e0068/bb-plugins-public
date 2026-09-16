# Pull Request

> Thread-header buttons that open and merge a GitHub Pull Request via the API without a push, and wake a thread whose environment got stuck retiring.

> The `zz-` prefix in the package name isn't cosmetic: BB derives the plugin id from the package name and sorts the thread header buttons by it alphabetically. `zz-` keeps this plugin's buttons rightmost among the plugin buttons. Rename it back and they silently drift left. Details: [../memory/decisions/pr-button-rightmost-via-plugin-id.md](../memory/decisions/pr-button-rightmost-via-plugin-id.md).

## What it does

This plugin adds a row of buttons to the BB thread header for the "commit is done, now publish it" moment. Once the branch is fully committed it opens a GitHub Pull Request straight through the GitHub REST API — no `git push` — and, on the merged/clean side, offers Merge and Archive. When BB mis-marks a still-alive thread's environment as "retiring" (which hides the git-dependent buttons and leaves the environment one step from destruction), a **Wake up** button brings it back.

Exactly one of Pull Request / Merge / Archive is visible at a time, reflecting where the branch is in its lifecycle; a Fast-forward button appears when the branch can catch up with `main`, and Wake up appears only while the environment is winding down. Alongside the buttons, every thread row in the sidebar is painted with a small glyph showing that thread's PR-work phase (uncommitted, committed, PR open, conflict, reviewed, merged).

## How it works

The frontend entry `app.tsx` registers five `app.slots.experimental_threadHeaderAction` slots — `wake-up`, `fast-forward`, `pull-request`, `merge`, `archive` — each a self-contained component that polls its own visibility/state RPC and hides when not applicable. It also calls `registerRowStatus`, a content script that paints the per-row glyph via `experimental_setThreadRowStatus`. That script has no host tree context, so it reads the thread list from the sidebar DOM and the active thread from the route, then fetches facts through the plugin's own `rowFacts` RPC over a plain same-origin `fetch` (no SDK hook — see the module doc in [src/content/row-status-content.tsx](src/content/row-status-content.tsx)).

The backend entry `server.ts` registers the RPC contract (`prState`, `createPr`, `mergePr`, `fastForwardState`/`fastForward`, `wakeUpState`/`wakeUp`, `archiveState`/`archiveThread`, `rowFacts`, `baseModeState`/`setBaseMode`, and the composite `createAndMergePr` / `createMergeArchivePr` / `mergeArchivePr`), one secret `githubToken` setting (an optional override; the token otherwise comes from `gh auth token` on the machine), and a `bb.realtime.publish("changed", …)` signal. It republishes that signal on `environment:changed` and on PR-touching `thread:changed` events, plus a short catch-up burst right after any mutation, so open interfaces refetch instead of waiting for the next poll.

The PR is created with no push: `src/wiring/create-pr.ts` walks the GitHub API in order — base → merge-base commit → blobs → tree → commit → ref → pull — making the PR commit's parent the branch's merge-base with `origin/main` so it carries exactly the branch's own changes ([../memory/decisions/pr-button-github-api-no-push.md](../memory/decisions/pr-button-github-api-no-push.md), [../memory/decisions/pr-commit-parent-is-merge-base.md](../memory/decisions/pr-commit-parent-is-merge-base.md)). Wake up calls `bb.sdk.threads.unarchive`, an idempotent SDK action that also cancels a stuck retire as a side effect before any live command reaches the provider ([../memory/decisions/retire-shelf-plugin.md](../memory/decisions/retire-shelf-plugin.md)). Data comes from `bb.sdk` (environments/threads/plugins), local git, the GitHub API, and the `bb` CLI (to move linked tasks through `in_review`/`done`) — no DOM scraping beyond the sidebar-row read noted above.

Every button that measures or moves against the base branch (Fast Forward, Pull Request, Merge, the "main not pulled" retry) shares one **base mode** — Origin (default) or Local main — picked from a two-item dropdown on any of those buttons and persisted per environment in plugin KV. `src/core/base-branch.ts`'s `resolveBase(env, mode)` resolves it into `statusBase` (what `sdk.environments.status` and the raw git checks compare against — `origin/<x>` or the bare local ref) and `githubBase` (always bare, for the GitHub API, mode-independent). See [../memory/decisions/base-mode-toggle-origin-vs-local.md](../memory/decisions/base-mode-toggle-origin-vs-local.md).

## Triggers and actions

What the buttons do is data, not code: the plugin's settings page has a **Triggers and actions** table. Each row holds trigger tags (a button click, a state change, the outcome of an action) and action tags (show a button, create or merge the PR, pull main, bump versions, move linked tasks, archive, reinstall, refresh). On a trigger the plugin runs the actions of every row holding it, in row order, then tag order; showing a button is an action too. The default rows reproduce the behaviour described above exactly. Agents read and change the same table with the `pr_automation_read` and `pr_automation_save` tools — see [skills/pr-automation/SKILL.md](skills/pr-automation/SKILL.md) and [../plugin-docs/pull-request-architecture.md](../plugin-docs/pull-request-architecture.md).

## Layers

The backend is functional core / imperative shell with dependencies pointing strictly down: pure decisions in `src/core`, effect orchestration in `src/wiring`, and the actual I/O behind single client ports.

| Layer | File | Responsibility |
| --- | --- | --- |
| Backend entry | [server.ts](server.ts) | Registers the RPC contract, the secret `githubToken` setting, the realtime `changed` signal, and the `environment:changed` / `thread:changed` subscriptions |
| Frontend entry | [app.tsx](app.tsx) | Registers the five `experimental_threadHeaderAction` slots and the row-status content script |
| Pure core (layer 1) | [src/core/](src/core) | Effect-free decisions: button visibility, merge/archive/fast-forward readiness, GitHub request building, row-status phase, PR title/body |
| Shell / wiring (layer 3) | [src/wiring/](src/wiring) | Orchestrates the effects through injectable ports, verified with fakes: `create-pr`, `merged-content`, `fast-forward`, `linked-task`, `plugin-reinstall`, … |
| Effect ports | [src/wiring/github-client.ts](src/wiring/github-client.ts), [src/wiring/git-client.ts](src/wiring/git-client.ts), [src/wiring/bb-cli-client.ts](src/wiring/bb-cli-client.ts) | The single I/O points: GitHub `fetch`, local `git`, the `bb` CLI |
| Row glyph (frontend) | [src/content/](src/content) | Content script that reads the sidebar + `rowFacts` and writes each thread row's glyph |
| Notifications (frontend) | [src/ui/notify.tsx](src/ui/notify.tsx) | Surfaces outcomes as toasts through BB's `sonner` |

---

# Pull Request — по-русски

> Кнопки в шапке треда: открывают и мёрджат GitHub Pull Request через API без push, а также будят тред, чьё окружение застряло в retiring.

> Префикс `zz-` в имени пакета не косметика: BB выводит id плагина из имени пакета и сортирует кнопки в шапке треда по нему по алфавиту. `zz-` держит кнопки этого плагина крайними справа среди плагинных. Верни имя назад — и кнопки молча уедут влево. Подробнее: [../memory/decisions/pr-button-rightmost-via-plugin-id.md](../memory/decisions/pr-button-rightmost-via-plugin-id.md).

## Для чего нужен

Плагин добавляет в шапку треда BB ряд кнопок для момента «закоммитил — теперь опубликуй». Когда ветка полностью закоммичена, он открывает GitHub Pull Request прямо через REST API GitHub — без `git push` — а на стороне «смёрджено/чисто» предлагает Merge и Archive. Когда BB ошибочно помечает окружение живого треда как «retiring» (это прячет зависящие от git кнопки и оставляет окружение в шаге от уничтожения), кнопка **Wake up** возвращает его.

Одновременно видна ровно одна из Pull Request / Merge / Archive — в зависимости от того, где ветка в своём жизненном цикле; кнопка Fast-forward появляется, когда ветку можно подтянуть к `main`, а Wake up — только пока окружение сворачивается. Рядом с кнопками каждая строка треда в сайдбаре помечается маленьким глифом фазы PR-работы этого треда (не закоммичено, закоммичено, PR открыт, конфликт, отревьюено, смёрджено).

## Как устроено

Фронтовый вход `app.tsx` регистрирует пять слотов `app.slots.experimental_threadHeaderAction` — `wake-up`, `fast-forward`, `pull-request`, `merge`, `archive` — каждый самодостаточный компонент опрашивает свой RPC видимости/состояния и прячется, когда неприменим. Он же вызывает `registerRowStatus` — content-скрипт, рисующий построчный глиф через `experimental_setThreadRowStatus`. У этого скрипта нет контекста дерева хоста, поэтому список тредов он читает из DOM сайдбара, активный тред — из роута, а факты берёт через собственный RPC плагина `rowFacts` обычным same-origin `fetch` (без SDK-хука — см. док-комментарий в [src/content/row-status-content.tsx](src/content/row-status-content.tsx)).

Бэкендовый вход `server.ts` регистрирует контракт RPC (`prState`, `createPr`, `mergePr`, `fastForwardState`/`fastForward`, `wakeUpState`/`wakeUp`, `archiveState`/`archiveThread`, `rowFacts`, `baseModeState`/`setBaseMode`, а также составные `createAndMergePr` / `createMergeArchivePr` / `mergeArchivePr`), одну секретную настройку `githubToken` (необязательный оверрайд; иначе токен берётся из `gh auth token` на машине) и сигнал `bb.realtime.publish("changed", …)`. Он переиздаёт этот сигнал на `environment:changed` и на затрагивающих PR событиях `thread:changed`, плюс короткой серией сразу после мутации, чтобы открытые интерфейсы перезапрашивали данные, не дожидаясь следующего опроса.

PR создаётся без push: `src/wiring/create-pr.ts` идёт по API GitHub по порядку — base → коммит merge-base → blob'ы → tree → commit → ref → pull — делая родителем коммита PR merge-base ветки с `origin/main`, так что коммит несёт ровно изменения самой ветки ([../memory/decisions/pr-button-github-api-no-push.md](../memory/decisions/pr-button-github-api-no-push.md), [../memory/decisions/pr-commit-parent-is-merge-base.md](../memory/decisions/pr-commit-parent-is-merge-base.md)). Wake up вызывает `bb.sdk.threads.unarchive` — идемпотентное SDK-действие, которое как побочный эффект гасит застрявший retire, прежде чем к провайдеру уйдёт хоть одна живая команда ([../memory/decisions/retire-shelf-plugin.md](../memory/decisions/retire-shelf-plugin.md)). Данные приходят из `bb.sdk` (environments/threads/plugins), локального git, API GitHub и CLI `bb` (чтобы переводить связанные задачи в `in_review`/`done`) — без скрейпинга DOM сверх чтения строк сайдбара, отмеченного выше.

Все кнопки, что-либо меряющие или двигающие относительно базовой ветки (Fast Forward, Pull Request, Merge, ретрай «main not pulled»), делят один общий **режим базы** — Origin (по умолчанию) или Local main — выбираемый выпадающим списком из двух пунктов на любой из этих кнопок и хранимый в plugin KV на окружение. `resolveBase(env, mode)` из `src/core/base-branch.ts` разрешает его в `statusBase` (с чем сравнивают `sdk.environments.status` и сырые git-проверки — `origin/<x>` или голый локальный ref) и `githubBase` (всегда голое имя для GitHub API, от режима не зависит). См. [../memory/decisions/base-mode-toggle-origin-vs-local.md](../memory/decisions/base-mode-toggle-origin-vs-local.md).

## Триггеры и действия

Что делают кнопки — данные, а не код: на странице настроек плагина есть таблица **Триггеры и действия**. В строке — теги триггеров (клик по кнопке, изменение состояния, исход действия) и теги действий (показать кнопку, создать или смёрджить PR, подтянуть main, поднять версии, перевести связанные задачи, архивировать, переустановить, обновить шапку). На триггер плагин выполняет действия всех строк, где он есть, по порядку строк, затем тегов; показ кнопки — тоже действие. Строки по умолчанию в точности воспроизводят поведение, описанное выше. Агенты читают и меняют ту же таблицу инструментами `pr_automation_read` и `pr_automation_save` — см. [skills/pr-automation/SKILL.md](skills/pr-automation/SKILL.md) и [../plugin-docs/pull-request-architecture.md](../plugin-docs/pull-request-architecture.md).

## Слои

Бэкенд устроен как функциональное ядро / императивная оболочка с зависимостями строго вниз: чистые решения в `src/core`, оркестрация эффектов в `src/wiring`, а сам ввод-вывод — за единственными клиент-портами.

| Слой | Файл | Ответственность |
| --- | --- | --- |
| Вход бэкенда | [server.ts](server.ts) | Регистрирует контракт RPC, секретную настройку `githubToken`, realtime-сигнал `changed` и подписки `environment:changed` / `thread:changed` |
| Вход фронта | [app.tsx](app.tsx) | Регистрирует пять слотов `experimental_threadHeaderAction` и content-скрипт статуса строк |
| Чистое ядро (слой 1) | [src/core/](src/core) | Решения без эффектов: видимость кнопок, готовность merge/archive/fast-forward, сборка запросов GitHub, фаза статуса строки, заголовок/тело PR |
| Оболочка / wiring (слой 3) | [src/wiring/](src/wiring) | Оркестрирует эффекты через внедряемые порты, проверяется на фейках: `create-pr`, `merged-content`, `fast-forward`, `linked-task`, `plugin-reinstall`, … |
| Порты эффектов | [src/wiring/github-client.ts](src/wiring/github-client.ts), [src/wiring/git-client.ts](src/wiring/git-client.ts), [src/wiring/bb-cli-client.ts](src/wiring/bb-cli-client.ts) | Единственные точки ввода-вывода: `fetch` к GitHub, локальный `git`, CLI `bb` |
| Глиф строки (фронт) | [src/content/](src/content) | Content-скрипт: читает сайдбар и `rowFacts`, пишет глиф каждой строки треда |
| Уведомления (фронт) | [src/ui/notify.tsx](src/ui/notify.tsx) | Показывает исходы тостами через `sonner` BB |
