// Слой 1 — разбор git-remote в пару {owner, repo}. Ноль зависимостей, ноль эффектов.
//
// bb нигде не хранит origin-url окружения, поэтому его читают из git-config
// воркри (см. git-config.ts) и разбирают здесь. Цель — обычный github.com;
// enterprise-хосты сознательно не поддержаны: у них другой API-базовый URL.

export interface RepoRef {
  owner: string;
  repo: string;
}

// GitHub допускает в owner/repo буквы, цифры, дефис, точку и подчёркивание.
const SEGMENT = /^[A-Za-z0-9._-]+$/;

/** Хост, из-под которого работает публичный REST GitHub. */
const GITHUB_HOST = "github.com";

/**
 * Разбирает git-remote GitHub в {owner, repo} или возвращает null, если это не
 * похоже на github.com-remote. Понимает scp-форму (`git@github.com:o/r.git`) и
 * url-форму (`https://github.com/o/r`, `ssh://git@github.com/o/r.git`), с
 * необязательным `.git` на конце и `user@` в url-форме.
 */
export function parseGithubRemote(url: string): RepoRef | null {
  const trimmed = url.trim();
  const location = splitHostAndPath(trimmed);
  if (location === null) return null;
  if (hostname(location.host) !== GITHUB_HOST) return null;
  return ownerRepoFromPath(location.path);
}

interface HostAndPath {
  host: string;
  path: string;
}

// scp-форма `user@host:path` (без схемы) и url-форма `scheme://[user@]host/path`
// — единственные две формы git-remote. Возвращаем сырой host (возможно с
// `user@`) и путь; чистит их вызывающий.
function splitHostAndPath(url: string): HostAndPath | null {
  const scheme = /^(?:ssh|git|https?):\/\/(.+)$/.exec(url);
  if (scheme) {
    const rest = scheme[1];
    const slash = rest.indexOf("/");
    if (slash === -1) return null;
    return { host: rest.slice(0, slash), path: rest.slice(slash + 1) };
  }
  const scp = /^([^/]+):(.+)$/.exec(url);
  if (scp) return { host: scp[1], path: scp[2] };
  return null;
}

/** Отбрасывает необязательные `user@` и `:port` вокруг имени хоста. */
function hostname(rawHost: string): string {
  const afterUser = rawHost.includes("@")
    ? rawHost.slice(rawHost.lastIndexOf("@") + 1)
    : rawHost;
  const colon = afterUser.indexOf(":");
  return colon === -1 ? afterUser : afterUser.slice(0, colon);
}

function ownerRepoFromPath(path: string): RepoRef | null {
  const clean = path.replace(/^\/+/, "").replace(/\.git$/, "").replace(/\/+$/, "");
  const parts = clean.split("/");
  if (parts.length < 2) return null;
  const [owner, repo] = parts;
  if (!SEGMENT.test(owner) || !SEGMENT.test(repo)) return null;
  return { owner, repo };
}
