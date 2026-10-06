// @vitest-environment jsdom
// Поле наказа агенту под переключателем «Реплика агенту после последней попытки».
import { cleanup, fireEvent } from "@testing-library/react";
import type { PluginSettingsSectionProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_FAILURE_INSTRUCTION } from "../core/automation-run";
import { MAX_WAKE_INSTRUCTION_CHARS } from "../lib/stage-constants";
import type { FlowSettings, flowSettingsRpcContract } from "../shared/contract";

const app = await loadPluginApp(() => import("../app"));

afterEach(cleanup);

const settings: FlowSettings = { version: 2, flows: [{ id: "default", name: "Default", stages: [] }], minButtonWidth: 170 };

const open = (initial: FlowSettings = settings) =>
  renderSlot<PluginSettingsSectionProps, typeof flowSettingsRpcContract>(app.settingsSections.find((s) => s.id === "automation-retry")!, {}, {
    rpc: { getFlowSettings: () => initial, saveFlowSettings: (input: unknown) => input, getStageCatalog: () => ({ skills: [], executors: [] }), getRootSkill: () => null } as never,
    settings: { language: "Русский" },
  });

const lastSaved = (slot: ReturnType<typeof open>): FlowSettings | undefined => [...slot.rpcCalls].reverse().find((c) => c.method === "saveFlowSettings")?.input as FlowSettings | undefined;

const NAME = "Наказ агенту";

const field = async (slot: ReturnType<typeof open>) => (await slot.findByRole("textbox", { name: NAME })) as HTMLTextAreaElement;

describe("наказ агенту после последней попытки", () => {
  it("поле стоит под переключателем реплики", async () => {
    const slot = open();
    const toggle = await slot.findByRole("switch", { name: "Реплика агенту после последней попытки" });
    expect(toggle.compareDocumentPosition(await field(slot)) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("своего наказа нет — поле пустое, наказ по умолчанию виден подсказкой", async () => {
    const input = await field(open());
    expect(input.value).toBe("");
    expect(input.placeholder).toBe(DEFAULT_FAILURE_INSTRUCTION);
  });

  it("длина наказа ограничена пределом, который принимает схема настроек", async () => {
    expect((await field(open())).maxLength).toBe(MAX_WAKE_INSTRUCTION_CHARS);
  });

  it("сохранённый наказ виден в поле", async () => {
    expect((await field(open({ ...settings, wakeAgentInstruction: "Почини сам." }))).value).toBe("Почини сам.");
  });

  it("набранный наказ сохраняется при уходе из поля", async () => {
    const slot = open();
    const input = await field(slot);
    fireEvent.change(input, { target: { value: "Пойми, в чём проблема, и сообщи мне." } });
    fireEvent.blur(input);
    await vi.waitFor(() => expect(lastSaved(slot)?.wakeAgentInstruction).toBe("Пойми, в чём проблема, и сообщи мне."));
  });

  it("стёртое поле убирает свой наказ из настроек — реплика снова с наказом по умолчанию", async () => {
    const slot = open({ ...settings, wakeAgentInstruction: "Почини сам." });
    const input = await field(slot);
    fireEvent.change(input, { target: { value: "  " } });
    fireEvent.blur(input);
    await vi.waitFor(() => expect(lastSaved(slot)).toBeDefined());
    expect(lastSaved(slot)).not.toHaveProperty("wakeAgentInstruction");
  });

  it("реплика выключена — поле недоступно", async () => {
    expect((await field(open({ ...settings, wakeAgentAfterLastRetry: false }))).disabled).toBe(true);
  });
});
