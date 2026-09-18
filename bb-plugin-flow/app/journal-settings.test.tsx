// @vitest-environment jsdom
import { cleanup, fireEvent } from "@testing-library/react";
import type { PluginSettingsSectionProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, describe, expect, it } from "vitest";

import type { journalSettingsRpcContract } from "../shared/contract";

const app = await loadPluginApp(() => import("../app"));

afterEach(cleanup);

type Project = { id: string; name: string; path: string | null };
type SetResult = { kind: "saved"; path: string | null } | { kind: "invalid"; reason: "absolute" | "traversal" };

const open = (projects: Project[] | (() => Project[]), setResult: SetResult | (() => SetResult) = { kind: "saved", path: null }) => {
  const registration = app.settingsSections.find((s) => s.id === "journal-dirs")!;
  return renderSlot<PluginSettingsSectionProps, typeof journalSettingsRpcContract>(registration, {}, {
    rpc: {
      getJournalProjects: typeof projects === "function" ? projects : () => projects,
      setJournalDir: typeof setResult === "function" ? setResult : () => setResult,
    } as never,
  });
};

describe("секция пути журнала решений", () => {
  it("секция зарегистрирована с заголовком", () => {
    expect(app.settingsSections.map((s) => s.id)).toContain("journal-dirs");
  });

  it("показывает подсказку у проекта без настроенного пути", async () => {
    const slot = open([{ id: "proj_1", name: "bb-plugins", path: null }]);
    expect(await slot.findByText("bb-plugins")).toBeTruthy();
    expect(await slot.findByText("Не задано — журнал не ведётся")).toBeTruthy();
  });

  it("показывает уже настроенный путь в поле", async () => {
    const slot = open([{ id: "proj_1", name: "bb-plugins", path: "memory/decisions" }]);
    const input = (await slot.findByLabelText("bb-plugins")) as HTMLInputElement;
    expect(input.value).toBe("memory/decisions");
  });

  it("сохраняет по уходу фокуса одним вызовом RPC", async () => {
    const slot = open([{ id: "proj_1", name: "bb-plugins", path: null }], { kind: "saved", path: "memory/decisions" });
    const input = await slot.findByLabelText("bb-plugins");
    fireEvent.change(input, { target: { value: "memory/decisions" } });
    fireEvent.blur(input);
    await new Promise((r) => setTimeout(r, 0));
    const saves = slot.rpcCalls.filter((c) => c.method === "setJournalDir");
    expect(saves).toHaveLength(1);
    expect(saves[0]!.input).toEqual({ projectId: "proj_1", path: "memory/decisions" });
  });

  it("неверный путь показывает причину и не теряет введённый текст", async () => {
    const slot = open([{ id: "proj_1", name: "bb-plugins", path: null }], { kind: "invalid", reason: "absolute" });
    const input = (await slot.findByLabelText("bb-plugins")) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "/etc" } });
    fireEvent.blur(input);
    expect(await slot.findByText("Путь должен быть относительным")).toBeTruthy();
    expect(input.value).toBe("/etc");
  });

  it("выход наверх — своя причина под полем", async () => {
    const slot = open([{ id: "proj_1", name: "bb-plugins", path: null }], { kind: "invalid", reason: "traversal" });
    const input = await slot.findByLabelText("bb-plugins");
    fireEvent.change(input, { target: { value: "../escape" } });
    fireEvent.blur(input);
    expect(await slot.findByText("Путь не может выходить выше корня (..)")).toBeTruthy();
  });

  it("сбой RPC при сохранении — видна причина, текст не пропадает", async () => {
    const slot = open([{ id: "proj_1", name: "bb-plugins", path: null }], () => {
      throw new Error("host unreachable");
    });
    const input = (await slot.findByLabelText("bb-plugins")) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "memory/decisions" } });
    fireEvent.blur(input);
    expect(await slot.findByText("Не удалось сохранить — проверь соединение и попробуй снова")).toBeTruthy();
    expect(input.value).toBe("memory/decisions");
  });

  it("сбой RPC при загрузке — сообщение об ошибке вместо списка", async () => {
    const slot = open(() => {
      throw new Error("host unreachable");
    });
    expect(await slot.findByText("Не удалось загрузить проекты — обнови страницу")).toBeTruthy();
  });

  it("несколько проектов — по строке на каждый", async () => {
    const slot = open([
      { id: "proj_1", name: "bb-plugins", path: "memory/decisions" },
      { id: "proj_2", name: "Corpus", path: null },
    ]);
    await slot.findByText("bb-plugins");
    expect(await slot.findAllByRole("textbox")).toHaveLength(2);
  });
});
