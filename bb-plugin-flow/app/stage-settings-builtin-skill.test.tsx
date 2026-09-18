// @vitest-environment jsdom
import { cleanup, fireEvent, within } from "@testing-library/react";
import type { PluginNavPanelProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, describe, expect, it, vi } from "vitest";

import { builtinStage } from "../lib/stage-constants";
import type { FlowSettings, flowSettingsRpcContract, RootSkill, StageCatalog } from "../shared/contract";

const app = await loadPluginApp(() => import("../app"));

afterEach(cleanup);

const settings: FlowSettings = {
  version: 2,
  flows: [{ id: "default", name: "Default", stages: [builtinStage("questions", []), { ...builtinStage("demo", ["questions"]), skill: "my-demo" }, { id: "task", kind: "skill", skill: "task-flow", name: "Задача", executors: [] }] }],
  minButtonWidth: 170,
};

const catalog: StageCatalog = { skills: [{ name: "flow-questions", description: "Этап Вопросы" }, { name: "flow-demo" }, { name: "my-questions" }, { name: "my-demo" }], executors: [] };

const open = (rootSkill: () => RootSkill = () => null) =>
  renderSlot<PluginNavPanelProps, typeof flowSettingsRpcContract>(app.navPanels.find((p) => p.id === "flows")!, { subPath: "" }, {
    rpc: { getFlowSettings: () => settings, saveFlowSettings: (input: unknown) => input, getStageCatalog: () => catalog, getRootSkill: rootSkill } as never,
    settings: { language: "Русский" },
  });

type Slot = ReturnType<typeof open>;
const lastSaved = (slot: Slot): FlowSettings | undefined => [...slot.rpcCalls].reverse().find((c) => c.method === "saveFlowSettings")?.input as FlowSettings | undefined;
const row = async (slot: Slot, n: number) => within(await slot.findByRole("row", { name: `Этап ${n}` }));
const skillField = async (slot: Slot, n: number) => (await row(slot, n)).getByRole("combobox", { name: `Навык этапа ${n}` }) as HTMLInputElement;

describe("навык встроенного этапа в таблице этапов", () => {
  it("строка встроенного вида показывает вид, поле навыка, название и охват, но не исполнителей", async () => {
    const slot = open();
    const questions = await row(slot, 1);
    expect(questions.getAllByText("Вопросы").length).toBeGreaterThan(0);
    expect((await skillField(slot, 1)).value).toBe("flow-questions");
    expect(questions.queryByRole("button", { name: "Добавить агента или workflow" })).toBeNull();
    expect((await row(slot, 2)).getByText("показывает этапы 1–1")).toBeTruthy();
  });

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

describe("охват встроенных этапов", () => {
  it("Выбор этапов охватывает этапы до следующего Выбора, Демонстрация — с прошлой Демонстрации", async () => {
    const mixed: FlowSettings = {
      version: 2,
      flows: [{ id: "default", name: "Default", stages: [builtinStage("questions", []), builtinStage("select", []), { id: "task", kind: "skill", skill: "task-flow", name: "Задача", executors: [] }, { id: "plan", kind: "skill", skill: "plan", name: "План", executors: [] }, builtinStage("demo", [])] }],
      minButtonWidth: 170,
    };
    const slot = renderSlot<PluginNavPanelProps, typeof flowSettingsRpcContract>(app.navPanels.find((p) => p.id === "flows")!, { subPath: "" }, {
      rpc: { getFlowSettings: () => mixed, saveFlowSettings: (input: unknown) => input, getStageCatalog: () => catalog, getRootSkill: () => null } as never,
      settings: { language: "Русский" },
    });
    expect((await row(slot, 2)).getByText("выбирает этапы 3–5")).toBeTruthy();
    expect((await row(slot, 5)).getByText("показывает этапы 1–4")).toBeTruthy();
  });
});

describe("корневой навык на странице Flow", () => {
  it("ссылка открывает файл корневого навыка превью bb на его хосте", async () => {
    const slot = open(() => ({ hostId: "host_local", path: "/home/owner/.claude/skills/flow/SKILL.md" }));
    fireEvent.click(await slot.findByRole("button", { name: "Корневой навык flow" }));
    expect(slot.navigateCalls.at(-1)).toMatchObject({ method: "experimental_openFilePreview", options: { target: { kind: "host", hostId: "host_local", path: "/home/owner/.claude/skills/flow/SKILL.md" } } });
  });

  it("нет корневого навыка — подпись, где его ждут, без ссылки", async () => {
    const slot = open();
    expect(await slot.findByText("Корневой навык flow не найден в ~/.claude/skills")).toBeTruthy();
    expect(slot.queryByRole("button", { name: "Корневой навык flow" })).toBeNull();
  });
});

describe("иконки файла навыка в поле навыка", () => {
  const openWith = (skillFile: (input: { name: string }) => RootSkill) =>
    renderSlot<PluginNavPanelProps, typeof flowSettingsRpcContract>(app.navPanels.find((p) => p.id === "flows")!, { subPath: "" }, {
      rpc: {
        getFlowSettings: () => settings,
        saveFlowSettings: (input: unknown) => input,
        getStageCatalog: () => catalog,
        getRootSkill: () => null,
        getSkillFile: skillFile,
        revealSkill: ({ name }: { name: string }) => ({ revealed: name === "flow-questions", error: name === "flow-questions" ? null : "skill file not found" }),
      } as never,
      settings: { language: "Русский" },
    });

  it("в поле навыка нет шеврона, есть две кнопки файла навыка", async () => {
    const slot = openWith(() => null);
    const questions = await row(slot, 1);
    expect(questions.getByRole("button", { name: "Открыть навык flow-questions" })).toBeTruthy();
    expect(questions.getByRole("button", { name: "Показать навык flow-questions в файловой системе" })).toBeTruthy();
    expect(slot.container.querySelector('[data-icon="ChevronDown"]')).toBeNull();
  });

  it("первая кнопка открывает файл навыка просмотрщиком bb на его хосте", async () => {
    const slot = openWith(({ name }) => ({ hostId: "host_local", path: `/home/owner/.claude/skills/${name}/SKILL.md` }));
    fireEvent.click((await row(slot, 2)).getByRole("button", { name: "Открыть навык my-demo" }));
    await vi.waitFor(() =>
      expect(slot.navigateCalls.at(-1)).toMatchObject({ method: "experimental_openFilePreview", options: { target: { kind: "host", hostId: "host_local", path: "/home/owner/.claude/skills/my-demo/SKILL.md" } } }),
    );
  });

  it("вторая кнопка просит сервер показать файл навыка в файловой системе", async () => {
    const slot = openWith(() => null);
    fireEvent.click((await row(slot, 1)).getByRole("button", { name: "Показать навык flow-questions в файловой системе" }));
    await vi.waitFor(() => expect(slot.rpcCalls.find((c) => c.method === "revealSkill")?.input).toEqual({ name: "flow-questions" }));
  });

  it("файл навыка не найден — подпись у поля, превью не открывается", async () => {
    const slot = openWith(() => null);
    fireEvent.click((await row(slot, 2)).getByRole("button", { name: "Открыть навык my-demo" }));
    expect(await (await row(slot, 2)).findByText("Файл навыка не найден")).toBeTruthy();
    expect(slot.navigateCalls.some((c) => c.method === "experimental_openFilePreview")).toBe(false);
  });
});
