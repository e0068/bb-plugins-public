// Layer 1 — which plugins a merged PR touches, counting the shared packages
// they build in. Zero effects: the changed paths and the output of
// `git grep -z -o` (git-commands.ts `pluginImportsArgs`) arrive as values.
//
// A plugin bundles every package its code imports, so a change inside
// `packages/<name>` reaches each plugin that imports it — directly or through
// another package. Only code counts: tests, fixtures, build configs
// (tsconfig, package.json, vitest config), README files and build output never
// end up in the bundle.
import { touchedPluginIds } from "./plugin-paths";

const PLUGIN_DIR_PREFIX = "bb-plugin-";
const PACKAGES_DIR = "packages";

/** One import of a shared package: `from` imports package `to`. */
export interface ImportEdge {
  readonly from: { readonly kind: "plugin" | "package"; readonly name: string };
  readonly to: string;
}

/** Plugins the PR changed itself, and the ones it reaches only through a package they build. */
export interface TouchedPlugins {
  readonly direct: readonly string[];
  readonly viaPackage: readonly string[];
}

/**
 * A file that never ships in a bundle: a test, a test helper or fixture, a
 * build config (tsconfig, package manifest, vitest config), docs, dependencies
 * or build output. Configs are named one by one rather than every `*.json`: a
 * JSON module the code imports does ship.
 */
const isNotShipped = (path: string): boolean =>
  /\.test\.[cm]?[jt]sx?$/.test(path) ||
  /(^|\/)(test|__tests__|fixtures|node_modules|dist)\//.test(path) ||
  /(^|\/)vitest\.config\.[cm]?[jt]s$/.test(path) ||
  /(^|\/)(package(-lock)?|tsconfig[^/]*)\.json$/.test(path) ||
  /\.md$/i.test(path);

/** The plugin or package a repository path belongs to; `null` outside both. */
const ownerOf = (path: string): ImportEdge["from"] | null => {
  const [top, second] = path.split("/");
  if (top?.startsWith(PLUGIN_DIR_PREFIX)) return { kind: "plugin", name: top.slice(PLUGIN_DIR_PREFIX.length) };
  if (top === PACKAGES_DIR && second) return { kind: "package", name: second };
  return null;
};

const IMPORTED = /(?:@bb-plugins\/|packages\/)([a-z0-9-]+)$/;

/**
 * `git grep -z -o` output — one hit per line, the path and the quoted
 * specifier split by NUL, so a path with a colon or non-ASCII letters comes
 * through as is — into distinct edges from shipped code; anything else is
 * dropped.
 */
export function parseImportOutput(output: string): readonly ImportEdge[] {
  const edges = output.split("\n").flatMap((line): ImportEdge[] => {
    const [path, match, ...rest] = line.split("\0");
    if (path === undefined || match === undefined || rest.length > 0) return [];
    const from = ownerOf(path);
    const to = IMPORTED.exec(match)?.[1];
    if (from === null || to === undefined || isNotShipped(path)) return [];
    return from.kind === "package" && from.name === to ? [] : [{ from, to }];
  });
  const key = (e: ImportEdge) => `${e.from.kind}:${e.from.name}>${e.to}`;
  return [...new Map(edges.map((e) => [key(e), e])).values()];
}

/** Distinct packages whose shipped code the paths change, in path order. */
export const changedPackages = (paths: readonly string[]): readonly string[] => [
  ...new Set(paths.flatMap((path) => {
    const owner = ownerOf(path);
    return owner?.kind === "package" && !isNotShipped(path) ? [owner.name] : [];
  })),
];

/** The changed packages plus every package that imports one of them, however deep. */
const reachedPackages = (changed: ReadonlySet<string>, edges: readonly ImportEdge[]): ReadonlySet<string> => {
  const next = new Set([
    ...changed,
    ...edges.filter((e) => e.from.kind === "package" && changed.has(e.to)).map((e) => e.from.name),
  ]);
  return next.size === changed.size ? changed : reachedPackages(next, edges);
};

/** Distinct plugin ids in path order, and — apart from them — the plugins that build a changed package. */
export function touchedPlugins(changedPaths: readonly string[], edges: readonly ImportEdge[]): TouchedPlugins {
  const direct = touchedPluginIds(changedPaths);
  const reached = reachedPackages(new Set(changedPackages(changedPaths)), edges);
  const viaPackage = [
    ...new Set(edges.filter((e) => e.from.kind === "plugin" && reached.has(e.to)).map((e) => e.from.name)),
  ].filter((id) => !direct.includes(id));
  return { direct, viaPackage };
}
