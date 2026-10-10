// @vitest-environment node
//
// Тема окна через стыки, которые видит фронт: RPC и сигнал realtime; файл темы —
// в настоящей временной папке, которую отдаёт подделанный каталог тем bb.
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";

import { THEME_CHANGED } from "./core/theme";
import plugin from "./server";

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function boot(dir?: string) {
  const themes = dir ?? (await mkdtemp(join(tmpdir(), "wc-themes-")));
  dirs.push(themes);
  const host = createFakePluginHost({
    pluginId: "window-chrome",
    sdk: { theme: { catalog: async () => ({ dir: themes, custom: [], plugins: [] }), set: async () => undefined } } as never,
  });
  await plugin(host.bb);
  return { host, themes };
}

type Host = Awaited<ReturnType<typeof boot>>["host"];

const call = (host: Host, method: string, input: unknown) => host.harness.behavior.callRpc(method, input);
const signals = (host: Host) => host.harness.inspection.realtimeSignals.filter((s) => s.channel === THEME_CHANGED).length;
const switches = (host: Host) => host.harness.sdk.callsTo("theme.set");

describe("значения темы окна", () => {
  it("до первой записи значений нет — всё как в теме bb", async () => {
    const { host } = await boot();
    expect(await call(host, "get", null)).toEqual({});
  });

  it("записанное читается обратно, недопустимое отброшено, окна получают сигнал", async () => {
    const { host } = await boot();
    await call(host, "set", { light: { primary: "#2E6F95" }, radius: 99, islandRadius: 16 });
    expect(await call(host, "get", null)).toEqual({ light: { primary: "#2e6f95" }, islandRadius: 16 });
    expect(signals(host)).toBe(1);
  });
});

describe("сохранить как тему", () => {
  it("пишет theme.css с обоими наборами цветов и включает тему", async () => {
    const { host, themes } = await boot();
    await call(host, "set", { light: { canvas: "#fafafa" }, dark: { canvas: "#101010" }, radius: 6 });

    expect(await call(host, "saveTheme", { name: "Ocean Blue", replace: false })).toEqual({ status: "saved", id: "ocean-blue", message: null });
    const css = await readFile(join(themes, "ocean-blue", "theme.css"), "utf8");
    expect(css).toContain(":root, .light {\n  --canvas: #fafafa;\n}");
    expect(css).toContain(".dark {\n  --canvas: #101010;\n}");
    expect(css).toContain("--radius: 6px;");
    expect(switches(host)).toEqual([["ocean-blue"]]);
  });

  it("папки тем ещё нет — она создаётся", async () => {
    const root = await mkdtemp(join(tmpdir(), "wc-root-"));
    const { host } = await boot(join(root, "theme"));
    dirs.push(root);
    expect((await call(host, "saveTheme", { name: "first", replace: false })) as { status: string }).toMatchObject({ status: "saved" });
  });

  it("занятое имя без замены ничего не пишет и не переключает, с заменой — перезаписывает", async () => {
    const { host, themes } = await boot();
    await call(host, "saveTheme", { name: "mine", replace: false });
    await call(host, "set", { radius: 10 });

    expect(await call(host, "saveTheme", { name: "mine", replace: false })).toEqual({ status: "exists", id: "mine", message: null });
    expect(await readFile(join(themes, "mine", "theme.css"), "utf8")).not.toContain("--radius");
    expect(switches(host)).toHaveLength(1);

    expect(await call(host, "saveTheme", { name: "mine", replace: true })).toMatchObject({ status: "saved" });
    expect(await readFile(join(themes, "mine", "theme.css"), "utf8")).toContain("--radius: 10px;");
  });

  it("кириллица, пустое имя и имя встроенной темы не годятся", async () => {
    const { host } = await boot();
    for (const name of ["Моя тема", "", "nord"]) {
      expect(await call(host, "saveTheme", { name, replace: false })).toEqual({ status: "invalid_name", id: null, message: null });
    }
    expect(switches(host)).toHaveLength(0);
  });

  it("папку тем не создать — ответ с текстом ошибки, тема не переключается", async () => {
    const root = await mkdtemp(join(tmpdir(), "wc-file-"));
    dirs.push(root);
    const blocker = join(root, "theme");
    await writeFile(blocker, "not a folder");
    const { host } = await boot(blocker);

    const result = (await call(host, "saveTheme", { name: "broken", replace: false })) as { status: string; message: string | null };
    expect(result.status).toBe("write_failed");
    expect(result.message).toMatch(/\S/u);
    expect(switches(host)).toHaveLength(0);
  });
});
