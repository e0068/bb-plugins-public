# bb-plugin-md-opener

Опенер `.md` для правой панели bb. Регистрирует слот `fileOpener`: в меню
«Open with» на вкладке файла появляется **Kasimov**, который рендерит
markdown редактором [Kasimov](https://github.com/e0068/Kasimov) вместо
встроенного превью.

## Что умеет

- **Markdown-ссылки внутри кликабельны.** `[текст](tasks/x.md)` и абсолютные
  пути открываются **в той же вкладке**: свой стек прыжков, крошка с именем
  файла, кнопка «назад». Клик по ссылке на несуществующий файл покажет ошибку в
  той же вкладке. Клик по ссылке всегда переходит по ней (флаг `followLinks`
  включён) — и в просмотре, и в правке; переход из режима правки уводит из
  несохранённого черновика, это намеренный жест навигации.
- **Правка по клику в текст**, сохранение ⌘S с CAS-защитой (пишем, только если
  файл на диске не изменился с момента чтения; иначе — сообщение, правка не
  теряется).

## Устройство (слои, зависимости строго вниз)

1. [packages/link-navigation](../packages/link-navigation) — чистый резолв
   путей и разбор href (общий с сервером и фронтом, без `node:path`).
2. [src/opener-links.ts](src/opener-links.ts) — извлечение markdown-ссылок из
   тела.
3. [src/opener-source.ts](src/opener-source.ts) — из `PluginFileOpenerSource`
   получить хост и корень-фенс (`workspace`/`thread-storage`/`host`).
4. [server.ts](server.ts) — RPC `readDoc` (чтение + разметка «живости» ссылок
   одним ответом) и `writeDoc` (CAS). Везде прокинут `hostId` — файл треда
   может жить на другой машине.
5. [packages/md-doc-view](../packages/md-doc-view) — общий слой: рендер MD Opener
   (стек прыжков, правка, CAS) с инъекцией эффектов, плюс обёртка `KasimovEditor`
   вокруг `createEditor` из [`kasimov`](https://github.com/e0068/Kasimov). Тем же
   слоем пользуется встроенная колонка
   [bb-plugin-claude-config](../bb-plugin-claude-config).
6. [app.tsx](app.tsx) — тонкий слот: `load`/`save`/`resolveLinkTarget` из RPC под
   контракт `MdDocView`.

## Ограничения

- Редактор — внешний пакет `kasimov`, а не
  [packages/md-editor](../packages/md-editor)
  ([решение](../memory/decisions/md-opener-kasimov-editor.md)). Публичный
  `createEditor` делает кликабельной только markdown-форму `[текст](href)` —
  Claude-`@import` (`@AGENTS.md`) как ссылку не рендерит, поэтому здесь он не
  кликабелен.
- Переход всегда **внутри вкладки** — открыть соседнюю вкладку файла плагину
  недоступно (в SDK `openWorkspaceFile` есть только у `messageDirective`,
  см. [решение](../memory/decisions/md-opener-jumps-inside-tab.md)).
- Для `host`-пути границы «под `$HOME`» нет намеренно: файл может лежать на
  другой машине ([решение](../memory/decisions/opener-host-path-no-home-fence.md)).

## Тесты

```
npm test
```

Слои покрыты раздельно: разбор ссылок, резолв источника, сервер (чтение/CAS/
границы) и компонент слота (jsdom, редактор замокан).
