// @vitest-environment jsdom
import { cleanup, fireEvent, within } from "@testing-library/react";
import type { PluginNavPanelProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, describe, expect, it, vi } from "vitest";

import { builtinStage } from "../lib/stage-constants";
import type { FlowSettings, flowSettingsRpcContract, SkillFile, StageCatalog } from "../shared/contract";

const app = await loadPluginApp(() => import("../app"));

afterEach(cleanup);

const settings: FlowSettings = {
  version: 2,
  flows: [{ id: "default", name: "Default", stages: [builtinStage("questions", []), { ...builtinStage("demo", ["questions"]), skill: "my-demo" }, { id: "task", kind: "skill", skill: "task-flow", name: "Задача", executors: [] }] }],
  minButtonWidth: 170,
};

const catalog: StageCatalog = { skills: [{ name: "flow-questions", description: "Этап Вопросы" }, { name: "flow-demo" }, { name: "my-questions" }, { name: "my-demo" }], executors: [] };

const open = () =>
  renderSlot<PluginNavPanelProps, typeof flowSettingsRpcContract>(app.navPanels.find((p) => p.id === "flows")!, { subPath: "" }, {
    rpc: { getFlowSettings: () => settings, saveFlowSettings: (input: unknown) => input, getStageCatalog: () => catalog } as never,
    settings: { language: "Русский" },
  });

type Slot = ReturnType<typeof open>;
const lastSaved = (slot: Slot): FlowSettings | undefined => [...slot.rpcCalls].reverse().find((c) => c.method === "saveFlowSettings")?.input as FlowSettings | undefined;
const row = async (slot: Slot, n: number) => within(await slot.findByRole("row", { name: `Этап ${n}` }));
const skillField = async (slot: Slot, n: number) => (await row(slot, n)).getByRole("combobox", { name: `Навык этапа ${n}` }) as HTMLInputElement;

describe("навык встроенного этапа в таблице этапов", () => {

  it("поле показывает свой навык владельца вместо навыка вида", async () => {
    const slot = open();
    expect((await skillField(slot, 2)).value).toBe("my-demo");
  });

  it("выбор другого навыка сохраняет его, а название этапа не трогает", async () => {
    const slot = open();
    fireEvent.focus(await skillField(slot, 1));
    fireEvent.click(slot.getByRole("option", { name: /my-questions/ }));
    await vi.waitFor(() => expect(lastSaved(slot)?.flows[0]?.stages[0]).toMatchObject({ kind: "questions", skill: "my-questions", name: "Questions" }));
  });

  it("выбор навыка вида возвращает этап к навыку по умолчанию — пустому полю", async () => {
    const slot = open();
    fireEvent.focus(await skillField(slot, 2));
    fireEvent.click(slot.getByRole("option", { name: /^flow-demo/ }));
    await vi.waitFor(() => expect(lastSaved(slot)?.flows[0]?.stages[1]).toMatchObject({ kind: "demo", skill: "", name: "Demonstration" }));
  });
});


describe("иконки файла навыка в поле навыка", () => {
  const openWith = (skillFile: (input: { name: string }) => SkillFile) =>
    renderSlot<PluginNavPanelProps, typeof flowSettingsRpcContract>(app.navPanels.find((p) => p.id === "flows")!, { subPath: "" }, {
      rpc: {
        getFlowSettings: () => settings,
        saveFlowSettings: (input: unknown) => input,
        getStageCatalog: () => catalog,
        getSkillFile: skillFile,
        revealSkill: ({ name }: { name: string }) => ({ revealed: name === "flow-questions", error: name === "flow-questions" ? null : "skill file not found" }),
      } as never,
      settings: { language: "Русский" },
    });

  it("первая кнопка открывает файл навыка просмотрщиком bb на его хосте", async () => {
    const slot = openWith(({ name }) => ({ hostId: "host_local", path: `/home/owner/.claude/skills/${name}/SKILL.md` }));
    fireEvent.click((await row(slot, 2)).getByRole("button", { name: "Открыть навык my-demo" }));
    await vi.waitFor(() =>
      expect(slot.navigateCalls.at(-1)).toMatchObject({ method: "experimental_openFilePreview", options: { target: { kind: "host", hostId: "host_local", path: "/home/owner/.claude/skills/my-demo/SKILL.md" } } }),
    );
  });

  it("файл навыка не найден — подпись у поля, превью не открывается", async () => {
    const slot = openWith(() => null);
    fireEvent.click((await row(slot, 2)).getByRole("button", { name: "Открыть навык my-demo" }));
    expect(await (await row(slot, 2)).findByText("Файл навыка не найден")).toBeTruthy();
    expect(slot.navigateCalls.some((c) => c.method === "experimental_openFilePreview")).toBe(false);
  });
});
