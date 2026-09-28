import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import type { SourceFile } from "./core.js";

export interface ReadOptions {
  readonly extensions?: ReadonlyArray<string>;
  /** Paths (relative to root, posix) to leave out; tests, `test-support/` and generated output by default. */
  readonly skip?: (relPath: string) => boolean;
}

const DEFAULT_EXTENSIONS = [".ts", ".tsx"];

function defaultSkip(relPath: string): boolean {
  return (
    /(^|\/)(node_modules|dist|test-support|\.[^/]+)(\/|$)/.test(relPath) ||
    /\.test\.[cm]?[jt]sx?$/.test(relPath) ||
    /(^|\/)vitest\.(setup|config)\.[cm]?[jt]s$/.test(relPath)
  );
}

/** All source files under `root`, paths relative to it with posix separators. */
export function readSourceFiles(root: string, options: ReadOptions = {}): ReadonlyArray<SourceFile> {
  const extensions = options.extensions ?? DEFAULT_EXTENSIONS;
  const skip = options.skip ?? defaultSkip;
  const files: SourceFile[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const absolute = join(dir, entry.name);
      const relPath = relative(root, absolute).split(sep).join("/");
      if (skip(relPath)) continue;
      if (entry.isDirectory()) walk(absolute);
      else if (extensions.some((ext) => entry.name.endsWith(ext))) {
        files.push({ path: relPath, source: readFileSync(absolute, "utf8") });
      }
    }
  };
  walk(root);
  return files;
}
