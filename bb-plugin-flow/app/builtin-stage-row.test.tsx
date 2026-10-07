// @vitest-environment jsdom
// Встроенный этап (Вопросы, Критерии, Выбор этапов, Демонстрация) в таблице выглядит иначе остальных: имя
// зафиксировано, а в исполнении — только тег его навыка, без креста и без плюса; тег открывает навык.
import { cleanup, fireEvent, within } from "@testing-library/react";
import type { PluginNavPanelProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, describe, expect, it, vi } from "vitest";

import { builtinStage } from "../lib/stage-constants";
import type { flowSettingsRpcContract, StageCatalog, WorkStage } from "../shared/contract";

const app = await loadPluginApp(() => import("../app"));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const STAGES: WorkStage[] = [
  builtinStage("questions", []),
  builtinStage("criteria", []),
  builtinStage("select", []),
  { ...builtinStage("demo", []), skill: "my-demo" },
  { id: "spec", kind: "skill", skill: "spec", name: "Spec", executors: [] },
];

const CATALOG: StageCatalog = { skills: [{ name: "flow-questions" }, { name: "my-demo" }, { name: "spec" }], executors: [] };

const open = (language = "Русский") => {
  vi.stubGlobal("fetch", async () => new Response("{}", { status: 404 }));
  return renderSlot<PluginNavPanelProps, typeof flowSettingsRpcContract>(app.navPanels.find((p) => p.id === "flows")!, { subPath: "" }, {
    rpc: {
      getFlowSettings: () => ({ flows: [{ id: "default", name: "Default", stages: STAGES }], minButtonWidth: 170 }),
      saveFlowSettings: (input: unknown) => input,
      getStageCatalog: () => CATALOG,
      getRootSkill: () => null,
      getSkillFile: ({ name }: { name: string }) => ({ hostId: "host_local", path: `/skills/${name}/SKILL.md` }),
    } as never,
    settings: { language },
  });
};
type Slot = ReturnType<typeof open>;

const row = async (slot: Slot, n: number) => within(await slot.findByRole("row", { name: `Этап ${n}` }));
const previews = (slot: Slot) => slot.navigateCalls.filter((c) => c.method === "experimental_openFilePreview");

describe("встроенный этап в таблице", () => {
  it("имя зафиксировано: текстом, без поля ввода", async () => {
    const slot = open();
    const first = await row(slot, 1);
    expect(first.getByText("Вопросы")).toBeTruthy();
    expect(first.queryByRole("textbox", { name: "Название этапа 1" })).toBeNull();
    expect((await row(slot, 5)).getByRole("textbox", { name: "Название этапа 5" })).toBeTruthy();
  });

  it("в исполнении — тег навыка «Навык: имя» без креста и без плюса, описания нет", async () => {
    const slot = open();
    for (const [n, skill] of [[1, "flow-questions"], [4, "my-demo"]] as const) {
      const r = await row(slot, n);
      expect(r.getByRole("button", { name: `Навык: ${skill}` })).toBeTruthy();
      expect(r.queryByRole("button", { name: "Исполнение этапа" })).toBeNull();
      expect(r.queryByRole("button", { name: /^Убрать/ })).toBeNull();
    }
    expect(slot.queryByText(/^Спрашивает владельца/)).toBeNull();
    expect((await row(slot, 5)).getByRole("button", { name: "Исполнение этапа" })).toBeTruthy();
  });

  it("тег навыка открывает навык этапа в правой панели — навык вида или свой", async () => {
    const slot = open();
    fireEvent.click((await row(slot, 1)).getByRole("button", { name: "Навык: flow-questions" }));
    await vi.waitFor(() => expect(previews(slot).at(-1)).toMatchObject({ options: { target: { path: "/skills/flow-questions/SKILL.md" } } }));
    fireEvent.click((await row(slot, 4)).getByRole("button", { name: "Навык: my-demo" }));
    await vi.waitFor(() => expect(previews(slot).at(-1)).toMatchObject({ options: { target: { path: "/skills/my-demo/SKILL.md" } } }));
  });

  it("по-английски имя английское, тег — «Skill: имя»", async () => {
    const slot = open("English");
    const first = within(await slot.findByRole("row", { name: "Stage 1" }));
    expect(first.getByText("Questions")).toBeTruthy();
    expect(first.getByRole("button", { name: "Skill: flow-questions" })).toBeTruthy();
  });
});
