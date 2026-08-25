# Tasks+ — форк плагина Tasks с нативными полями workflow

## Цель

Форк встроенного плагина Tasks (id `tasks-plus`), добавляющий пять нативных
полей задачи под workflow проектной памяти. Заменяет встроенный Tasks:
данные переносятся, встроенный выключается, форк забирает CLI-имя `bb tasks`.

## Поля

| Поле | Тип UI | Хранение | Значения |
| --- | --- | --- | --- |
| Type | одиночный select, nullable | `tasks.type TEXT` | feature, bugfix, spike, refactor, migration, design |
| Estimate | одиночный select, nullable | `tasks.estimate TEXT` | xs, s, m, l, xl |
| Check | мультивыбор | join `task_checks(task_id, check)` | test, review, design, browser |
| Plan Tokens | целое ≥ 0, nullable | `tasks.plan_tokens INTEGER` | — |
| Fact Tokens | целое ≥ 0, nullable | `tasks.fact_tokens INTEGER` | — |

Type/Estimate допускают «пусто» (NULL) — как `priority = 'none'`. Существующие
задачи после переноса остаются без значений.

## Слои (зависимости строго вниз)

1. **db** — `db/schema.ts` (одна append-only миграция: 4 колонки + таблица
   `task_checks`), `db/types.ts` (enum-массивы `TASK_TYPES`, `TASK_ESTIMATES`,
   `TASK_CHECKS`; поля в `Task`, `CreateTaskInput`, `UpdateTaskInput`),
   `db/store.ts` (`TaskRow`, `taskFromRow`, INSERT/UPDATE, `setTaskChecks`,
   `listTaskChecks`).
2. **shared/contract** — DTO задачи + zod-схемы create/update.
3. **api** — проброс полей в create/update/get, эндпоинт замены checks.
4. **cli** — флаги `--type`, `--estimate`, `--check` (повторяемый),
   `--plan-tokens`, `--fact-tokens`; вывод в `show`.
5. **views/detail** — редакторы в `meta.tsx`/`rail.tsx`: select для Type и
   Estimate, popover-мультивыбор для Check, числовые инпуты Plan/Fact.

Шаблоны: `priority` (одиночный select) → Type/Estimate; `labels`
(многие-ко-многим) → Check, но упрощённо — фикс. enum без отдельной таблицы
значений и без привязки к проекту.

## Вне MVP (полировка)

Фильтрация/сортировка по новым полям в списке, колонки списка, чипы на
карточках доски, оптимистичные апдейты новых полей. Поля существуют,
сохраняются, редактируются в детали задачи и ставятся через CLI.

## Сборка и установка

Standalone-репак: зависимость на опубликованный `@get-bb/plugin-sdk`,
`@bb/shared-ui` завендорен через shadcn-реестр (запинен под BB 0.39.0),
импорты переписаны `@bb/shared-ui/*` → `@/*`. Сборка `bb plugin build`.

Перенос: копия `~/.bb/plugins/tasks/data.db*` в `~/.bb/plugins/tasks-plus/`
до первой загрузки; миграция достраивает колонки. `bb plugin disable tasks`,
`bb plugin install .` — форк регистрирует CLI `tasks`.

## Тесты

Существующий vitest-набор сохраняется; добавляются тесты новых полей на
слоях store, api, cli, meta.
