# @bb-plugins/reduced-colors

Режим Reduced Colors для графиков плагинов: вместо пёстрой палитры серии красятся ступенями растяжки между двумя цветами, которые пользователь выбрал сам, — своей парой для светлой и для тёмной темы. Спецификация — [docs/specs/grafiki-rezhim-reduced-colors-rastyazhka-ot-odnogo-cveta-k-d.md](../../docs/specs/grafiki-rezhim-reduced-colors-rastyazhka-ot-odnogo-cveta-k-d.md), решения — [reduced-colors-alarm-red-stays](../../docs/decisions/reduced-colors-alarm-red-stays.md) и [reduced-colors-pair-per-theme](../../docs/decisions/reduced-colors-pair-per-theme.md).

Сторонних зависимостей нет, peer — только `react`: общий пакет не может тянуть свои (см. [packages-shared-code-must-be-pure-or-shimmed](../../docs/decisions/packages-shared-code-must-be-pure-or-shimmed.md)).

## Слой 1 — растяжка (`core/ramp.ts`)

`rampColors(low, high, count)` — `count` цветов `#rrggbb`: первый ровно `low`, последний ровно `high`, между ними равные шаги в oklab. Одна серия получает `low`. `isHexColor` — `#rgb` или `#rrggbb`. Функции тотальны: сломанный конец заменяется другим, нечего красить — пустой список.

## Слой 2 — настройка (`core/settings.ts`)

`ReducedColors` — `{ enabled, light: { low, high }, dark: { low, high } }`, хранится в KV плагина под `REDUCED_COLORS_KV_KEY`. `parseReducedColors` разбирает сырое значение по полю, сломанное берёт из `DEFAULT_REDUCED_COLORS`. `seriesColors(settings, mode, palette)` — палитра серий в порядке легенды как есть при выключенном режиме и ступени пары темы при включённом.

## Слой 3 — React (`react/`)

- `ReducedColorsProvider({ load })` — один раз на корень грузит настройку функцией плагина и раздаёт её графикам; `useSeriesColors(palette)` — цвета серий в текущей теме хоста.
- `ReducedColorsSection({ load, save })` — блок для `app.slots.settingsSection`: тумблер, две строки тем с пикерами, полями hex, превью ступеней и Swap; сохраняет через 300 мс после последней правки.

Стили секции — инлайн на переменных темы bb: Tailwind bb сканирует только папку плагина, классы из `packages/` в его CSS не попадают.

## Как подключить к плагину

1. В RPC-контракт — `loadReducedColors` (выход `parseReducedColors` поверх `bb.storage.kv.get(REDUCED_COLORS_KV_KEY)`) и `saveReducedColors` (пишет KV).
2. В `app.tsx` — `app.slots.settingsSection({ id: "reduced-colors", title: "Reduced Colors", component })`, где компонент отдаёт `ReducedColorsSection` вызовы этих методов.
3. Корень экрана с графиками — в `ReducedColorsProvider`, цвет серии — из `useSeriesColors` по палитре в порядке легенды.

Тесты: `npm test` — property на fast-check для ядра, jsdom/testing-library для React.
