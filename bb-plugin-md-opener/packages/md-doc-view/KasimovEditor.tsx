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
// VanillaMarkdownEditor(host, opts)` со своим `atLinks`; здесь Kasimov даёт
// фабрику `createEditor(host, opts)` и НЕ знает про Claude-`@import` (кликабельна
// только markdown-форма) — поэтому проп atLinks отсутствует, а переход по ссылке
// включается флагом followLinks (см. memory/decisions/md-opener-kasimov-editor.md).
import { useEffect, useRef } from "react";
import { createEditor } from "../kasimov/kasimov.js";
import type { KasimovEditorInstance, KasimovLink } from "../kasimov/kasimov.js";
import "../kasimov/kasimov.css";

export interface KasimovEditorProps {
  value: string;
  onChange?: (v: string) => void;
  /** default true */
  editable?: boolean;
  /** Клик по живой ссылке ведёт по ней. default true. */
  followLinks?: boolean;
  /** Показывать frontmatter-блок сеткой. default true. */
  frontmatter?: boolean;
  /** CSS custom properties (`--kasi-*` и т.п.), навешиваются на host-элемент. */
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
  frontmatter = true,
  vars,
  linkResolver,
  onSave,
  className,
}: KasimovEditorProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<KasimovEditorInstance | null>(null);
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
      frontmatter,
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
    // Пересоздаём при смене `editable`/`followLinks`/`frontmatter`: Kasimov читает
    // их один раз в createEditor (не через live-ref), поэтому переключение флага
    // требует свежего инстанса. Остальные колбэки идут через ref'ы — на их смену
    // редактор не пересоздаётся.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editable, followLinks, frontmatter]);

  useEffect(() => {
    if (editorRef.current && value !== lastEmittedRef.current) {
      lastEmittedRef.current = value;
      editorRef.current.setValue(value);
    }
  }, [value]);

  // CSS-переменные (`--kasi-*`) навешиваем на host-элемент: движок владеет его
  // ПОТОМКАМИ (innerHTML при render), но host.style не трогает — переменные
  // наследуются вниз и переживают пересборку тела редактора.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const applied = vars ?? {};
    for (const [name, value] of Object.entries(applied)) {
      host.style.setProperty(name, value);
    }
    return () => {
      for (const name of Object.keys(applied)) host.style.removeProperty(name);
    };
  }, [vars]);

  return <div ref={hostRef} className={className} />;
}
