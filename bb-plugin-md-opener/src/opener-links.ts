// Чистый слой: вытащить из тела .md ссылки, ведущие внутрь вкладки. Ноль
// bb/node-зависимостей — переиспользует общий резолвер путей
// (packages/link-navigation), тот же, что крутится во фронте linkResolver'а.
// Держать разбор здесь, а не копией: сервер и фронт обязаны считать ссылку
// одинаково (см. memory/decisions/link-resolve-shared-layer.md).
import {
  isInTabLink,
  parseHref,
} from "../packages/link-navigation/resolve";

// Единственная форма, которую редактор kasimov делает кликабельной, —
// markdown-ссылка `[текст](target)` (target внутри скобок). Claude-`@import`
// сюда НЕ входит: движок kasimov его как ссылку не рендерит, а сервер и фронт
// обязаны считать ссылку одинаково (link-resolve-shared-layer,
// md-opener-kasimov-editor).
const MD_LINK_RE = /\[[^\]]*\]\(([^)]+)\)/g;

/**
 * Уникальные href из тела, ведущие внутрь вкладки (локальные пути; не http/
 * mailto/якорь). Порядок — как в тексте; дубль одного написания сворачивается.
 * href возвращается «как в разметке» (с возможным `#anchor`/title) — резолв и
 * отсечение якоря делает вызывающий через parseHref, ровно как фронт.
 */
export function extractLinkHrefs(body: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();

  const push = (raw: string) => {
    const href = raw.trim();
    if (!href || !isInTabLink(href)) return;
    // Пустой путь (`[x](#anchor)`) — не файловая ссылка.
    if (!parseHref(href).path) return;
    if (seen.has(href)) return;
    seen.add(href);
    out.push(href);
  };

  for (const m of body.matchAll(MD_LINK_RE)) push(m[1]);

  return out;
}
