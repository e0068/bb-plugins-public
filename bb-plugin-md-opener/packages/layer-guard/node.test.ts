import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readSourceFiles } from "./node";

const roots: string[] = [];

function tree(files: ReadonlyArray<string>): string {
  const root = mkdtempSync(join(tmpdir(), "layer-guard-"));
  roots.push(root);
  for (const file of files) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), "export {};\n");
  }
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("readSourceFiles", () => {
  it("reads sources and leaves out tests, vitest config, test support, dependencies and build output", () => {
    const root = tree([
      "index.ts",
      "views/Row.tsx",
      "views/Row.test.tsx",
      "vitest.setup.ts",
      "test-support/kit.ts",
      "views/test-support/fixture.tsx",
      "node_modules/pkg/index.ts",
      "dist/app.ts",
      "notes.md",
    ]);
    expect(readSourceFiles(root).map((f) => f.path).sort()).toEqual(["index.ts", "views/Row.tsx"]);
  });
});
