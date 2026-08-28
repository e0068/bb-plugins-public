# @bb-plugins/md-editor

Общий пакет: ванильный WYSIWYG-редактор markdown (`md-editor.js`,
`markdown.js`, `tables.js`, `history.js`, `md-editor.css` — скопированы
байт-в-байт из [bb-plugin-shelf/md-editor](../../bb-plugin-shelf/md-editor))
плюс React-обёртка и тема на переменных `--mde-*`.

Один contenteditable-surface; markdown — единственный источник истины.
Собственной документации по внутреннему устройству движка здесь нет — см.
исходный движок в `bb-plugin-shelf/md-editor/` (там остаётся его копия,
Shelf её не удаляет).

## Импорт

```ts
import { MarkdownEditor } from "../../packages/md-editor";
// или, если пакет установлен через workspace: "@bb-plugins/md-editor"
```

`react` и `react-dom` — peerDependencies: в сборке `bb plugin build` они
externals (глобали хоста), поэтому второго инстанса React не появляется.

## Пропсы `MarkdownEditor`

| Проп            | Тип                                                                             | По умолчанию   | Описание                                                                 |
| ---------------- | -------------------------------------------------------------------------------- | -------------- | -------------------------------------------------------------------------- |
| `value`           | `string`                                                                          | —              | markdown-текст (controlled)                                                |
| `onChange`        | `(v: string) => void`                                                            | —              | вызывается при изменении содержимого                                       |
| `editable`        | `boolean`                                                                         | `true`         | смена значения пересоздаёт инстанс редактора                               |
| `linkResolver`    | `(href: string) => { label?: string; onClick: () => void } \| null`             | —              | делает ссылку интерактивной; `null` — ссылка остаётся обычным текстом      |
| `pathProvider`    | `(query: string, mode: "path" \| "import") => { path; label?; comment? }[]`     | —              | автокомплит путей в редакторе                                              |
| `onSave`          | `(md: string) => Promise<void> \| void`                                          | —              | хук сохранения (например, ⌘S внутри редактора)                             |
| `flush`           | `boolean`                                                                         | `false`        | убирает боковые format-margins (44px → 12px), для узких колонок            |
| `className`       | `string`                                                                          | —              | дополнительный класс host-элемента                                         |
| `hostClassName`   | `string`                                                                          | `"bb-mde-host"`| базовый класс host-элемента; тема (`theme.css`) таргетит `.bb-mde-host .mde-root` |

Колбэки (`onChange`, `linkResolver`, `pathProvider`, `onSave`) можно менять
между рендерами без пересоздания редактора — они читаются через
стабильные прокси-обёртки. Пересоздаётся редактор только при смене
`editable`.

## Ванильное использование

```ts
import { VanillaMarkdownEditor } from "../../packages/md-editor";

const editor = new VanillaMarkdownEditor(hostEl, {
  value: "# hi",
  onChange: (v) => console.log(v),
});
```
