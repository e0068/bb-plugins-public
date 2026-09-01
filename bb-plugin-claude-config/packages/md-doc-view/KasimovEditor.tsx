/// <reference path="./kasimov.d.ts" />
// React-обёртка вокруг вендорённого редактора Kasimov (createEditor,
// editor/create-editor.js). Движок вендорён как соседний слой
// packages/kasimov (готовая сборка), обёртка тянет его относительным импортом:
// bare-специфер "kasimov" из этого пакета не резолвится сборщиком плагина —
// зависимость ставится в node_modules плагина-соседа, а не предка (см.
// memory/decisions/md-opener-vendor-kasimov.md).
// Kasimov поставляется как vanilla-ESM: фабрика монтирует свой contenteditable в
// host-элемент и владеет DOM целиком; обёртка лишь мостит его в мир value/onChange
// React и держит стабильную идентичность инстанса между рендерами.
//
// Slash-reference выше подключает ambient-объявление css-модуля для
// side-effect импорта стилей; типы движка приходят из packages/kasimov/kasimov.d.ts
// по относительному импорту.
//
// Отличие от packages/md-editor/react: там движок — класс `new
// VanillaMarkdownEditor(host, opts)`; здесь Kasimov даёт фабрику
// `createEditor(host, opts)`. Начиная с 3eb7ba5 движок знает и про Claude-`@import`
// (флаг `atLinks`), и про стиль узлов mermaid (`mermaidNodes`) — оба пробрасываются
// пропами (см. memory/decisions/md-opener-kasimov-editor.md).
import { useEffect, useId, useRef } from "react";
import { createEditor } from "../kasimov/kasimov.js";
import type { KasimovEditorInstance, KasimovLink } from "../kasimov/kasimov.js";
import "../kasimov/kasimov.css";
import { kasimovCssRule } from "./kasimov-settings";

export interface KasimovEditorProps {
  value: string;
  onChange?: (v: string) => void;
  /** default true */
  editable?: boolean;
  /** Клик по живой ссылке ведёт по ней. default true. */
  followLinks?: boolean;
  /** `@path` (Claude @import) кликабелен. default true. */
  atLinks?: boolean;
  /** Показывать frontmatter-блок сеткой. default true. */
  frontmatter?: boolean;
  /** Стиль узлов mermaid: "contrast" — залитый чип; "soft" — мягкие (default). */
  mermaidNodes?: "soft" | "contrast";
  /** CSS custom properties (`--kasi-*` и т.п.); применяются к `.mde-root` внутри host. */
  vars?: Record<string, string>;
  linkResolver?: (href: string) => KasimovLink | null;
  onSave?: (md: string) => Promise<void> | void;
  className?: string;
}

export function KasimovEditor({
  value,
  onChange,
  editable = true,
  followLinks = true,
  atLinks = true,
  frontmatter = true,
  mermaidNodes = "soft",
  vars,
  linkResolver,
  onSave,
  className,
}: KasimovEditorProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<KasimovEditorInstance | null>(null);
  // ID-селектор для правила скина (см. эффект vars ниже). React 18 отдаёт
  // useId() с двоеточиями ("`:r0:`"), не валидными в raw CSS/HTML id без
  // экранирования — вырезаем их; React 19 (текущий здесь) отдаёт "_r0_" без
  // двоеточий, .replace — no-op, но peer-диапазон допускает и 18.
  const hostId = "kasi-host-" + useId().replace(/:/g, "");
  // Последнее значение, которое ИЗДАЛ сам редактор: эффект синка value ниже так
  // отличает «хост задал новое значение» от «наш onChange вернулся эхом через
  // состояние потребителя» — второе НЕ должно звать setValue, иначе каждый ввод
  // сбрасывал бы DOM и каретку.
  const lastEmittedRef = useRef(value);

  const onChangeRef = useRef(onChange);
  const linkResolverRef = useRef(linkResolver);
  const onSaveRef = useRef(onSave);

  // Обновляем ref'ы каждый рендер, чтобы стабильные прокси (переданы в фабрику
  // один раз) всегда звали свежую идентичность колбэка — это даёт менять
  // linkResolver без пересоздания редактора.
  useEffect(() => {
    onChangeRef.current = onChange;
    linkResolverRef.current = linkResolver;
    onSaveRef.current = onSave;
  });

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const editor = createEditor(host, {
      value: lastEmittedRef.current,
      editable,
      // Клик по ссылке переходит по ней вместо выделения токена. По умолчанию
      // включено (md-opener-kasimov-editor.md); в правке переход уводит из
      // несохранённого черновика ОСОЗНАННО. Теперь управляется настройкой.
      followLinks,
      atLinks,
      frontmatter,
      mermaidNodes,
      onChange: (next) => {
        lastEmittedRef.current = next;
        onChangeRef.current?.(next);
      },
      linkResolver: (href) =>
        linkResolverRef.current ? linkResolverRef.current(href) : null,
      onSave: (md) => onSaveRef.current?.(md),
    });
    editorRef.current = editor;

    return () => {
      editor.destroy();
      editorRef.current = null;
    };
    // Пересоздаём при смене `editable`/`followLinks`/`atLinks`/`frontmatter`/
    // `mermaidNodes`: Kasimov читает их один раз в createEditor (не через live-ref),
    // поэтому переключение требует свежего инстанса. Остальные колбэки идут через
    // ref'ы — на их смену редактор не пересоздаётся.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editable, followLinks, atLinks, frontmatter, mermaidNodes]);

  useEffect(() => {
    if (editorRef.current && value !== lastEmittedRef.current) {
      lastEmittedRef.current = value;
      editorRef.current.setValue(value);
    }
  }, [value]);

  // CSS-переменные (`--kasi-*`) нельзя навесить инлайн-стилем на host: движок
  // объявляет свой набор --kasi-* заново на каждом .mde-root, который он
  // пересоздаёт при каждом _render() (то есть на каждый ввод) — см.
  // editor/md-editor/md-editor.js в апстриме. Значение, объявленное на самом
  // элементе, всегда побеждает унаследованное от предка независимо от
  // специфичности (контракт задокументирован в апстримном
  // memory/wiki/kasi-css-contract.md), поэтому host.style.setProperty тут же
  // перебивается локальным дефолтом того же имени на .mde-root. Правильная
  // точка приложения — CSS-правило с более высокой специфичностью, целящееся
  // в `.mde-root` (пример из апстрима: examples/kasi-connector.example.css) —
  // держим его в document.head под ID-селектором по host, переживает любую
  // пересборку .mde-root, потому что матчится по селектору, а не по identity узла.
  //
  // Построение самого текста правила — чистая функция (kasimovCssRule), а не
  // часть эффекта: депсит эффект на готовую строку, а не на объект `vars`,
  // который потребители пересоздают каждый рендер (иначе ререндер с равным
  // по содержимому, но новым по ссылке `vars` сносил бы и пересоздавал тег
  // без изменения итогового CSS).
  const cssRule = kasimovCssRule(hostId, vars ?? {});
  useEffect(() => {
    if (cssRule === null) return;
    const styleEl = document.createElement("style");
    styleEl.textContent = cssRule;
    document.head.appendChild(styleEl);
    return () => {
      styleEl.remove();
    };
  }, [cssRule]);

  return <div ref={hostRef} id={hostId} className={className} />;
}
