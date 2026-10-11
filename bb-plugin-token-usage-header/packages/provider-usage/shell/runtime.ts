import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Both source layout and built/published plugins keep the Python package as an asset. */
export const adapterPath = (start: string, exists = existsSync): string | undefined => {
  let dir = start;
  for (let depth = 0; depth < 7; depth++) {
    for (const path of [join(dir, "store.py"), join(dir, "packages/provider-usage/shell/store.py")])
      if (exists(path)) return path;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
  return undefined;
};
export const readNativeTranscript = (sessionId: string): Promise<readonly string[] | undefined> => {
  const path = adapterPath(dirname(fileURLToPath(import.meta.url)));
  if (path === undefined) return Promise.resolve(undefined);
  return new Promise((resolve) => {
    execFile("python3", [path, sessionId], { timeout: 30_000, maxBuffer: 32 * 1024 * 1024 }, (error, stdout) => {
      resolve(error || !stdout.trim() ? undefined : stdout.trimEnd().split("\n"));
    });
  });
};
