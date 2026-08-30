// Слой 1 — чтение git-конфигурации как текста. Ноль зависимостей, ноль эффектов.
//
// Оболочка читает два файла через bb.sdk.files и отдаёт их содержимое сюда:
//  1) файл-указатель `<worktree>/.git` воркри вида `gitdir: <path>`;
//  2) сам `config` главного репозитория.
// Разбор путей и INI — здесь, чтобы его можно было проверить без файловой системы.

/**
 * Достаёт путь gitdir из содержимого файла-указателя `<worktree>/.git`.
 * У воркри `.git` — это файл (`gitdir: /abs/repo/.git/worktrees/name`), а не
 * директория. Возвращает null, если строки `gitdir:` нет.
 */
export function parseGitdirPointer(pointerFile: string): string | null {
  const match = /^\s*gitdir:\s*(.+?)\s*$/m.exec(pointerFile);
  return match ? match[1] : null;
}

/**
 * По пути gitdir возвращает путь до `config` главного репозитория.
 * Для воркри gitdir указывает внутрь `.../.git/worktrees/<name>`, а общий
 * `config` лежит в самом `.../.git`. Для обычного репозитория gitdir и есть
 * `.git`, где `config` лежит рядом.
 */
export function configPathFromGitdir(gitdir: string): string {
  const marker = "/worktrees/";
  const at = gitdir.indexOf(marker);
  const gitRoot = at === -1 ? gitdir : gitdir.slice(0, at);
  return `${stripTrailingSlash(gitRoot)}/config`;
}

/**
 * Достаёт url ремоута `origin` из текста git-config. Возвращает null, если
 * секции `[remote "origin"]` или её `url` нет.
 */
export function originUrlFromGitConfig(configText: string): string | null {
  let inOrigin = false;
  for (const rawLine of configText.split("\n")) {
    const line = stripComment(rawLine).trim();
    if (line === "") continue;
    const section = /^\[(.+?)\]$/.exec(line);
    if (section) {
      inOrigin = isOriginSection(section[1]);
      continue;
    }
    if (!inOrigin) continue;
    const url = /^url\s*=\s*(.+)$/.exec(line);
    if (url) return url[1].trim();
  }
  return null;
}

// `[remote "origin"]` — заголовок с подсекцией; пробелы между `remote` и кавычкой
// git допускает, поэтому нормализуем.
function isOriginSection(header: string): boolean {
  return /^remote\s+"origin"$/.test(header.trim());
}

function stripComment(line: string): string {
  const hash = line.indexOf("#");
  const semi = line.indexOf(";");
  const cut = [hash, semi].filter((i) => i !== -1).sort((a, b) => a - b)[0];
  return cut === undefined ? line : line.slice(0, cut);
}

function stripTrailingSlash(path: string): string {
  return path.replace(/\/+$/, "");
}
