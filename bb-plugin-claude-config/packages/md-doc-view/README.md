# @bb-plugins/md-doc-view

Общий слой: презентационный опыт **MD Opener** (редактор
[Kasimov](https://github.com/e0068/Kasimov)) с инвертированными зависимостями.
Компонент `MdDocView` владеет стеком прыжков, режимом правки и CAS-нотой, а
эффекты приходят функциями-пропсами — плагин-потребитель подставляет свой RPC.

Используется двумя плагинами: слотом `fileOpener` в
[bb-plugin-md-opener](../../bb-plugin-md-opener) и встроенной колонкой
[bb-plugin-claude-config](../../bb-plugin-claude-config) (режим опенера
`md-opener`). Один компонент — один опыт, без дублирования кода и без обхода
через хостовую вкладку
([решение](../../memory/decisions/claude-config-opener-setting.md)).

## Контракт

```ts
interface MdDocViewProps {
  initialPath: string;
  load: (path) => Promise<LoadedDoc>;                       // {path, content, sha256, error?}
  save: (path, content, expectedSha256) => Promise<SaveResult>; // CAS
  resolveLinkTarget: (href, fromPath) => string | null;     // abs внутривкладочной цели или null
}
```

Любой файл — и markdown, и не-markdown — правится сырым текстом; отдельного
«только чтение» нет.

## Слои

- `KasimovEditor.tsx` — React-обёртка над `kasimov` (внутренняя деталь пакета).
- `MdDocView.tsx` — стек прыжков, правка, CAS; рендерит `KasimovEditor`.
- Резолв ссылок и путей **инжектируется** — пакет не зависит от
  [link-navigation](../link-navigation); его подставляет потребитель.

`kasimov` и `react` — peer-зависимости: их даёт потребитель (source-импорт
резолвит из его `node_modules`).

## Тесты

```
npm test
```

`KasimovEditor` в тесте замокан (jsdom не воспроизводит contenteditable);
проверяются загрузка, стек прыжков, правка+CAS, конфликт, сырой не-md и ошибка.
