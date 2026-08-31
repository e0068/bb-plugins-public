# @bb-plugins/link-navigation

Общий слой резолва ссылок и навигации по ним. Два яруса.

## resolve.ts — чистый резолв

Ноль импортов: ни `react`, ни `node:path`. Годится и для сервера (обход тела
файла), и для фронта (`linkResolver` редактора на каждую ссылку). Экспорты:

- `isInTabLink(href)` — локальная ли ссылка (не http/https/mailto/`//`/`#…`/пусто).
- `parseHref(href)` — сперва отрезает title (` "..."`), потом якорь `#...`.
- `resolveRelative(fromPath, ref)` — резолвит ref относительно директории
  `fromPath` в абсолютный нормализованный путь; хвостовой слэш дедуплицируется.
- `fileRefFromCode(text)` — инлайн-код вида `references/x.md` как файловая ссылка.

Фронт хвостовую пунктуацию НЕ режет (href уже ограничен скобками разметки) —
сервер режет её сам при разборе сырого текста, до вызова этого слоя.

## jump-stack.ts — чистый стек прыжков

Immutable-хелперы над `{ stack: string[] }` (текущий — последний элемент):
`initStack`, `jumpTo`, `goBack`, `current`, `canGoBack`.

## nav.tsx — навигация (react внешний)

- `useJumpStack(first)` — хук поверх jump-stack.ts.
- `makeLinkResolver(opts)` — строит `linkResolver` для md-editor из
  `isInTabLink` + `parseHref` + `resolveRelative`.

## Почему так

См. [memory/decisions/link-resolve-shared-layer.md](../../memory/decisions/link-resolve-shared-layer.md) —
почему резолв путей вынесен отдельным слоем без `node:path`, и что должно
сойтись между сервером и фронтом.
