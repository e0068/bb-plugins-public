# Kasimov

> Opens .md files in a Kasimov editor where markdown links are clickable and navigate within the same tab, with breadcrumbs, a back button, and CAS-safe saving. Pie charts in the chat get a color per slice.

## What it does

Registers an "Open with" entry named **Kasimov** for `.md` and `.markdown` files in bb's right panel. Instead of the built-in preview, the file opens in the [Kasimov](https://github.com/e0068/Kasimov) editor: markdown links `[text](tasks/x.md)` and absolute paths inside the document are clickable and open **in the same tab**, with a history of jumps, the current file's path, and back and forward buttons. The header's "⋯" menu renames the file within its folder or deletes it. Following a link to a nonexistent file shows an error in the same tab. Click-to-edit turns the view into an editor; ⌘S saves with CAS protection — the write lands only if the file on disk hasn't changed since it was read, otherwise a conflict message is shown and the draft is kept.

While a draft is unsaved, the rest of bb — everything outside the document — sits under a dark translucent shade. Clicking the shade opens a dialog with the draft's diff against the file and two actions, Discard Changes and Save Changes; Escape or a click beside the dialog closes the dialog and leaves the draft and the shade as they were.

A picture in the document carries a "⋯" button in edit mode — alignment, width, Hide caption, Delete, each rewriting the tail after `|` inside its alt text, written with no separators — `![caption|600ch](img.png)`, `![caption|600x400c](img.png)`, `![caption|x400h](img.png)` — so the settings stay in the file and the caption stays the alt. A click on a picture, in either mode, unfolds it over bb at the height of the window; a second click on it, a click beside it or Escape folds it back.

It also offers an optional floating format bar over the thread composer (bold/italic/headings/lists/code/link/table), gated behind the plugin setting "Kasimov: use in Composer" (off by default).

## How it works

The `fileOpener` slot ([app.tsx](app.tsx), `app.slots.fileOpener` with `id: "md-opener"`, extensions `md`/`markdown`) is the whole editor surface. Rendering and interactivity — the in-tab jump stack, editing, CAS — live in the shared [packages/md-doc-view](../packages/md-doc-view) layer (`MdDocView` plus a `KasimovEditor` wrapper around `createEditor`); `app.tsx` is thin RPC wiring that closes `load`/`save`/`onReveal`/`rename`/`remove`/`resolveLinkTarget` over the tab's opaque `source`. Navigation always stays within the tab — opening a neighboring file tab isn't available to plugins ([decision](../docs/decisions/md-opener-jumps-inside-tab.md)).

The backend ([server.ts](server.ts)) exposes six RPC methods over `defineRpcContract`: `readDoc` (reads the file confined to the source root and, in the same response, annotates each body link as live/dead by listing directories), `writeDoc` (CAS write keyed on `expectedSha256`), `revealDoc` (reveal in Finder, refused for a source on a remote host), `renameDoc` and `deleteDoc` (`bb.sdk.files.move` and `remove` inside the source root; the host itself refuses to overwrite or to touch a missing file, and [src/file-errors.ts](src/file-errors.ts) reads that refusal — the plugin never lists the folder first, because `listPaths` walks the whole tree below it), and `composerBarEnabled` (reads the composer-bar flag). `hostId` is threaded through every file call — a thread's file may live on a different machine. For `host` paths there's intentionally no "under `$HOME`" boundary ([decision](../docs/decisions/opener-host-path-no-home-fence.md)).

The editor itself is the external `kasimov` package: `createEditor` only makes the markdown link form `[text](href)` clickable, so a Claude `@import` (`@AGENTS.md`) is not rendered as a link here ([decision](../docs/decisions/md-opener-kasimov-editor.md)). The plugin registers its own settings (`bb.settings.define`) for Kasimov's look and engine flags, independent of Cloud Config, read on the front end via `useSettings`. One of them, **"Open documents in edit mode"** (`docStartInEdit`, off by default), opens a document in Write instead of Read; it's a field of the settings table shared with [Claude Config](../bb-plugin-claude-config), so both plugins have it, each with its own value ([decision](../docs/decisions/doc-start-in-edit-setting.md)).

The composer format bar is a content script (`app.contentScripts.register`, `id: "composer-format-bar"`), not a composer banner: the bar must hover over the live selection and replace it, which a composer customization can't do. Because SDK data hooks don't work inside a content script's headless root, its enable flag is read by a plain `fetch` to the `composerBarEnabled` RPC rather than `useSettings`; text is inserted into the host's contenteditable via `execCommand("insertText")` to preserve its undo stack.

Kasimov's own mermaid renderer never bundles a library — it reads one off `window.Mermaid` (capital M) and expects something else to have put it there. `installMermaid` ([src/mermaid-bootstrap.ts](src/mermaid-bootstrap.ts)) is that something else: it's called with `window` as the first line of `definePluginApp`, before any document mounts, so Kasimov finds the library on its very first render pass — and, since mermaid's full build already self-registers the ELK layout on import, Kasimov's own `layout: "elk"` attempt succeeds instead of silently falling back to its more spread-out built-in layout. The install is eager, not behind a lazy `import()`: Kasimov only re-creates its mermaid renderer on the *next* render pass, so a library arriving late would leave an already-rendered document's diagram as plain text. The cost is a mermaid-sized plugin bundle even for documents with no diagram in them.

bb draws the mermaid pie charts in the chat itself, and in the dark theme every slice comes out the same grey: it takes the colors from three theme variables that are equal there. The `diagram-palette` content script ([src/diagram-palette-content.ts](src/diagram-palette-content.ts)) puts a stylesheet ([src/diagram-palette.ts](src/diagram-palette.ts)) into the page that gives the n-th slice and the n-th legend swatch the n-th of twelve colors — one set for the light theme and one for the dark, on desktop, in a browser and on a phone. mermaid draws no slice for a section under one percent — usually a zero — yet keeps it in the legend, so the colors would drift; the script counts slices and legend rows and marks the chart, and only a chart where they match is recolored — any other stays as bb drew it. Other diagrams and pies drawn by anything else are left alone.

## Layers

Dependencies run strictly downward.

| Layer | File | Responsibility |
| --- | --- | --- |
| shared pure | [packages/link-navigation](../packages/link-navigation) | Path resolution and href parsing, shared by server and front end (no `node:path`) |
| opener 1 | [src/opener-links.ts](src/opener-links.ts) | Extract in-tab markdown link hrefs from the body |
| opener 2 | [src/opener-source.ts](src/opener-source.ts) | Resolve a `PluginFileOpenerSource` into a host and a confinement root (`workspace`/`thread-storage`/`host`) |
| opener 1 | [src/file-errors.ts](src/file-errors.ts) | What a failed move or remove means: the name is taken, the file is gone, or something else |
| backend | [server.ts](server.ts) | `readDoc` (read + link-liveness), `writeDoc` (CAS), `revealDoc`, `renameDoc`, `deleteDoc`, `composerBarEnabled` RPC |
| shared view | [packages/md-doc-view](../packages/md-doc-view) | `MdDocView` rendering (history of jumps, editing, CAS, the file's menu, the picture's menu and the unfolded picture), the `KasimovEditor` wrapper and the draft guard this tab turns on with `guardDraft` |
| libraries | [libraries.ts](libraries.ts) | The one import of CodeMirror and Radix Tabs, handed to `MdDocView` as `libraries` — shared packages import neither, or a git install fails to resolve them |
| composer 1 | [src/composer-fmt.ts](src/composer-fmt.ts) | Pure format-button table and `applyFmt` (what each button does to selected text) |
| composer 2 | [src/composer-bar.ts](src/composer-bar.ts) | The floating format bar's DOM and positioning over the selection |
| composer shell | [src/composer-bar-content.ts](src/composer-bar-content.ts) | Content-script shell: read the flag over `fetch`, mount the bar |
| mermaid | [src/mermaid-bootstrap.ts](src/mermaid-bootstrap.ts) | `installMermaid` — puts mermaid on `window.Mermaid` for Kasimov's renderer to find |
| diagram palette | [src/diagram-palette.ts](src/diagram-palette.ts), [src/diagram-palette-content.ts](src/diagram-palette-content.ts) | Pure color table for bb's pie charts and the "every legend row has a slice" check; the content-script shell puts the table in the page and marks each pie with the check |
| slot | [app.tsx](app.tsx) | Thin `fileOpener` wiring over RPC and content-scripts registration |

---

# Kasimov — по-русски

> Открывает `.md`-файлы в редакторе Kasimov, где ссылки в markdown кликабельны и ведут в той же вкладке, с хлебными крошками, кнопкой «назад» и сохранением под защитой CAS.

## Для чего нужен

Регистрирует в меню «Open with» правой панели bb пункт **Kasimov** для файлов `.md` и `.markdown`. Вместо встроенного превью файл открывается в редакторе [Kasimov](https://github.com/e0068/Kasimov): ссылки markdown `[text](tasks/x.md)` и абсолютные пути внутри документа кликабельны и открываются **в той же вкладке** — с историей переходов, путём текущего файла и кнопками «назад» и «вперёд». Меню «⋯» в шапке переименовывает файл в той же папке или удаляет его. Переход по ссылке на несуществующий файл показывает ошибку в той же вкладке. Клик переводит просмотр в редактирование; ⌘S сохраняет под защитой CAS — запись проходит, только если файл на диске не менялся с момента чтения, иначе показывается сообщение о конфликте, а черновик сохраняется.

Пока черновик не сохранён, всё остальное в bb — всё вне документа — лежит под чёрным полупрозрачным затемнением. Клик по затемнению открывает диалог с диффом черновика против файла и двумя действиями, Discard Changes и Save Changes; Escape или клик мимо диалога закрывают диалог, а черновик и затемнение остаются как были.

У картинки в документе в режиме правки есть кнопка «⋯» — выравнивание, ширина, «спрятать подпись», «удалить»; каждое действие переписывает хвост после `|` внутри alt-текста, и пишется он слитно, без разделителей — `![подпись|600ch](img.png)`, `![подпись|600x400c](img.png)`, `![подпись|x400h](img.png)`; настройки остаются в самом файле, а подписью остаётся alt. Клик по картинке в любом режиме разворачивает её поверх bb во всю высоту окна; повторный клик по ней, клик мимо или Escape сворачивают обратно.

Дополнительно даёт плавающую панель форматирования над композером треда (жирный/курсив/заголовки/списки/код/ссылка/таблица) под настройкой плагина «Kasimov: use in Composer» (по умолчанию выключена).

## Как устроено

Слот `fileOpener` ([app.tsx](app.tsx), `app.slots.fileOpener` с `id: "md-opener"`, расширения `md`/`markdown`) — вся поверхность редактора. Рендер и интерактивность — стек переходов в той же вкладке, редактирование, CAS — живут в общем слое [packages/md-doc-view](../packages/md-doc-view) (`MdDocView` плюс обёртка `KasimovEditor` над `createEditor`); `app.tsx` — тонкая RPC-обвязка, замыкающая `load`/`save`/`onReveal`/`rename`/`remove`/`resolveLinkTarget` над непрозрачным `source` вкладки. Навигация всегда остаётся внутри вкладки — открыть соседнюю вкладку файла плагину недоступно ([decision](../docs/decisions/md-opener-jumps-inside-tab.md)).

Бэкенд ([server.ts](server.ts)) отдаёт через `defineRpcContract` шесть методов RPC: `readDoc` (читает файл в пределах корня источника и в том же ответе размечает каждую ссылку тела как живую/мёртвую, листая директории), `writeDoc` (CAS-запись по `expectedSha256`), `revealDoc` (показ в Finder, отклоняется для источника на удалённом хосте), `renameDoc` и `deleteDoc` (`bb.sdk.files.move` и `remove` в пределах корня источника; перезаписать или тронуть отсутствующий файл отказывается сам хост, а [src/file-errors.ts](src/file-errors.ts) читает этот отказ — папку заранее плагин не листает, потому что `listPaths` обходит всё дерево под ней) и `composerBarEnabled` (читает флаг панели композера). `hostId` протянут через все файловые вызовы — файл треда может лежать на другой машине. Для путей `host` намеренно нет границы «под `$HOME`» ([decision](../docs/decisions/opener-host-path-no-home-fence.md)).

Сам редактор — внешний пакет `kasimov`: `createEditor` делает кликабельной только форму ссылки markdown `[text](href)`, поэтому Claude-`@import` (`@AGENTS.md`) здесь как ссылка не отрисовывается ([decision](../docs/decisions/md-opener-kasimov-editor.md)). Плагин регистрирует собственные настройки (`bb.settings.define`) для вида и флагов движка Kasimov, независимые от Cloud Config, которые фронтенд читает через `useSettings`. Одна из них, **"Open documents in edit mode"** (`docStartInEdit`, по умолчанию выключена), открывает документ сразу в Write, а не в Read; это поле таблицы настроек, общей с [Claude Config](../bb-plugin-claude-config), поэтому есть у обоих плагинов, у каждого со своим значением ([decision](../docs/decisions/doc-start-in-edit-setting.md)).

Панель форматирования композера — content script (`app.contentScripts.register`, `id: "composer-format-bar"`), а не баннер композера: панель обязана висеть над живым выделением и заменять его, чего кастомизация композера не умеет. Поскольку SDK data hooks не работают в headless-корне content script'а, его флаг включения читается обычным `fetch` к RPC `composerBarEnabled`, а не через `useSettings`; текст вставляется в чужой contenteditable через `execCommand("insertText")`, чтобы сохранить его стек отмены.

Собственный рендерер mermaid у Kasimov библиотеку не бандлит — он читает её из `window.Mermaid` (заглавная M) и ждёт, что её туда положит кто-то другой. `installMermaid` ([src/mermaid-bootstrap.ts](src/mermaid-bootstrap.ts)) и есть этот «кто-то другой»: вызывается с `window` первой строкой `definePluginApp`, до монтирования любого документа, — так Kasimov находит библиотеку уже на первом проходе рендера, а раз полная сборка mermaid сама регистрирует ELK-раскладку при импорте, собственная попытка Kasimov `layout: "elk"` проходит вместо молчаливого отката на более просторную встроенную раскладку. Установка сделана заранее, не за ленивым `import()`: Kasimov пересоздаёт свой рендерер mermaid только на *следующем* проходе рендера, поэтому опоздавшая библиотека оставила бы диаграмму в уже отрисованном документе текстом. Цена — вес mermaid в бандле плагина даже для документов без единой диаграммы.

Пироги mermaid в чате bb рисует сам, и в тёмной теме все дольки у него одного серого цвета: цвета он берёт из трёх переменных темы, которые там совпадают. Content-скрипт `diagram-palette` ([src/diagram-palette-content.ts](src/diagram-palette-content.ts)) кладёт в страницу таблицу ([src/diagram-palette.ts](src/diagram-palette.ts)), которая даёт n-й дольке и квадратику n-й строки легенды n-й из двенадцати цветов — свой набор для светлой и тёмной темы, в десктопе, в браузере и на телефоне. Секцию меньше процента — обычно ноль — mermaid не рисует долькой, но оставляет в легенде, и цвета разошлись бы; поэтому скрипт сверяет число долек и строк легенды и ставит пирогу отметку, а красится только выверенный пирог — сбитый остаётся как у bb. Другие диаграммы и чужие пироги таблица не задевает.

## Слои

Зависимости идут строго вниз.

| Слой | Файл | Ответственность |
| --- | --- | --- |
| общее ядро | [packages/link-navigation](../packages/link-navigation) | Разрешение путей и разбор href, общее для сервера и фронтенда (без `node:path`) |
| opener 1 | [src/opener-links.ts](src/opener-links.ts) | Извлечение href'ов внутривкладочных markdown-ссылок из тела |
| opener 2 | [src/opener-source.ts](src/opener-source.ts) | Разрешение `PluginFileOpenerSource` в хост и корень изоляции (`workspace`/`thread-storage`/`host`) |
| opener 1 | [src/file-errors.ts](src/file-errors.ts) | Что значит неудачный move или remove: имя занято, файла нет или другое |
| бэкенд | [server.ts](server.ts) | RPC `readDoc` (чтение + разметка ссылок), `writeDoc` (CAS), `revealDoc`, `renameDoc`, `deleteDoc`, `composerBarEnabled` |
| общий вид | [packages/md-doc-view](../packages/md-doc-view) | Рендер `MdDocView` (история переходов, редактирование, CAS, меню файла), обёртка `KasimovEditor` и затемнение над черновиком, которое вкладка включает флагом `guardDraft` |
| библиотеки | [libraries.ts](libraries.ts) | Единственный импорт CodeMirror и Radix Tabs, уходит в `MdDocView` пропом `libraries` — общие пакеты не импортируют ни того, ни другого, иначе установка из git их не находит |
| composer 1 | [src/composer-fmt.ts](src/composer-fmt.ts) | Чистая таблица кнопок форматирования и `applyFmt` (во что кнопка превращает выделение) |
| composer 2 | [src/composer-bar.ts](src/composer-bar.ts) | DOM плавающей панели форматирования и позиционирование над выделением |
| оболочка composer | [src/composer-bar-content.ts](src/composer-bar-content.ts) | Оболочка content script'а: читает флаг через `fetch`, монтирует панель |
| mermaid | [src/mermaid-bootstrap.ts](src/mermaid-bootstrap.ts) | `installMermaid` — кладёт mermaid в `window.Mermaid` для рендерера Kasimov |
| палитра диаграмм | [src/diagram-palette.ts](src/diagram-palette.ts), [src/diagram-palette-content.ts](src/diagram-palette-content.ts) | Чистые таблица цветов пирогов bb и сверка «у каждой строки легенды есть долька»; оболочка content-скрипта кладёт таблицу и ставит пирогам отметку сверки |
| слот | [app.tsx](app.tsx) | Тонкая обвязка слота `fileOpener` над RPC и регистрация content script'ов |
