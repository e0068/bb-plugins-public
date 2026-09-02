// Layer 1 — parses a git remote into an {owner, repo} pair. Zero dependencies, zero effects.
//
// bb doesn't store the environment's origin url anywhere, so it's read from
// the worktree's git-config (see git-config.ts) and parsed here. The target
// is plain github.com; enterprise hosts are deliberately unsupported — they
// have a different API base URL.

export interface RepoRef {
  owner: string;
  repo: string;
}

// GitHub allows letters, digits, hyphen, dot and underscore in owner/repo.
const SEGMENT = /^[A-Za-z0-9._-]+$/;

/** The host the public GitHub REST API runs under. */
const GITHUB_HOST = "github.com";

/**
 * Parses a GitHub git-remote into {owner, repo}, or returns null if it
 * doesn't look like a github.com remote. Understands the scp form
 * (`git@github.com:o/r.git`) and the url form (`https://github.com/o/r`,
 * `ssh://git@github.com/o/r.git`), with an optional trailing `.git` and
 * `user@` in the url form.
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

// The scp form `user@host:path` (no scheme) and the url form
// `scheme://[user@]host/path` are the only two git-remote forms. We return
// the raw host (possibly with `user@`) and path; the caller cleans them up.
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

/** Strips the optional `user@` and `:port` around the hostname. */
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
