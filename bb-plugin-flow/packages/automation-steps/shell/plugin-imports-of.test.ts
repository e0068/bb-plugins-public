// @vitest-environment node
// Граф импортов читается в рабочей копии окружения треда; без неё — причина, а не пустой граф.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { pluginImportsOf, type Sdk } from "./pr-helpers";

for (const name of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE"]) delete process.env[name];

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

const sdkWith = (path: string | null) =>
  ({ environments: { get: async () => ({ id: "e1", path }) } }) as unknown as Sdk;

describe("pluginImportsOf", () => {
  it("читает импорты в рабочей копии окружения", async () => {
    const root = mkdtempSync(join(tmpdir(), "imports-of-"));
    dirs.push(root);
    execFileSync("git", ["init", "-q", root]);
    mkdirSync(join(root, "bb-plugin-flow"));
    writeFileSync(join(root, "bb-plugin-flow/server.ts"), `import { createSteps } from "@bb-plugins/automation-steps/steps";\n`);
    execFileSync("git", ["add", "-A"], { cwd: root });
    expect(await pluginImportsOf(sdkWith(root), "e1")).toEqual({
      ok: true,
      edges: [{ from: { kind: "plugin", name: "flow" }, to: "automation-steps" }],
    });
  });

  it("тред без окружения или окружение без рабочей копии — причина", async () => {
    expect(await pluginImportsOf(sdkWith(null), null)).toMatchObject({ ok: false, reason: expect.stringContaining("environment") });
    expect(await pluginImportsOf(sdkWith(null), "e1")).toMatchObject({ ok: false, reason: expect.stringContaining("working copy") });
  });

  it("bb не отдал окружение — причина с его словами, а не исключение", async () => {
    const failing = { environments: { get: async () => Promise.reject(new Error("environment gone")) } } as unknown as Sdk;
    expect(await pluginImportsOf(failing, "e1")).toEqual({ ok: false, reason: "environment gone" });
  });
});
