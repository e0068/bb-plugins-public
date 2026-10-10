# Window Chrome

> Compact desktop window: the title row is gone, its buttons sit in the island's corners on one line, a 4 px frame around the island on a black backdrop. Colors, radii, spacing and sizes of bb in the settings, saved as a bb theme.

## What it does

bb 0.46 on the desktop draws a separate 48 px title row above the island. With this plugin the row is gone: the sidebar toggle sits in the top-left corner of the thread panel with back and forward at the right end of the same row and New thread one row below; with the panel hidden all three sit in the island's top-left corner; the right-panel toggle sits in the top-right corner. The top row — rail home, buttons, thread title and header actions — and the bottom row — settings and the footer icons — each sit on one line. The rail buttons sit as close together as the thread rows of a project in the thread panel. The island is 4 px from the window edge on the top, right and bottom — 48 px on the top in a non-fullscreen window, under the macOS traffic lights — and the backdrop behind it is pure black in both themes. bb in a browser or on a phone is unchanged.

The Window theme section — in the plugin settings and as a tab of the thread's right panel (Window theme in the new-tab actions) — sets bb's colors separately for the light and dark theme (surfaces, text and lines, accent and statuses, the backdrop behind the island), the radii of controls and of the island, the padding, margin and gap steps, the frame around the island, the size step, the top row and list row heights and the text size. An empty field keeps the value of the current bb theme. Every change shows in every window at once. Save as theme writes the set as `<bb theme dir>/<name>/theme.css`, with both color sets, and switches bb to it; the name is Latin letters, digits and hyphens, and an existing theme is replaced only on an explicit Replace.

## How it works

A content script ([app/content.ts](app/content.ts)) puts the window stylesheet ([core/chrome-css.ts](core/chrome-css.ts)) into the page. Every rule is scoped to bb's framed desktop layout. The buttons stay in bb's own React tree; they are only positioned with CSS.

The theme values live on the server ([server.ts](server.ts)) and travel over RPC ([shared/contract.ts](shared/contract.ts)). One pure function ([core/theme.ts](core/theme.ts)) turns them into CSS both for the live stylesheet an invisible overlay keeps in the page ([app/theme-style.tsx](app/theme-style.tsx)) and for the saved theme file. The form ([app/theme-editor.tsx](app/theme-editor.tsx)) is the same in the settings and in the right panel. Padding, margin and gap steps override bb's spacing utilities in its utilities layer, so bb's state variants still win.

bb's markup is not an API: if it changes, the buttons fall back to bb's own title row.

## Layers

| Layer | Files | Responsibility |
| --- | --- | --- |
| core | [core/chrome-css.ts](core/chrome-css.ts), [core/theme.ts](core/theme.ts) | pure: the window stylesheet; theme values, parsing and theme CSS |
| shared | [shared/contract.ts](shared/contract.ts) | RPC contract: get, set, saveTheme |
| server | [server.ts](server.ts) | theme storage and the bb theme file |
| app | [app/content.ts](app/content.ts), [app/theme-style.tsx](app/theme-style.tsx), [app/theme-editor.tsx](app/theme-editor.tsx), [app.tsx](app.tsx) | content script, live theme overlay, theme form |

The order is guarded by [architecture.test.ts](architecture.test.ts). Tests: `npx vitest run`.

---

# Window Chrome — по-русски

Компактное окно десктопного bb: скрытие левой панели — в левом верхнем углу панели тредов, назад и вперёд — у правого края той же строки, «New thread» — строкой ниже; со скрытой панелью все три кнопки в левом углу острова; скрытие правой панели — в правом верхнем углу. Верхний и нижний ряд — каждый на одной линии. Кнопки левой рейки стоят так же плотно, как строки тредов проекта в панели тредов. Остров отстоит от края окна на 4 px сверху, справа и снизу (сверху 48 px в окне не на весь экран), фон за ним — чёрный в обеих темах. Браузерный и телефонный вид bb не меняются. Раздел «Тема окна» — в настройках плагина и вкладкой правой панели треда — задаёт цвета bb отдельно для светлой и тёмной темы, скругления, отступы и размеры; правка сразу видна во всех окнах, «Сохранить как тему» пишет набор файлом темы bb и включает его. Устройство — [docs/architecture/bb-plugin-window-chrome.md](../docs/architecture/bb-plugin-window-chrome.md).
