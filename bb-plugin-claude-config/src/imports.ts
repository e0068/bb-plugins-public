// Слой 1 — разбор @-импортов CLAUDE.md и разрешение их в абсолютные пути.
// Никакого ввода-вывода: на входе текст и уже известные пути, на выходе строки.

import { dirname, isAbsolute, join, normalize } from "node:path";

/**
 * Ищет `@путь` в тексте markdown-файла (CLAUDE.md и подобных). Токен считается
 * импортом, только если перед `@` начало строки или пробел (иначе это часть
 * e-mail вроде `user@example.com`) и захваченный путь похож на файл. Строки
 * внутри огороженных ``` код-блоков не разбираются. Порядок — первого
 * появления, точные дубли схлопнуты.
 */
export function parseImports(text: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  let inFence = false;

  for (const line of text.split("\n")) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    const pattern = /(?:^|\s)@(\S+)/g;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(line)) !== null) {
      const path = trimTrailingPunctuation(match[1]);
      if (path === "" || !looksLikePath(path) || seen.has(path)) continue;
      seen.add(path);
      result.push(path);
    }
  }
  return result;
}

/** Обрезает хвостовую пунктуацию, оставшуюся от конца предложения. */
function trimTrailingPunctuation(value: string): string {
  return value.replace(/[)(.,;:]+$/, "");
}

/** Путь похож на файл: содержит слэш, имеет расширение или начинается с ~/./../. */
function looksLikePath(value: string): boolean {
  if (value.includes("/")) return true;
  if (/\.[a-z0-9]+$/i.test(value)) return true;
  if (value.startsWith("~") || value.startsWith("./") || value.startsWith("../")) {
    return true;
  }
  return false;
}

/**
 * Разрешает путь импорта в абсолютный. `~` (или `~/...`) — от домашнего
 * каталога; абсолютный путь — как есть; относительный — от каталога файла,
 * в котором встретился импорт.
 */
export function resolveImportPath(
  fromFileAbs: string,
  importPath: string,
  home: string,
): string {
  if (importPath === "~" || importPath.startsWith("~/")) {
    const rest = importPath === "~" ? "" : importPath.slice(2);
    return normalize(join(home, rest));
  }
  if (isAbsolute(importPath)) return normalize(importPath);
  return normalize(join(dirname(fromFileAbs), importPath));
}
