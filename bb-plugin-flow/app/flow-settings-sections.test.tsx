// @vitest-environment jsdom
// Общие настройки Flow — на странице настроек плагина: ширина кнопки этапа и выбор flow агентом с корневым навыком.
import { cleanup, fireEvent } from "@testing-library/react";
import type { PluginSettingsSectionProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { FlowSettings, flowSettingsRpcContract, RootSkill } from "../shared/contract";

const app = await loadPluginApp(() => import("../app"));

afterEach(cleanup);

const settings: FlowSettings = { version: 2, flows: [{ id: "default", name: "Default", stages: [] }], minButtonWidth: 170 };

const open = (id: string, options: { rootSkill?: RootSkill; initial?: FlowSettings } = {}) =>
  renderSlot<PluginSettingsSectionProps, typeof flowSettingsRpcContract>(app.settingsSections.find((s) => s.id === id)!, {}, {
    rpc: { getFlowSettings: () => options.initial ?? settings, saveFlowSettings: (input: unknown) => input, getStageCatalog: () => ({ skills: [], executors: [] }), getRootSkill: () => options.rootSkill ?? null } as never,
    settings: { language: "Русский" },
  });

type Slot = ReturnType<typeof open>;
const lastSaved = (slot: Slot): FlowSettings | undefined => [...slot.rpcCalls].reverse().find((c) => c.method === "saveFlowSettings")?.input as FlowSettings | undefined;

describe("секции настроек Flow", () => {
  it("зарегистрированы обе: кнопки этапов и выбор flow агентом", () => {
    expect(app.settingsSections.map((s) => s.id)).toEqual(expect.arrayContaining(["stage-buttons", "agent-flow-choice"]));
  });

  it("Flow — пункт левого меню, а таблицы этапов в секциях настроек нет", async () => {
    expect(app.navPanels.map((p) => [p.id, p.title, p.path])).toEqual([["flows", "Flow", "flows"]]);
    for (const id of ["stage-buttons", "agent-flow-choice"]) {
      const slot = open(id);
      await vi.waitFor(() => expect(slot.rpcCalls.some((c) => c.method === "getFlowSettings")).toBe(true));
      expect(slot.queryByRole("row", { name: "Этап 1" })).toBeNull();
      cleanup();
    }
  });

  it("ширина кнопки этапа сохраняется для всех flow", async () => {
    const slot = open("stage-buttons");
    const input = await slot.findByRole("spinbutton", { name: "Минимальная ширина кнопки, px" });
    fireEvent.change(input, { target: { value: "220" } });
    fireEvent.blur(input);
    await vi.waitFor(() => expect(lastSaved(slot)?.minButtonWidth).toBe(220));
  });

  it("переключатель выбора flow агентом выключен по умолчанию и включается", async () => {
    const slot = open("agent-flow-choice");
    const toggle = await slot.findByRole("switch", { name: "Если flow не выбран — агент выбирает сам" });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(toggle);
    await vi.waitFor(() => expect(lastSaved(slot)?.agentChoosesFlow).toBe(true));
  });

  it("включённый переключатель выключается", async () => {
    const slot = open("agent-flow-choice", { initial: { ...settings, agentChoosesFlow: true } });
    const toggle = await slot.findByRole("switch", { name: "Если flow не выбран — агент выбирает сам" });
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(toggle);
    await vi.waitFor(() => expect(lastSaved(slot)?.agentChoosesFlow).toBe(false));
  });

  it("ссылка открывает файл корневого навыка превью bb на его хосте", async () => {
    const slot = open("agent-flow-choice", { rootSkill: { hostId: "host_local", path: "/home/owner/.claude/skills/flow/SKILL.md" } });
    fireEvent.click(await slot.findByRole("button", { name: "Корневой навык flow" }));
    expect(slot.navigateCalls.at(-1)).toMatchObject({ method: "experimental_openFilePreview", options: { target: { kind: "host", hostId: "host_local", path: "/home/owner/.claude/skills/flow/SKILL.md" } } });
  });

  it("нет корневого навыка — подпись, где его ждут, без ссылки", async () => {
    const slot = open("agent-flow-choice");
    expect(await slot.findByText("Корневой навык flow не найден в ~/.claude/skills")).toBeTruthy();
    expect(slot.queryByRole("button", { name: "Корневой навык flow" })).toBeNull();
  });
});
