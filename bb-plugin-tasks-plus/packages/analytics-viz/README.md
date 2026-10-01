# @bb-plugins/analytics-viz

Доменно-нейтральный движок аналитики. Не зависит ни от какого плагина —
зависимости идут строго вниз, к нему.

## Слой 1a — чистое ядро агрегации по времени (`core/`)

Обобщение окон D/W/M и бинирования из
[bb-plugin-token-usage-header](../../bb-plugin-token-usage-header): доменные типы
(`ThreadEntry`, `bins`, `binTotal`) стёрты до двух селекторов, которые вызывающий
передаёт снаружи.

- [`time-window.ts`](core/time-window.ts) — скользящие окна `day`/`week`/`month`
  (`WINDOWS`, `WINDOW_MS`, `windowStartMs`). Окна катящиеся, не календарные.
- [`binning.ts`](core/binning.ts) — `bucketByTime(records, spec)`: суммирует
  метрику каждой записи в бин абсолютной сетки, содержащий её метку времени.
  Сетка сплошная и восходящая; пустой бин присутствует нулём. Держит **закон
  сохранения**: сумма по бинам равна сумме метрик записей внутри окна.
- [`weeks.ts`](core/weeks.ts) — календарные недели зрителя: `mondayOf` —
  местная полночь понедельника, `weekBreaks(times)` — какие столбцы графика
  открывают новую неделю (для календарных начал и для катящихся концов),
  `weekEdgesSince(start, now)` — недельные столбцы по всей истории.

Обе функции тотальны: вырожденный вход (нефинитная граница, непозитивный размер
бина, инвертированное окно) даёт пустой результат, а не исключение.

Покрытие — property-тесты на fast-check рядом с исходниками (`*.test.ts`).

## Слой 1b — чарт-примитивы (`react/`), только чистое и react-only

Пакет **не тянет сторонних зависимостей** (peer — только `react`, который bb
шимит рантаймом): сборщик bb резолвит `packages/*` по realpath и не видит
`node_modules` плагина, поэтому zod и прочие сторонние пакеты здесь жить не
могут — см. [decisions/packages-shared-code-must-be-pure-or-shimmed.md](../../docs/decisions/packages-shared-code-must-be-pure-or-shimmed.md).

- [`bar-geometry.ts`](react/bar-geometry.ts) — `roundedTopBarPath`: чистый SVG-путь
  бара со скруглённым верхом, радиус зажат под размер, тотальна.
- [`lane-geometry.ts`](react/lane-geometry.ts) — `laneSegments`: раскладка лейна на
  сегменты по весам с зазорами; закон сохранения ширины.
- [`bar-shape.tsx`](react/bar-shape.tsx) — `BarShape`: свой `<Bar shape>` поверх
  геометрии; заливка `currentColor` либо явный per-series цвет.
- [`lane-timeline.tsx`](react/lane-timeline.tsx) — `LaneTimeline`: кастомный SVG
  сегментного лейна.

Tasks+ этими примитивами больше не пользуется: его экран аналитики рисует свои
div-столбцы и ряды с разделителями —
[decisions/tasks-analytics-own-bars-and-row-splitters.md](../../docs/decisions/tasks-analytics-own-bars-and-row-splitters.md),
прежняя развилка Recharts-гибрида —
[decisions/analytics-viz-recharts-hybrid.md](../../docs/decisions/analytics-viz-recharts-hybrid.md).

Геометрия покрыта property-тестами (fast-check), компоненты — jsdom/testing-library.

## Дальше (следующие подзадачи зонтика BBPL-254)

Слой 1 (`analytics-viz`) готов. Потребители — слой 2 (bb-plugin-tasks-plus:
лог переходов, RPC-агрегаты, экран дашборда) и слой 2′ (перевод
bb-plugin-token-usage-header на этот пакет, BBPL-261).
