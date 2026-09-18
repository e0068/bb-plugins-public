// @vitest-environment node
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { createJournalDirStore } from "./dir-settings";

const store = async () => {
  const { bb } = createFakePluginHost({ pluginId: "flow" });
  return createJournalDirStore(bb.storage.kv);
};

describe("createJournalDirStore", () => {
  it("проект без настройки — not_configured", async () => {
    const dirs = await store();
    expect(await dirs.get("proj_1")).toEqual({ kind: "not_configured" });
  });

  it("записывает и читает относительный путь", async () => {
    const dirs = await store();
    expect(await dirs.set("proj_1", "memory/decisions")).toEqual({ kind: "saved", path: "memory/decisions" });
    expect(await dirs.get("proj_1")).toEqual({ kind: "configured", path: "memory/decisions" });
  });

  it("режет хвостовой слэш и ведущее ./", async () => {
    const dirs = await store();
    await dirs.set("proj_1", "./memory/decisions/");
    expect(await dirs.get("proj_1")).toEqual({ kind: "configured", path: "memory/decisions" });
  });

  it("отбивает абсолютный путь", async () => {
    const dirs = await store();
    expect(await dirs.set("proj_1", "/etc/passwd")).toEqual({ kind: "invalid", reason: "absolute" });
    expect(await dirs.get("proj_1")).toEqual({ kind: "not_configured" });
  });

  it("отбивает путь с выходом наверх", async () => {
    const dirs = await store();
    expect(await dirs.set("proj_1", "memory/../../escape")).toEqual({ kind: "invalid", reason: "traversal" });
  });

  it("пустая строка снимает настройку", async () => {
    const dirs = await store();
    await dirs.set("proj_1", "memory/decisions");
    expect(await dirs.set("proj_1", "  ")).toEqual({ kind: "saved", path: null });
    expect(await dirs.get("proj_1")).toEqual({ kind: "not_configured" });
  });

  it("list отдаёт карту всех настроенных проектов", async () => {
    const dirs = await store();
    await dirs.set("proj_1", "memory/decisions");
    await dirs.set("proj_2", "docs/decisions");
    expect(await dirs.list()).toEqual({ proj_1: "memory/decisions", proj_2: "docs/decisions" });
  });
});
