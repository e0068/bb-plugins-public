// React-обёртка вокруг редактора Kasimov (createEditor, editor/create-editor.js).
// Kasimov поставляется как vanilla-ESM: фабрика монтирует свой contenteditable в
// host-элемент и владеет DOM целиком; обёртка лишь мостит его в мир value/onChange
// React и держит стабильную идентичность инстанса между рендерами.
//
// Отличие от packages/md-editor/react: там движок — класс `new
// VanillaMarkdownEditor(host, opts)` со своим `atLinks`; здесь Kasimov даёт
// фабрику `createEditor(host, opts)` и НЕ знает про Claude-`@import` (кликабельна
// только markdown-форма) — поэтому проп atLinks отсутствует, а переход по ссылке
// включается флагом followLinks (см. memory/decisions/md-opener-kasimov-editor.md).
import { useEffect, useRef } from "react";
import { createEditor } from "kasimov";
import type { KasimovEditorInstance, KasimovLink } from "kasimov";
import "kasimov/css";

export interface KasimovEditorProps {
  value: string;
  onChange?: (v: string) => void;
  /** default true */
  editable?: boolean;
  linkResolver?: (href: string) => KasimovLink | null;
  onSave?: (md: string) => Promise<void> | void;
  className?: string;
}

export function KasimovEditor({
  value,
  onChange,
  editable = true,
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
      // Клик по ссылке всегда переходит по ней вместо выделения токена — флаг
      // включён по решению владельца (md-opener-kasimov-editor.md). В режиме
      // правки переход уводит из несохранённого черновика ОСОЗНАННО: клик по
      // ссылке — намеренный жест навигации, а не молчаливая потеря при перечитке.
      followLinks: true,
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
    // Пересоздаём при смене `editable`: Kasimov читает editable/followLinks один
    // раз в createEditor (не через live-ref), поэтому переключение режима требует
    // свежего инстанса. Остальные колбэки идут через ref'ы — на их смену
    // редактор не пересоздаётся.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editable]);

  useEffect(() => {
    if (editorRef.current && value !== lastEmittedRef.current) {
      lastEmittedRef.current = value;
      editorRef.current.setValue(value);
    }
  }, [value]);

  return <div ref={hostRef} className={className} />;
}
