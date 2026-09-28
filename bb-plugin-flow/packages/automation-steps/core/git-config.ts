// Layer 1 — reads git configuration as text. Zero dependencies, zero effects.
//
// The shell reads two files via bb.sdk.files and hands their content here:
//  1) the `<worktree>/.git` pointer file of the form `gitdir: <path>`;
//  2) the main repository's `config` itself.
// Path and INI parsing live here so they can be verified without a filesystem.

/**
 * Extracts the gitdir path from the content of the `<worktree>/.git` pointer
 * file. In a worktree, `.git` is a file (`gitdir: /abs/repo/.git/worktrees/name`),
 * not a directory. Returns null if there's no `gitdir:` line.
 */
export function parseGitdirPointer(pointerFile: string): string | null {
  const match = /^\s*gitdir:\s*(.+?)\s*$/m.exec(pointerFile);
  return match ? match[1] : null;
}

/**
 * Given a gitdir path, returns the path to the main repository's `config`.
 * For a worktree, gitdir points inside `.../.git/worktrees/<name>`, while
 * the shared `config` lives right in `.../.git`. For a regular repository,
 * gitdir is `.git` itself, where `config` sits alongside it.
 */
export function configPathFromGitdir(gitdir: string): string {
  const marker = "/worktrees/";
  const at = gitdir.indexOf(marker);
  const gitRoot = at === -1 ? gitdir : gitdir.slice(0, at);
  return `${stripTrailingSlash(gitRoot)}/config`;
}

/**
 * Extracts the `origin` remote's url from git-config text. Returns null if
 * there's no `[remote "origin"]` section or its `url`.
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

// `[remote "origin"]` — a header with a subsection; git allows whitespace
// between `remote` and the quote, so we normalize it.
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
