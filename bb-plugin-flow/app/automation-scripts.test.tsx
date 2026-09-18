// @vitest-environment jsdom
import { cleanup, fireEvent, within } from "@testing-library/react";
import type { PluginNavPanelProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, describe, expect, it, vi } from "vitest";

import { builtinStage } from "../lib/stage-constants";
import type { FlowSettings, flowSettingsRpcContract, StageCatalog, WorkStage } from "../shared/contract";

const app = await loadPluginApp(() => import("../app"));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

type Builtin = Extract<NonNullable<WorkStage["automation"]>, { source: "flow" }>;

const settings = (automation: Builtin): FlowSettings => ({
  flows: [{ id: "default", name: "Default", stages: [builtinStage("questions", []), { id: "flow-automation", kind: "skill", skill: "", name: "Опубликовать", executors: [], automation }] }],
  minButtonWidth: 170,
});
const catalog: StageCatalog = { skills: [], executors: [] };

const open = (initial: FlowSettings) => {
  vi.stubGlobal("fetch", async () => new Response("{}", { status: 404 }));
  return renderSlot<PluginNavPanelProps, typeof flowSettingsRpcContract>(app.navPanels.find((p) => p.id === "flows")!, { subPath: "" }, {
    rpc: { getFlowSettings: () => initial, saveFlowSettings: (input: unknown) => input, getStageCatalog: () => catalog } as never,
    settings: { language: "Русский" },
  });
};
type Slot = ReturnType<typeof open>;
const lastAutomation = (slot: Slot) => ([...slot.rpcCalls].reverse().find((c) => c.method === "saveFlowSettings")?.input as FlowSettings | undefined)?.flows[0]?.stages.at(-1)?.automation;

const pickFile = (slot: Slot, file: File) => {
  const input = slot.container.ownerDocument.querySelector<HTMLInputElement>('input[type="file"]');
  if (input === null) throw new Error("no file input");
  fireEvent.change(input, { target: { files: [file] } });
};

describe("«Добавить скрипт» в меню шагов", () => {
  it("меню шагов предлагает Commit и «Добавить скрипт…»", async () => {
    const slot = open(settings({ source: "flow", steps: [] }));
    const row = within(await slot.findByRole("row", { name: "Этап 2" }));
    fireEvent.click(row.getByRole("button", { name: "Добавить шаг" }));
    const menu = within(await slot.findByRole("menu", { name: "Шаги автоматизации" }));
    expect(menu.getByRole("menuitem", { name: "Commit" })).toBeTruthy();
    expect(menu.getByRole("menuitem", { name: "Добавить скрипт…" })).toBeTruthy();
  });

  it("выбранный файл сохраняется шагом с новым уникальным id, именем файла и содержимым", async () => {
    vi.spyOn(crypto, "randomUUID").mockReturnValue("7f0c3a2e-0000-4000-8000-000000000001");
    const slot = open(settings({ source: "flow", steps: ["git.commit"], scripts: [] }));
    const row = within(await slot.findByRole("row", { name: "Этап 2" }));
    fireEvent.click(row.getByRole("button", { name: "Добавить шаг" }));
    fireEvent.click(within(await slot.findByRole("menu", { name: "Шаги автоматизации" })).getByRole("menuitem", { name: "Добавить скрипт…" }));
    pickFile(slot, new File(["#!/bin/sh\necho deployed"], "deploy.sh", { type: "text/x-sh" }));
    const id = "7f0c3a2e-0000-4000-8000-000000000001";
    await vi.waitFor(() =>
      expect(lastAutomation(slot)).toEqual({ source: "flow", steps: ["git.commit", `script:${id}`], scripts: [{ id, name: "deploy.sh", content: "#!/bin/sh\necho deployed" }] }),
    );
  });

  it("шаг-скрипт виден тегом с именем файла и убирается крестом вместе со скриптом", async () => {
    const slot = open(settings({ source: "flow", steps: ["script:1", "git.commit"], scripts: [{ id: "1", name: "notify.py", content: "print(1)" }] }));
    const row = within(await slot.findByRole("row", { name: "Этап 2" }));
    expect(row.getAllByRole("listitem").map((t) => t.textContent)).toEqual(["notify.py", "Commit"]);
    fireEvent.click(row.getByRole("button", { name: "Убрать шаг notify.py" }));
    await vi.waitFor(() => expect(lastAutomation(slot)).toEqual({ source: "flow", steps: ["git.commit"], scripts: [] }));
  });

  it("слишком большой файл не добавляется, в меню — причина", async () => {
    const slot = open(settings({ source: "flow", steps: [] }));
    const row = within(await slot.findByRole("row", { name: "Этап 2" }));
    fireEvent.click(row.getByRole("button", { name: "Добавить шаг" }));
    fireEvent.click(within(await slot.findByRole("menu", { name: "Шаги автоматизации" })).getByRole("menuitem", { name: "Добавить скрипт…" }));
    pickFile(slot, new File(["x".repeat(200_001)], "big.sh"));
    expect(await slot.findByText("Скрипт больше 200 000 символов — не добавлен")).toBeTruthy();
    expect(slot.rpcCalls.some((c) => c.method === "saveFlowSettings")).toBe(false);
  });
});

describe("«Добавить скрипт» — огромный файл", () => {
  it("файл, заведомо больше предела по размеру, отклоняется без чтения содержимого", async () => {
    const slot = open(settings({ source: "flow", steps: [] }));
    const row = within(await slot.findByRole("row", { name: "Этап 2" }));
    fireEvent.click(row.getByRole("button", { name: "Добавить шаг" }));
    fireEvent.click(within(await slot.findByRole("menu", { name: "Шаги автоматизации" })).getByRole("menuitem", { name: "Добавить скрипт…" }));
    const huge = new File(["x"], "huge.bin");
    Object.defineProperty(huge, "size", { value: 5_000_000_000 });
    const text = vi.spyOn(huge, "text");
    pickFile(slot, huge);
    expect(await slot.findByText("Скрипт больше 200 000 символов — не добавлен")).toBeTruthy();
    expect(text).not.toHaveBeenCalled();
  });
});
