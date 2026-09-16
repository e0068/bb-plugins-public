# Usage Circles

> Claude Code and Codex usage-limit rings in the footer of BB's left sidebar.

## What it does

Adds a compact indicator to the footer of BB's left sidebar showing how much of your Claude Code and Codex usage limits you have burned through. Each provider gets its own group, led by the provider's logo — Claude Code's in its orange brand color, Codex's in the text color. Each limit window is drawn as two concentric rings: the outer ring is the used share, colored by threshold, and the inner ring is how much of the window has elapsed toward its reset — a solid arc for the 5-hour window, seven day-segments for a weekly one.

Clicking a group (or hovering, if enabled) expands a panel for that provider only, headed by its logo and "Claude Code Limits" or "Codex Limits", with one row per window: label, percentage, a usage bar, a time bar, and the reset time. Moving the pointer to the other group switches the panel to that provider. A provider that is not installed has no group; one that is signed out, expired or failing shows its logo alone, and its panel says why.

Settings:

- One switch per footer ring — Claude Code's 5-hour, weekly and Fable weekly windows, Codex's 5-hour and weekly windows. They trim the footer strip only; the panel always lists every window.
- **Show panel on hover.**
- **Ring color** — how the rings are colored, each mode with its own yellow and red thresholds:
  - **Share of limit used** — by the percent of the limit burned; yellow from 60%, red from 90% by default.
  - **Usage ahead of time** — by how far usage runs ahead of the time elapsed in the window, as a ratio: 20% means the limit burns 1.2× faster than time. Yellow from 20%, red from 50% by default. The same lead reads the same early and late in the window. While the reset time is unknown, or less than 0.001% of the window has passed, there is no pace to judge: the usage arc is drawn in the text color and a question mark replaces the time ring.

## How it works

The frontend has no rich-content plugin slot in the sidebar footer — the only footer surface is the single-icon-button `sidebarFooterAction` — so the widget mounts through a trusted content script (`app.contentScripts.register` in [app.ts](app.ts)) as plain DOM rather than a React slot. It polls the backend's single RPC method `getState`, which returns the hover flag, the parsed coloring, and one entry per provider: title, logo URL, brand tint, ring switches, and usage windows.

Data comes straight from BB, not from scraping provider files: the backend ([server.ts](server.ts)) calls `bb.sdk.system.usageLimits()` and picks each provider by its hyphenated id, `claude-code` and `codex`, from the one response. Because Anthropic's account usage endpoint is tightly rate-limited and every open sidebar polls independently, the backend puts a short-TTL, request-coalescing cache in front of that call. Logos and tints come from `bb.sdk.providers.list()`; the host serves each logo as a `currentColor` SVG, which the widget uses as a CSS mask over a box painted with `light-dark()` of the tint, so the mark follows the theme. Settings are declared with `bb.settings.define`.

## Layers

| Layer | File | Responsibility |
| --- | --- | --- |
| 1 — pure logic | [lib/usage-model.ts](lib/usage-model.ts) | Parse the SDK response and the coloring settings, pick a provider, build the window model: usage share, tier color by mode, time share, time left until reset, segment fills; the wire types shared by backend and widget. No DOM. |
| 2 — rendering | [lib/render.ts](lib/render.ts) | Turn models into DOM: `buildProviderLogo` for the masked logo, `buildRingIcon` for the footer ring, `buildWindowRow` for the panel row. |
| 3 — widget | [lib/sidebar-widget.ts](lib/sidebar-widget.ts) | Assemble a group per provider in the sidebar footer, expand that provider's panel, poll state over the `getState` RPC. |
| cache | [lib/usage-cache.ts](lib/usage-cache.ts) | Short-TTL cache that coalesces concurrent calls in front of the rate-limited account endpoint. |
| backend entry | [server.ts](server.ts) | Define settings, register the `getState` RPC, read `bb.sdk.system.usageLimits()` and `bb.sdk.providers.list()`. |
| frontend entry | [app.ts](app.ts) | Register the `sidebar-usage-circles` content script that mounts the widget. |

## Development

```
npm install --include=dev
npm test
```

---

# Usage Circles — по-русски

> Кольца лимитов Claude Code и Codex в футере левого сайдбара BB.

## Для чего нужен

Добавляет в футер левого сайдбара BB компактный индикатор того, сколько из лимитов Claude Code и Codex уже израсходовано. У каждого провайдера своя группа, и перед ней логотип провайдера — у Claude Code в фирменном оранжевом, у Codex в цвете текста. Каждое окно лимита рисуется двумя концентрическими кольцами: внешнее — израсходованная доля, окрашенная по порогу, внутреннее — сколько времени окна прошло до сброса: сплошная дуга для 5-часового окна и семь дневных сегментов для недельного.

По клику на группу (или по наведению, если включено) раскрывается панель только этого провайдера: в заголовке его логотип и «Claude Code Limits» или «Codex Limits», ниже строка на окно — подпись, процент, полоса расхода, полоса времени и время сброса. Если перевести указатель на другую группу, панель перерисуется под её провайдера. У неустановленного провайдера группы нет; у разлогиненного, с истёкшей сессией или с ошибкой — только логотип, а панель объясняет причину.

Настройки:

- Тумблер на каждое кольцо в футере — у Claude Code 5-часовое, недельное и недельное Fable, у Codex 5-часовое и недельное. Они убирают кольца только из футера; панель всегда показывает все окна.
- **Показывать панель по наведению.**
- **Цвет колец** — как красить кольца, у каждого режима своя пара порогов, жёлтый и красный:
  - **Share of limit used** — по доле сожжённого лимита; по умолчанию жёлтый с 60 %, красный с 90 %.
  - **Usage ahead of time** — по тому, во сколько раз расход опережает прошедшее время окна: 20 % значит, что лимит горит в 1,2 раза быстрее времени. По умолчанию жёлтый с 20 %, красный с 50 %. Одинаковое опережение в начале и в конце окна даёт одинаковый цвет. Пока время сброса неизвестно или прошло меньше 0,001 % окна, судить о темпе не по чему: дуга расхода рисуется цветом текста, а вместо кольца времени стоит знак вопроса.

## Как устроено

У футера сайдбара нет слота для богатого контента — единственная поверхность там это кнопка-иконка `sidebarFooterAction`, — поэтому виджет монтируется через доверенный контент-скрипт (`app.contentScripts.register` в [app.ts](app.ts)) как обычный DOM, а не React-слот. Он опрашивает единственный RPC-метод бэкенда `getState`, который возвращает флаг наведения, разобранную окраску и запись на каждого провайдера: название, адрес логотипа, фирменный оттенок, тумблеры колец и окна лимитов.

Данные берутся прямо из BB, а не из парсинга файлов провайдеров: бэкенд ([server.ts](server.ts)) вызывает `bb.sdk.system.usageLimits()` и выбирает каждого провайдера по дефисному id, `claude-code` и `codex`, из одного ответа. Поскольку эндпойнт использования аккаунта Anthropic жёстко ограничен по частоте, а каждый открытый сайдбар опрашивает его независимо, перед этим вызовом стоит кэш с коротким TTL и слиянием параллельных запросов. Логотипы и оттенки берутся из `bb.sdk.providers.list()`; хост отдаёт логотип как SVG в `currentColor`, и виджет накладывает его CSS-маской на плашку, окрашенную `light-dark()` от оттенка, — знак следует теме. Настройки объявлены через `bb.settings.define`.

## Слои

| Слой | Файл | Ответственность |
| --- | --- | --- |
| 1 — чистая логика | [lib/usage-model.ts](lib/usage-model.ts) | Разбор ответа SDK и настроек окраски, выбор провайдера, модель окна: доля расхода, цвет по режиму, доля времени, время до сброса, заполнение сегментов; типы провода, общие для бэкенда и виджета. Без DOM. |
| 2 — отрисовка | [lib/render.ts](lib/render.ts) | Превращение моделей в DOM: `buildProviderLogo` для логотипа-маски, `buildRingIcon` для кольца в футере, `buildWindowRow` для строки панели. |
| 3 — виджет | [lib/sidebar-widget.ts](lib/sidebar-widget.ts) | Сборка группы на провайдера в футере сайдбара, раскрытие панели провайдера, опрос состояния через RPC `getState`. |
| кэш | [lib/usage-cache.ts](lib/usage-cache.ts) | Кэш с коротким TTL, сливающий параллельные вызовы перед ограниченным по частоте эндпойнтом аккаунта. |
| вход бэкенда | [server.ts](server.ts) | Объявление настроек, регистрация RPC `getState`, чтение `bb.sdk.system.usageLimits()` и `bb.sdk.providers.list()`. |
| вход фронтенда | [app.ts](app.ts) | Регистрация контент-скрипта `sidebar-usage-circles`, монтирующего виджет. |

## Разработка

```
npm install --include=dev
npm test
```
