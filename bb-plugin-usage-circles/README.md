# Usage Limits

> Claude Code and Codex usage-limit rings in the sidebar footer — a ring per limit or one for all, the limits as a list or cards.

The plugin's id stays `usage-circles`, its name before the rename.

## What it does

Every usage-limit window is its own item in BB's sidebar footer: Claude Code's 5-hour, weekly and Fable weekly windows, Codex's 5-hour and weekly windows. Customize footer places, hides and reorders each ring like any other footer item. The item's icon is the window drawn as two concentric rings — the outer ring is the used share, colored by threshold, the inner ring is how much of the window has elapsed toward its reset: a solid arc for the 5-hour window, seven day-segments for a weekly one. The provider's logo sits in the middle of the rings, or in the ring's top right corner if the setting says so — Claude Code's in its orange brand color, Codex's in the text color. While a provider is signed out, failing, or lacks that window, its ring stays empty. In the footer row the ring fills almost the whole 32 px button at full opacity, instead of BB's small dimmed icon box.

Hovering an item opens its window above the footer row; only the pin in the window's header pins it — a click on the item does not. The window, headed by the provider's logo and "Claude Code Limits" or "Codex Limits" in the shared footer window's header, lists every limit of the item's provider, the hovered ring's own limit set off the way the sidebar marks its selected thread — a rounded background inset from the edges: one line with the window's short name ("5 hour", "7 days", or the model it is for, "Fable"), the time left to the reset with its clock time — and its day for a weekly window — and the percentage, over a usage bar and a time bar — or why there is no data. Only the pin unpins the window: Escape, a click on the ring and another footer window leave the pin, and the pinned window comes back once the footer is free. A pinned window resizes by dragging its top edge, and a double click on the edge fits it to the content; the height is remembered per item. While a window is pinned, hovering another footer item shows that item's window in its place until the pointer leaves.

The **Window layout** setting picks how the windows show the limits. **List** — a line per limit, as above. **Grid** — every ring opens one window, "Usage Limits": every picked limit of both providers as a card in two columns — the provider's logo, the name and the percent, the two bars, and under them the time to the reset on the left and its clock time on the right; the ring's own card is marked, and an odd last card takes both columns; a provider that is signed out or failed gets a line under the cards saying why. The footer item "Usage Limits" opens the same window in any layout, wherever Customize footer puts it; its icon is the ring of the first picked limit, without a logo, since it stands for both providers. **All limits** — the footer keeps only that item and hides the five rings: BB registers footer items once, so the layout hides the ones it does not use. The **Limits** section of the settings picks which limits show — a switch each, which also hides a switched-off limit's ring in the List and Grid layouts — and moves them up and down; a limit Anthropic or OpenAI report that no ring stands for still shows, after the picked ones. A window whose item a change hides closes and forgets its pin.

Settings:

- **Show panel on hover.** Off — the window opens on click only.
- **Provider logo** — in the middle of the rings (default) or in the ring's top right corner.
- **Ring color** — how the rings are colored, each mode with its own yellow and red thresholds:
  - **Share of limit used** — by the percent of the limit burned; yellow from 60%, red from 90% by default.
  - **Usage ahead of time** — by how far usage runs ahead of the time elapsed in the window, as a ratio: 20% means the limit burns 1.2× faster than time. Yellow from 20%, red from 50% by default. The same lead reads the same early and late in the window. While the reset time is unknown, or less than 0.001% of the window has passed, there is no pace to judge: the usage arc is drawn in the text color, and the time ring stays empty — with the logo in the corner a question mark replaces it.
- **Ring** — its own section below the settings: the five rings as they look now and, under **Fine-tune ring**, a slider per dimension: the ring's size, the thickness of each ring, the space between them, the gap between a weekly ring's days, the strength of the empty track, and the logo's size — plus, with the logo in the corner, its backing and how far it sticks out. The footer follows a slider as it moves; the value is kept once the slider is let go. **Reset to defaults** brings back a 28 px ring, 2 px rings 1 px apart and a 12 px logo.

## How it works

The frontend registers six `experimental_sidebarFooter` disclosure items, one per ring in `FOOTER_RINGS` and one for every limit, each with its own icon through `experimental_icons` — a React component, so the footer shows the live ring rather than a named glyph. BB renders those icons outside any plugin context, so an invisible `experimental_appOverlay` polls the backend's `getState` once a minute — and at once when the logo or layout setting changes — and publishes the usage and the ring style to module stores the icons and windows read. The Ring section is a `settingsSection`: its sliders publish to the same store while they move and store the dimensions through `setRingDims`, which keeps them in the plugin's KV store; `resetRingDims` forgets them. The Limits section stores the limits picked and their order through `setLimits`, in the same KV store, and shows the change in the windows at once. The overlay also renders a style that hides the footer items the layout does not use. The sliders, the switches, the fold and the buttons are the `@bb` registry's components in [components/ui](components/ui). The window's behavior — hover, pin, resize, the thin line instead of BB's frame — comes from the shared package [packages/footer-window](../packages/footer-window/README.md), which Archived, Connections and Notification Center use too.

Data comes straight from BB, not from scraping provider files: the backend ([server.ts](server.ts)) calls `bb.sdk.system.usageLimits()` and picks each provider by its hyphenated id, `claude-code` and `codex`, from the one response. Because Anthropic's account usage endpoint is tightly rate-limited, the backend puts a short-TTL, request-coalescing cache in front of that call. Logos and tints come from `bb.sdk.providers.list()`; the host serves each logo as a `currentColor` SVG, which the item uses as a CSS mask over a box painted with `light-dark()` of the tint, so the mark follows the theme. Settings are declared with `bb.settings.define`.

## Layers

| Layer | File | Responsibility |
| --- | --- | --- |
| 1 — pure logic | [lib/ring-style.ts](lib/ring-style.ts) | The ring's look: logo placement, the dimensions with their sliders' ranges and defaults, reading stored dimensions back, the rings' radii. |
| 1 — pure logic | [lib/usage-model.ts](lib/usage-model.ts) | Parse the SDK response and the coloring settings, pick a provider, build the window model; the five footer rings and which window each one shows; the window layout, the limits picked and their order; the wire types shared by backend and frontend. No DOM. |
| 2 — rendering | [lib/render.ts](lib/render.ts) | Turn models into DOM: `buildProviderLogo`, `buildRingIcon`, `buildWindowRow`, `buildLimitCard`, `buildProviderDetails` — a provider's whole window as a list or a grid — and `buildAllLimits`, the window of every limit. |
| 3 — footer items | [lib/footer-items.tsx](lib/footer-items.tsx) | The usage and ring-style stores, the ring icon with its logo, the provider window, the item of every limit, and the style that hides the items the layout does not use. |
| 4 — settings | [lib/ring-settings.tsx](lib/ring-settings.tsx) | The Ring section, over the footer items: the rings' preview, the sliders, reset. |
| 4 — settings | [lib/limits-settings.tsx](lib/limits-settings.tsx) | The Limits section: a switch and up and down arrows per limit. |
| cache | [lib/usage-cache.ts](lib/usage-cache.ts) | Short-TTL cache that coalesces concurrent calls in front of the rate-limited account endpoint. |
| backend entry | [server.ts](server.ts) | Define settings, register `getState`, `setRingDims`, `resetRingDims` and `setLimits`, read `bb.sdk.system.usageLimits()` and `bb.sdk.providers.list()`, keep the ring's dimensions and the limits picked in KV. |
| frontend entry | [app.tsx](app.tsx) | Register the six icons and footer items, the shared window, the overlay that polls `getState` and hides the items the layout does not use, and the Ring and Limits settings sections. |

## Development

```
npm install --include=dev
npm test
```

---

# Usage Limits — по-русски

> Кольца лимитов Claude Code и Codex в футере боковой панели — по кольцу на лимит или одно на все, лимиты списком или карточками.

Id плагина остаётся `usage-circles` — его имя до переименования.

## Для чего нужен

Каждое окно лимита — отдельный пункт футера боковой панели BB: у Claude Code 5-часовое, недельное и недельное Fable, у Codex 5-часовое и недельное. Customize footer ставит, прячет и переставляет каждое кольцо, как любой другой пункт футера. Иконка пункта — окно лимита двумя концентрическими кольцами: внешнее — израсходованная доля, окрашенная по порогу, внутреннее — сколько времени окна прошло до сброса: сплошная дуга для 5-часового окна и семь дневных сегментов для недельного. В середине колец — логотип провайдера, а по настройке — в правом верхнем углу кольца: у Claude Code в фирменном оранжевом, у Codex в цвете текста. Пока провайдер разлогинен, с ошибкой или без такого окна, его кольцо пустое. В строке футера кольцо занимает почти всю кнопку в 32 px и не приглушено, вместо маленькой бледной иконки bb.

Наведение на пункт открывает его окно над строкой футера, булавка в его шапке закрепляет его — клик по пункту не закрепляет. В окне — все лимиты провайдера пункта, лимит того кольца, на которое навели, выделен как выбранный тред боковой панели; в заголовке его логотип и «Claude Code Limits» или «Codex Limits». У каждого лимита одна строка — короткое имя («5 hour», «7 days» или модель, «Fable»), время до сброса с часами, а у недельного и с днём, и процент — над полосой расхода и полосой времени; или причина, почему данных нет. Закреплённое окно тянется по высоте за верхнюю границу, двойной клик по ней — высота по содержимому; высота запоминается для пункта. Пока окно закреплено, наведение на другой пункт футера показывает окно того пункта на его месте, пока указатель не уйдёт.

Настройка **Window layout** выбирает вид окон. **List** — строка на лимит, как описано выше. **Grid** — любое кольцо открывает одно окно «Usage Limits»: все выбранные лимиты обоих провайдеров карточками в две колонки — логотип провайдера, имя и процент, две полосы, под ними время до сброса слева и часы справа; карточка своего кольца выделена, нечётная последняя занимает обе колонки; у провайдера, который не вошёл или упал, под карточками строка с причиной. Пункт футера «Usage Limits» открывает то же окно в любом виде, куда его ни поставь в Customize footer; его иконка — кольцо первого выбранного лимита без логотипа, потому что пункт общий для обоих провайдеров. **All limits** — в футере остаётся только этот пункт, пять колец прячутся: bb регистрирует пункты футера один раз, поэтому вид прячет ненужные ему пункты. Раздел настроек **Limits** выбирает переключателем, какие лимиты видны — в видах List и Grid выключенный лимит прячет и своё кольцо, — и стрелками меняет их порядок; лимит, для которого нет кольца, всё равно показывается после выбранных. Окно пункта, который перемена прячет, закрывается и забывает пин.

Настройки:

- **Показывать панель по наведению.** Выключена — окно открывается только кликом.
- **Provider logo** — в середине колец (по умолчанию) или в правом верхнем углу кольца.
- **Цвет колец** — как красить кольца, у каждого режима своя пара порогов, жёлтый и красный:
  - **Share of limit used** — по доле сожжённого лимита; по умолчанию жёлтый с 60 %, красный с 90 %.
  - **Usage ahead of time** — по тому, во сколько раз расход опережает прошедшее время окна: 20 % значит, что лимит горит в 1,2 раза быстрее времени. По умолчанию жёлтый с 20 %, красный с 50 %. Одинаковое опережение в начале и в конце окна даёт одинаковый цвет. Пока время сброса неизвестно или прошло меньше 0,001 % окна, судить о темпе не по чему: дуга расхода рисуется цветом текста, а кольцо времени остаётся пустым — при логотипе в углу на его месте знак вопроса.
- **Ring** — свой раздел под настройками: пять колец так, как они выглядят сейчас, и под **Fine-tune ring** по ползунку на размер: кольца, толщины каждого из колец, отступа между ними, зазора между днями недельного кольца, яркости пустой дорожки и логотипа, а при логотипе в углу — ещё его подложки и выноса за край. Футер меняется прямо по ходу ползунка, значение сохраняется, когда ползунок отпущен. **Reset to defaults** возвращает кольцо в 28 px, кольца по 2 px с отступом 1 px и логотип 12 px.

## Как устроено

Фронтенд регистрирует шесть пунктов-раскрывашек `experimental_sidebarFooter`, по одному на кольцо из `FOOTER_RINGS` и один на все лимиты, у каждого своя иконка через `experimental_icons` — React-компонент, поэтому в футере живое кольцо, а не значок по имени. Эти иконки BB рисует вне контекста плагина, поэтому невидимый `experimental_appOverlay` раз в минуту — и сразу, как поменялось место логотипа или вид окна, — опрашивает `getState` бэкенда и кладёт расход и вид кольца в хранилища модуля, откуда их читают иконки и окна. Раздел Ring — `settingsSection`: его ползунки пишут в то же хранилище на ходу и сохраняют размеры через `setRingDims` в KV-хранилище плагина; `resetRingDims` их забывает. Раздел Limits сохраняет выбранные лимиты и их порядок через `setLimits` в то же хранилище и сразу показывает перемену в окнах. Ещё оверлей рисует стиль, прячущий пункты футера, которые не нужны виду. Ползунки, переключатели, раскрывашка и кнопки — компоненты реестра `@bb` в [components/ui](components/ui). Поведение окна — наведение, закрепление, высота, тонкая линия вместо рамки BB — даёт общий пакет [packages/footer-window](../packages/footer-window/README.md), им же пользуются Archived, Connections и Notification Center.

Данные берутся прямо из BB, а не из парсинга файлов провайдеров: бэкенд ([server.ts](server.ts)) вызывает `bb.sdk.system.usageLimits()` и выбирает каждого провайдера по дефисному id, `claude-code` и `codex`, из одного ответа. Поскольку эндпойнт использования аккаунта Anthropic жёстко ограничен по частоте, перед этим вызовом стоит кэш с коротким TTL и слиянием параллельных запросов. Логотипы и оттенки берутся из `bb.sdk.providers.list()`; хост отдаёт логотип как SVG в `currentColor`, и пункт накладывает его CSS-маской на плашку, окрашенную `light-dark()` от оттенка, — знак следует теме. Настройки объявлены через `bb.settings.define`.

## Слои

| Слой | Файл | Ответственность |
| --- | --- | --- |
| 1 — чистая логика | [lib/ring-style.ts](lib/ring-style.ts) | Вид кольца: место логотипа, размеры с диапазонами ползунков и значениями по умолчанию, разбор сохранённых размеров, радиусы колец. |
| 1 — чистая логика | [lib/usage-model.ts](lib/usage-model.ts) | Разбор ответа SDK и настроек окраски, выбор провайдера, модель окна; пять колец футера и какое окно показывает каждое; вид окна, выбранные лимиты и их порядок; типы провода, общие для бэкенда и фронтенда. Без DOM. |
| 2 — отрисовка | [lib/render.ts](lib/render.ts) | Превращение моделей в DOM: `buildProviderLogo`, `buildRingIcon`, `buildWindowRow`, `buildLimitCard`, `buildProviderDetails` — всё окно провайдера списком или сеткой — и `buildAllLimits`, окно всех лимитов. |
| 3 — пункты футера | [lib/footer-items.tsx](lib/footer-items.tsx) | Хранилища расхода и вида кольца, иконка-кольцо с логотипом, окно провайдера, пункт всех лимитов и стиль, прячущий ненужные виду пункты. |
| 4 — настройки | [lib/ring-settings.tsx](lib/ring-settings.tsx) | Раздел Ring поверх пунктов футера: превью колец, ползунки, сброс. |
| 4 — настройки | [lib/limits-settings.tsx](lib/limits-settings.tsx) | Раздел Limits: переключатель и стрелки вверх-вниз у каждого лимита. |
| кэш | [lib/usage-cache.ts](lib/usage-cache.ts) | Кэш с коротким TTL, сливающий параллельные вызовы перед ограниченным по частоте эндпойнтом аккаунта. |
| вход бэкенда | [server.ts](server.ts) | Объявление настроек, регистрация `getState`, `setRingDims`, `resetRingDims` и `setLimits`, чтение `bb.sdk.system.usageLimits()` и `bb.sdk.providers.list()`, размеры кольца и выбранные лимиты в KV. |
| вход фронтенда | [app.tsx](app.tsx) | Регистрация шести иконок и пунктов футера, общего окна, оверлея, который опрашивает `getState` и прячет ненужные виду пункты, и разделов настроек Ring и Limits. |

## Разработка

```
npm install --include=dev
npm test
```
