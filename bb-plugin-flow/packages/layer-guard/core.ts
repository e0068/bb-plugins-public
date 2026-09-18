/**
 * Layer guard — pure core. No I/O: takes file paths with their source text,
 * finds imports that cross module units (top-level folders or root files) and
 * checks them against a declared layer order. `node.ts` is the only place
 * that touches the file system.
 */

/** A source file addressed relative to the scanned root, posix separators. */
export interface SourceFile {
  readonly path: string;
  readonly source: string;
}

export interface ImportSpecifier {
  readonly specifier: string;
  /** `import type` / `export type` — erased at runtime, still a design edge. */
  readonly typeOnly: boolean;
}

/** One import that leaves its unit. `from`/`to` are unit names. */
export interface UnitEdge {
  readonly importer: string;
  readonly specifier: string;
  readonly from: string;
  readonly to: string;
  readonly typeOnly: boolean;
}

export interface EdgeOptions {
  /** Path aliases, e.g. `{ "@/": "" }` maps `@/lib/x` onto `lib/x`. */
  readonly aliases?: Readonly<Record<string, string>>;
  /** Folders whose subfolders are units of their own, e.g. `["src"]` makes `src/core` and `src/ui` two units. */
  readonly nested?: ReadonlyArray<string>;
}

/** Layers from the lowest up; a unit may import only units of strictly lower layers. */
export type Layers = ReadonlyArray<ReadonlyArray<string>>;

export type Violation =
  | { readonly kind: "upward"; readonly edge: UnitEdge }
  | { readonly kind: "sideways"; readonly edge: UnitEdge }
  | { readonly kind: "unlisted"; readonly unit: string; readonly edge: UnitEdge };

const IMPORT_RE =
  /\b(?:import|export)\s+(type\s+)?(?:[^;'"]*?\s+from\s+)?['"]([^'"]+)['"]|\bimport\(\s*['"]([^'"]+)['"]\s*\)/g;

/**
 * `source` with every `//` and `/* *\/` comment replaced by a space, strings
 * left intact. The import pattern spans lines (an import list can), so a
 * comment that merely says "import type" would otherwise swallow the real
 * import under it and mark it type-only. Template literals are kept whole;
 * a comment inside `${…}` is not recognised — a guard need not parse JS.
 */
function withoutComments(source: string): string {
  let out = "";
  let i = 0;
  while (i < source.length) {
    const char = source[i]!;
    const next = source[i + 1];
    if (char === "'" || char === '"' || char === "`") {
      let end = i + 1;
      while (end < source.length && source[end] !== char) end += source[end] === "\\" ? 2 : 1;
      out += source.slice(i, end + 1);
      i = end + 1;
    } else if (char === "/" && next === "/") {
      const end = source.indexOf("\n", i);
      out += " ";
      i = end < 0 ? source.length : end;
    } else if (char === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2);
      out += " ";
      i = end < 0 ? source.length : end + 2;
    } else {
      out += char;
      i += 1;
    }
  }
  return out;
}

/** Every static and dynamic import specifier in `source`, in order; comments say nothing. */
export function importSpecifiers(source: string): ReadonlyArray<ImportSpecifier> {
  const found: ImportSpecifier[] = [];
  for (const match of withoutComments(source).matchAll(IMPORT_RE)) {
    const specifier = match[2] ?? match[3];
    if (specifier === undefined) continue;
    found.push({ specifier, typeOnly: match[1] !== undefined });
  }
  return found;
}

/**
 * `views/list/row.tsx` → `views`; a root file `app.tsx` → `app`. Under a
 * nested root the unit goes one level deeper: with `["src"]`,
 * `src/core/x.ts` → `src/core` and `src/x.ts` → `src/x`.
 */
export function moduleUnit(relPath: string, nested: ReadonlyArray<string> = []): string {
  const root = nested.find((folder) => relPath.startsWith(`${folder}/`));
  if (root !== undefined) return `${root}/${moduleUnit(relPath.slice(root.length + 1))}`;
  const slash = relPath.indexOf("/");
  if (slash >= 0) return relPath.slice(0, slash);
  return relPath.replace(/\.[^.]+$/, "");
}

function normalize(segments: ReadonlyArray<string>): string | null {
  const out: string[] = [];
  for (const segment of segments) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (out.length === 0) return null;
      out.pop();
      continue;
    }
    out.push(segment);
  }
  return out.join("/");
}

/**
 * Path of the imported module relative to the root, or `null` when the
 * specifier is external (a bare package) or escapes the root.
 */
export function resolveSpecifier(
  importer: string,
  specifier: string,
  aliases: Readonly<Record<string, string>> = {},
): string | null {
  for (const [prefix, target] of Object.entries(aliases)) {
    if (specifier.startsWith(prefix)) {
      return normalize((target + specifier.slice(prefix.length)).split("/"));
    }
  }
  if (!specifier.startsWith(".")) return null;
  const dir = importer.split("/").slice(0, -1);
  return normalize([...dir, ...specifier.split("/")]);
}

/** Imports that leave their unit; imports inside one unit are not edges. */
export function crossUnitEdges(
  files: ReadonlyArray<SourceFile>,
  options: EdgeOptions = {},
): ReadonlyArray<UnitEdge> {
  const edges: UnitEdge[] = [];
  for (const file of files) {
    const from = moduleUnit(file.path, options.nested);
    for (const { specifier, typeOnly } of importSpecifiers(file.source)) {
      const target = resolveSpecifier(file.path, specifier, options.aliases);
      if (target === null) continue;
      const to = moduleUnit(target, options.nested);
      if (to === from) continue;
      edges.push({ importer: file.path, specifier, from, to, typeOnly });
    }
  }
  return edges;
}

/** Edges that point up, sideways within one layer, or at a unit no layer lists. */
export function layerViolations(
  edges: ReadonlyArray<UnitEdge>,
  layers: Layers,
): ReadonlyArray<Violation> {
  const index = new Map<string, number>();
  layers.forEach((units, depth) => {
    for (const unit of units) index.set(unit, depth);
  });
  const violations: Violation[] = [];
  for (const edge of edges) {
    const from = index.get(edge.from);
    const to = index.get(edge.to);
    if (from === undefined) violations.push({ kind: "unlisted", unit: edge.from, edge });
    else if (to === undefined) violations.push({ kind: "unlisted", unit: edge.to, edge });
    else if (to > from) violations.push({ kind: "upward", edge });
    else if (to === from) violations.push({ kind: "sideways", edge });
  }
  return violations;
}

/** One line per violation, ready for an assertion message. */
export function formatViolations(violations: ReadonlyArray<Violation>): string {
  return violations
    .map(({ kind, edge }) => {
      const note = kind === "unlisted" ? "unit not in any layer" : kind;
      return `${edge.importer} → ${edge.specifier} (${edge.from} → ${edge.to}): ${note}`;
    })
    .join("\n");
}

/**
 * Specifiers `bb plugin build` replaces with the host's shared runtime, so a
 * plugin never bundles them. Matched exactly — `react-dom/server` is not
 * shimmed. Copied from the shim map of bb 0.43.1
 * (`host-daemon/dist/bb-chunks/plugin-*.js`); the host owns the list.
 */
export const HOST_SHIMMED: ReadonlyArray<string> = [
  "react",
  "react-dom",
  "react-dom/client",
  "react/jsx-runtime",
  "react/jsx-dev-runtime",
  "@get-bb/plugin-sdk/app",
  "@bb/plugin-sdk/app",
  "@pierre/diffs",
  "@pierre/diffs/react",
  "@radix-ui/react-alert-dialog",
  "@radix-ui/react-context-menu",
  "@radix-ui/react-dialog",
  "@radix-ui/react-dropdown-menu",
  "@radix-ui/react-hover-card",
  "@radix-ui/react-menubar",
  "@radix-ui/react-navigation-menu",
  "@radix-ui/react-popover",
  "@radix-ui/react-select",
  "@radix-ui/react-tooltip",
  "sonner",
  "vaul",
  "clsx",
  "tailwind-merge",
  "class-variance-authority",
  "@bb/shared-ui/icon",
  "@bb/shared-ui/question-form-host",
];

/** A value import of a package the bundler has to find on disk. */
export interface BundledImport {
  readonly file: string;
  readonly specifier: string;
}

/**
 * Value imports of third-party packages outside `shimmed`. A shared package
 * compiled into a plugin resolves such an import from its own folder, where a
 * git install puts no `node_modules` — so the plugin build fails. `import type`
 * is erased by the bundler and never resolved.
 */
export function bundledImports(
  files: ReadonlyArray<SourceFile>,
  shimmed: ReadonlyArray<string>,
): ReadonlyArray<BundledImport> {
  const allowed = new Set(shimmed);
  return files.flatMap((file) =>
    importSpecifiers(file.source)
      .filter(({ specifier, typeOnly }) => !typeOnly && !/^[./]/.test(specifier) && !allowed.has(specifier))
      .map(({ specifier }) => ({ file: file.path, specifier })),
  );
}
