// @vitest-environment node
// Уборка старого корневого навыка идёт при запуске плагина — в домашней папке, которую видит процесс.
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { mkdir, mkdtemp, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import plugin from "./server";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("запуск плагина", () => {
  it("убирает корневой навык, оставленный прежним Flow", async () => {
    const home = await mkdtemp(join(tmpdir(), "flow-home-"));
    const dir = join(home, ".claude", "skills", "flow");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "SKILL.md"), "---\nname: flow\n---\n\nФайл пишет плагин Flow из названий и описаний flow на странице Flow.\n");
    vi.stubEnv("HOME", home);
    const { bb } = createFakePluginHost({ pluginId: "flow" });
    await plugin(bb);
    expect(await stat(dir).then(() => true, () => false)).toBe(false);
  });
});
