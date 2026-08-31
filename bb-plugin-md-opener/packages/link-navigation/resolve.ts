/**
 * Чистый слой резолва путей и разбора ссылок. НОЛЬ импортов — ни react, ни
 * node:path. Один и тот же код зовётся на сервере (обход тела файла) и во
 * фронте (linkResolver редактора на каждую ссылку).
 *
 * См. memory/decisions/link-resolve-shared-layer.md — почему этот слой
 * отдельный и почему node:path сюда нельзя (фронтовый бандл браузерный).
 *
 * Семантика сверена с самодельной навигацией bb-plugin-claude-config/app.tsx
 * (resolveAbs/isInTabLink/fileRefFromCode) — она эталон поведения.
 */

// Ссылку из `<a href>` (или сырой markdown-target) ведём внутрь вкладки,
// если она локальный путь: не схемная http:/mailto:, не протокол-
// относительная `//`, не якорь `#...`, не пустая.
export function isInTabLink(href: string): boolean {
  if (!href || href.startsWith("#") || href.startsWith("//")) return false;
  return !/^[a-z][a-z0-9+.-]*:/i.test(href);
}

// Title в квадратных кавычках отрезаем ПЕРВЫМ (он может стоять перед якорем
// в исходном markdown-target: `path "title"#anchor`), потом уже якорь.
const TITLE_RE = /^([\s\S]*?)\s+"([^"]*)"([\s\S]*)$/;

export function parseHref(href: string): { path: string; anchor: string | null } {
  const titleMatch = TITLE_RE.exec(href);
  const withoutTitle = titleMatch ? titleMatch[1] + titleMatch[3] : href;
  const hashIdx = withoutTitle.indexOf("#");
  if (hashIdx === -1) {
    return { path: withoutTitle, anchor: null };
  }
  return {
    path: withoutTitle.slice(0, hashIdx),
    anchor: withoutTitle.slice(hashIdx + 1),
  };
}

// Резолвит ref (относительный или абсолютный) относительно ДИРЕКТОРИИ файла
// fromPath в абсолютный нормализованный путь: схлопывает `.`/`..`, срезает
// хвостовой (и любой пустой) сегмент — «/a/b/» и «/a/b» дают один результат.
// Алгоритм 1:1 с Config.resolveAbs, только база — путь файла, не текущий
// открытый документ.
export function resolveRelative(fromPath: string, ref: string): string {
  const start = ref.startsWith("/")
    ? []
    : fromPath.slice(0, fromPath.lastIndexOf("/")).split("/");
  const out: string[] = [];
  for (const seg of [...start, ...ref.split("/")]) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") out.pop();
    else out.push(seg);
  }
  return `/${out.join("/")}`;
}

// Текст инлайн-кода вида `references/01-x.md` — файловая ссылка: относительный
// путь с расширением, без пробелов, схем и знаков `=` (отсекает
// `user-scalable=no`). Иначе — null.
export function fileRefFromCode(text: string): string | null {
  const trimmed = text.trim();
  return /^(\.\.?\/)?([\w.-]+\/)*[\w.-]+\.[a-z0-9]+$/i.test(trimmed)
    ? trimmed
    : null;
}
