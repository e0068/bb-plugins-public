import { expect } from "vitest";

/** What a loader says when the module file is not there at all. */
const MISSING_MODULE = /Cannot find module|Failed to load url|does not exist/i;

/**
 * Loads a module the plan promises. Until a subtask writes it — or writes
 * the export a test asks for — every missing name is a function that fails
 * the test on an assertion naming it, so a red test is red for the promised
 * reason instead of dying on import. A module that exists but does not load
 * (a syntax error) still throws: that is a defect, not a promise.
 *
 * The loader passes a path held in a variable to `import()`, so the bundler
 * does not try to resolve a file that is not written yet:
 *   const path = "./hrana.js";
 *   const hrana = await planned<typeof import("./hrana.js")>(() => import(path));
 */
export async function planned<M extends object>(load: () => Promise<unknown>): Promise<M> {
  const loaded = (await load().catch((error: unknown) => {
    if (error instanceof Error && MISSING_MODULE.test(error.message)) return {};
    throw error;
  })) as Record<string | symbol, unknown>;
  return new Proxy(loaded, {
    get(target, name) {
      if (typeof name !== "string" || name === "then" || name in target) return target[name];
      return function notThereYet() {
        expect.fail(`«${name}» is promised by the plan and is not there yet`);
      };
    },
  }) as M;
}
