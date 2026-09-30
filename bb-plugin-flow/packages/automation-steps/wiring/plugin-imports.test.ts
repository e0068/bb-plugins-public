// @vitest-environment node
// Граф импортов общих пакетов читается из рабочей копии настоящим git grep.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { gitClient } from "./git-client";
import { readPluginImports } from "./plugin-imports";

for (const name of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE"]) delete process.env[name];

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

const repoWith = (files: Record<string, string>): string => {
  const root = mkdtempSync(join(tmpdir(), "plugin-imports-"));
  dirs.push(root);
  execFileSync("git", ["init", "-q", root]);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  execFileSync("git", ["add", "-A"], { cwd: root });
  return root;
};

describe("readPluginImports", () => {
  it("находит импорты пакетов из кода плагинов и пакетов, без тестов", async () => {
    const root = repoWith({
      "bb-plugin-flow/server/steps.ts": `import { createSteps } from "@bb-plugins/automation-steps/steps";\n`,
      "bb-plugin-flow/app/theme.css": `@import "../../packages/reduced-colors/colors.css";\n`,
      "bb-plugin-flow/architecture.test.ts": `import { x } from "../packages/layer-guard/index.js";\n`,
      "packages/md-editor/index.ts": `export { link } from '@bb-plugins/link-navigation';\n`,
      "docs/a.md": `"@bb-plugins/automation-steps"\n`,
    });
    expect(await readPluginImports(gitClient(root))).toEqual({
      ok: true,
      edges: expect.arrayContaining([
        { from: { kind: "plugin", name: "flow" }, to: "automation-steps" },
        { from: { kind: "plugin", name: "flow" }, to: "reduced-colors" },
        { from: { kind: "package", name: "md-editor" }, to: "link-navigation" },
      ]),
    });
    const read = await readPluginImports(gitClient(root));
    expect(read.ok && read.edges).toHaveLength(3);
  });

  it("tsconfig с extends на пакет — не импорт; файл с не-ASCII именем — импорт", async () => {
    const root = repoWith({
      "bb-plugin-flow/tsconfig.json": `{ "extends": "../packages/plugin-base/tsconfig.base.json" }\n`,
      "bb-plugin-flow/app/вид.tsx": `import { clamp } from "@bb-plugins/viewport-clamp";\n`,
    });
    expect(await readPluginImports(gitClient(root))).toEqual({
      ok: true,
      edges: [{ from: { kind: "plugin", name: "flow" }, to: "viewport-clamp" }],
    });
  });

  it("ни одного импорта — пустой граф, а не ошибка", async () => {
    const root = repoWith({ "bb-plugin-flow/server.ts": `export const x = 1;\n` });
    expect(await readPluginImports(gitClient(root))).toEqual({ ok: true, edges: [] });
  });

  it("не рабочая копия git — ошибка со словами git, а не пустой граф", async () => {
    const root = mkdtempSync(join(tmpdir(), "plugin-imports-bare-"));
    dirs.push(root);
    const read = await readPluginImports(gitClient(root));
    expect(read).toMatchObject({ ok: false, reason: expect.stringMatching(/git/i) });
  });
});
