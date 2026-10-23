// Текст агента в брифе и демонстрации — движком Kasimov в режиме чтения, как документ в MD Opener (MdText,
// packages/md-doc-view): таблицы, заголовки, код, цитаты, списки и диаграммы mermaid. Ссылка `[текст](цель)` открывает
// файл или адрес тем же путём, что ссылка результата этапа, а картинка `![подпись](путь)` грузится из дерева треда
// маршрутом сервера Flow (core/brief-image.ts). Корни файлов треда кладёт загрузчик брифа в контекст,
// чтобы не тянуть их пропсом через каждую строку.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { useBbNavigate } from "@get-bb/plugin-sdk/app";
import { MdText } from "@bb-plugins/md-doc-view/MdText";

import { briefImageUrl } from "../core/brief-image";
import { bareHref, hasMarkup, hrefTarget } from "../core/inline-links";
import { liveLink, type FileRoots } from "../core/result-link";
import { useHostDark } from "./use-host-dark";

export const FileRootsContext = createContext<FileRoots | null>(null);

/**
 * Клик пришёл по ссылке: ссылка стоит и внутри кнопки варианта, и в поле пункта, и открывает файл, а не выбирает
 * вариант. Ссылка bb — `a[href]`, её Cmd/Ctrl-клик и правый клик ловит хост; ссылка Kasimov — `role=link`, она
 * открывает превью и только: меню «Open in / Open with / Copy path» у неё нет.
 */
export const onLink = (event: MouseEvent): boolean => event.target instanceof Element && event.target.closest("a[href], [role=link]") !== null;

/** Что делает клик по ссылке: файл — превью bb на нужной строке, адрес — браузер bb; открыть нечем — ссылка остаётся текстом. */
function useLinkResolver() {
  const roots = useContext(FileRootsContext);
  // Объект навигации хоста не обязан быть одним и тем же от рендера к рендеру, а новый резолвер перерисовывает текст.
  const current = useBbNavigate();
  const navigate = useRef(current);
  navigate.current = current;
  return useCallback(
    (href: string) => {
      const { target, line } = hrefTarget(bareHref(href));
      const link = liveLink(target, roots);
      switch (link.kind) {
        case "url":
          return { onClick: () => void navigate.current.openUrl(link.url) };
        case "file":
          return { onClick: () => void navigate.current.experimental_openFilePreview({ target: link.target, location: line === null ? null : { kind: "line", line, column: null } }) };
        case "none":
          return null;
      }
    },
    [roots],
  );
}

/**
 * Адрес картинки из дерева треда. Корни ещё не пришли — резолвера нет, и движок ждёт его вместе с корнями ссылок; у
 * треда нет дерева — адреса нет, и на месте снимка плашка с подписью.
 */
function useImageResolver() {
  const roots = useContext(FileRootsContext);
  const threadId = roots?.threadId;
  const tree = roots?.environmentId != null;
  return useMemo(() => (threadId === undefined ? undefined : (src: string) => (tree ? briefImageUrl(threadId, src) : null)), [threadId, tree]);
}

type Resolvers = { linkResolver: ReturnType<typeof useLinkResolver>; imageResolver: ReturnType<typeof useImageResolver> };

declare global {
  interface Window {
    Mermaid?: unknown;
  }
}

const MERMAID_FENCE = /^\s*```mermaid\b/m;

let mermaidLoaded: Promise<void> | null = null;

/** Kasimov берёт mermaid с `window.Mermaid`; библиотека лежит в бандле Flow и загружается при первой диаграмме. */
const loadMermaid = (): Promise<void> =>
  (mermaidLoaded ??= import("mermaid").then(({ default: mermaid }) => {
    window.Mermaid = mermaid;
  }));

/**
 * Текст с диаграммой. Kasimov рисует её один раз, при создании, поэтому текст создаётся заново, когда библиотека
 * загрузилась, и когда bb сменил тему — цвета диаграммы берутся из темы в момент отрисовки.
 */
function WithDiagrams({ text, resolvers }: { text: string; resolvers: Resolvers }) {
  const dark = useHostDark();
  const [ready, setReady] = useState(() => window.Mermaid !== undefined);
  useEffect(() => {
    let alive = true;
    void loadMermaid().then(() => alive && setReady(true));
    return () => {
      alive = false;
    };
  }, []);
  return <MdText key={`${ready}:${dark}`} text={text} {...resolvers} />;
}

/**
 * Текст агента: любое поле брифа и демонстрации. Одну строку без разметки Kasimov рисует ровно текстом карточки —
 * её шрифтом, цветом, в строку с соседями, — поэтому движок для неё не создаётся: полей в треде сотни, а размечена малая часть.
 */
export function RichText({ text }: { text: string }) {
  return hasMarkup(text) || text.includes("\n") ? <Marked text={text} /> : text;
}

function Marked({ text }: { text: string }) {
  const resolvers = { linkResolver: useLinkResolver(), imageResolver: useImageResolver() };
  return MERMAID_FENCE.test(text) ? <WithDiagrams text={text} resolvers={resolvers} /> : <MdText text={text} {...resolvers} />;
}
