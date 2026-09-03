# Tasks+ — fork of the Tasks plugin with native workflow fields

## Goal

A fork of the built-in Tasks plugin (id `tasks-plus`) that adds five native
task fields for the project-memory workflow. Replaces the built-in Tasks:
data is migrated, the built-in plugin is disabled, and the fork takes over
the `bb tasks` CLI name.

## Fields

| Field | UI type | Storage | Values |
| --- | --- | --- | --- |
| Type | single select, nullable | `tasks.type TEXT` | feature, bugfix, spike, refactor, migration, design |
| Estimate | single select, nullable | `tasks.estimate TEXT` | xs, s, m, l, xl |
| Check | multi-select | join `task_checks(task_id, check)` | test, review, design, browser |
| Plan Tokens | integer ≥ 0, nullable | `tasks.plan_tokens INTEGER` | — |
| Fact Tokens | integer ≥ 0, nullable | `tasks.fact_tokens INTEGER` | — |

Type/Estimate allow "empty" (NULL) — like `priority = 'none'`. Existing
tasks remain unset after the migration.

## Layers (dependencies strictly downward)

1. **db** — `db/schema.ts` (a single append-only migration: 4 columns + the
   `task_checks` table), `db/types.ts` (enum arrays `TASK_TYPES`,
   `TASK_ESTIMATES`, `TASK_CHECKS`; fields on `Task`, `CreateTaskInput`,
   `UpdateTaskInput`), `db/store.ts` (`TaskRow`, `taskFromRow`,
   INSERT/UPDATE, `setTaskChecks`, `listTaskChecks`).
2. **shared/contract** — task DTO + create/update zod schemas.
3. **api** — thread fields through create/update/get, the checks-replace
   endpoint.
4. **cli** — flags `--type`, `--estimate`, `--check` (repeatable),
   `--plan-tokens`, `--fact-tokens`; output in `show`.
5. **views/detail** — editors in `meta.tsx`/`rail.tsx`: select for Type and
   Estimate, popover multi-select for Check, numeric inputs for Plan/Fact.

Templates: `priority` (single select) → Type/Estimate; `labels`
(many-to-many) → Check, but simplified — a fixed enum with no separate
values table and no project binding.

## Out of MVP scope (polish)

Filtering/sorting by the new fields in the list, list columns, chips on
board cards, optimistic updates for the new fields. The fields exist, are
persisted, are editable in task detail, and can be set via the CLI.

## Build and install

Standalone repack: depends on the published `@get-bb/plugin-sdk`,
`@bb/shared-ui` is vendored via the shadcn registry (pinned to BB 0.39.0),
imports rewritten from `@bb/shared-ui/*` to `@/*`. Build with
`bb plugin build`.

Migration: copy `~/.bb/plugins/tasks/data.db*` into `~/.bb/plugins/tasks-plus/`
before the first load; the migration adds the columns. `bb plugin disable tasks`,
`bb plugin install .` — the fork registers the `tasks` CLI.

## Tests

The existing vitest suite is kept; tests for the new fields are added at
the store, api, cli, and meta layers.
