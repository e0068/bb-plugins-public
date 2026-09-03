/**
 * Pure layer for path resolution and link parsing. ZERO imports — neither
 * react nor node:path. The same code is called on the server (walking a
 * file's body) and on the front end (the editor's linkResolver on every link).
 *
 * See memory/decisions/link-resolve-shared-layer.md — why this layer is
 * separate and why node:path can't be used here (the front-end bundle runs in the browser).
 *
 * Semantics were checked against bb-plugin-claude-config/app.tsx's own
 * navigation (resolveAbs/isInTabLink/fileRefFromCode) — it's the reference behavior.
 */

// A link from `<a href>` (or a raw markdown target) is followed inside the
// tab if it's a local path: not a scheme like http:/mailto:, not
// protocol-relative `//`, not an anchor `#...`, not empty.
export function isInTabLink(href: string): boolean {
  if (!href || href.startsWith("#") || href.startsWith("//")) return false;
  return !/^[a-z][a-z0-9+.-]*:/i.test(href);
}

// The title in double quotes is stripped FIRST (it can sit before the
// anchor in the source markdown target: `path "title"#anchor`), then the anchor.
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

// Resolves a ref (relative or absolute) against the DIRECTORY of fromPath
// into an absolute normalized path: collapses `.`/`..`, strips the trailing
// (and any empty) segment — "/a/b/" and "/a/b" give the same result.
// Algorithm is 1:1 with Config.resolveAbs, just with the file's path as the base instead of the currently open document.
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

// Inline code text like `references/01-x.md` is a file reference: a relative
// path with an extension, no spaces, schemes, or `=` signs (this excludes
// `user-scalable=no`). Otherwise — null.
export function fileRefFromCode(text: string): string | null {
  const trimmed = text.trim();
  return /^(\.\.?\/)?([\w.-]+\/)*[\w.-]+\.[a-z0-9]+$/i.test(trimmed)
    ? trimmed
    : null;
}
