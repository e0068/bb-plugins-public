import { execFile as nodeExecFile } from "node:child_process";
import { resolve, sep } from "node:path";

export interface RevealResult {
  revealed: boolean;
  error: string | null;
}

/** Shape of `node:child_process`'s `execFile`, narrowed to the one overload
 *  this module calls — injected so tests never spawn a real process. */
export type RevealExecFile = (
  file: string,
  args: readonly string[],
  callback: (error: Error | null) => void,
) => void;

export interface RevealDeps {
  platform: NodeJS.Platform;
  execFile: RevealExecFile;
}

/**
 * Joins a repo-relative task source path onto the project's absolute repo
 * root. Returns null if the joined path would escape the root (e.g. a
 * `filePath` containing `..` segments) rather than ever revealing outside it.
 */
export function resolveSourceAbsPath(
  rootPath: string,
  relativePath: string,
): string | null {
  const absoluteRoot = resolve(rootPath);
  const absolutePath = resolve(absoluteRoot, relativePath);
  if (
    absolutePath !== absoluteRoot &&
    !absolutePath.startsWith(`${absoluteRoot}${sep}`)
  ) {
    return null;
  }
  return absolutePath;
}

/**
 * Reveals `absPath` in Finder (`open -R <path>`, argv-array form — never
 * shell-interpolated) and selects it. Finder belongs to the machine running
 * bb's server, not necessarily the host the file lives on, so callers must
 * confirm `absPath`'s host is the local/primary one before calling this.
 * macOS only: `open -R` has no equivalent on other platforms.
 */
export function revealInFinder(
  absPath: string,
  deps: RevealDeps,
): Promise<RevealResult> {
  if (deps.platform !== "darwin") {
    return Promise.resolve({
      revealed: false,
      error: "Revealing in Finder is only available on macOS",
    });
  }
  return new Promise((resolvePromise) => {
    deps.execFile("open", ["-R", absPath], (error) => {
      resolvePromise(
        error
          ? { revealed: false, error: error.message }
          : { revealed: true, error: null },
      );
    });
  });
}

function defaultRevealExecFile(
  file: string,
  args: readonly string[],
  callback: (error: Error | null) => void,
): void {
  nodeExecFile(file, args as string[], callback);
}

/**
 * The real `execFile` the RPC handler passes to `revealInFinder`. Held as a
 * mutable object property — rather than passed as a plain function export —
 * because it is the RPC-level test seam: vitest module-mocking does not
 * reliably intercept a Node builtin re-exported through this project's
 * module graph (confirmed empirically), while reassigning a plain object's
 * own property works everywhere and needs no mock. Production code reads
 * `.current` fresh on every call; tests swap it in and call
 * `resetRevealExecFileProvider()` afterwards.
 */
export const revealExecFileProvider: { current: RevealExecFile } = {
  current: defaultRevealExecFile,
};

export function resetRevealExecFileProvider(): void {
  revealExecFileProvider.current = defaultRevealExecFile;
}
