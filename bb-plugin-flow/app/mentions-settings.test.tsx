// @vitest-environment jsdom
// Страница настроек живёт вне треда: `/` в описании flow берёт навыки каталога Flow, тред у запроса не указан.
import { cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import type { PluginNavPanelProps, PluginSettingsSectionProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, describe, expect, it } from "vitest";

import type { FlowSettings } from "../shared/contract";

const app = await loadPluginApp(() => import("../app"));

afterEach(cleanup);

const settings: FlowSettings = { version: 2, flows: [{ id: "default", name: "Default", stages: [] }], minButtonWidth: 170 };

type Asked = { threadId?: string; trigger: "/" | "@"; query: string };

const open = (asked: Asked[]) =>
  renderSlot<PluginNavPanelProps, never>(app.navPanels.find((p) => p.id === "flows")!, { subPath: "" }, {
    rpc: {
      getFlowSettings: () => settings,
      saveFlowSettings: (input: unknown) => input,
      getStageCatalog: () => ({ skills: [], executors: [] }),
      mentions: (input: Asked) => {
        asked.push(input);
        return { kind: "found", items: [{ kind: "skill", name: "plan", insert: "plan" }] };
      },
    } as never,
    settings: { language: "Русский" },
  });

describe("`/` на странице настроек", () => {
  it("в описании flow открывает навыки каталога, выбор встаёт в текст и сохраняется уходом из поля", async () => {
    const asked: Asked[] = [];
    const slot = open(asked);
    const field = (await slot.findByRole("textbox", { name: "Когда выбирать этот flow" })) as HTMLTextAreaElement;
    field.focus();
    fireEvent.change(field, { target: { value: "задачи с /pl" } });
    field.setSelectionRange(12, 12);
    fireEvent.keyUp(field);
    const list = await slot.findByRole("listbox", { name: "Навыки и команды" });
    expect(asked.at(-1)).toEqual({ trigger: "/", query: "" });
    fireEvent.click(within(list).getByRole("option"));
    await waitFor(() => expect(field.value).toBe("задачи с /plan "));
    fireEvent.blur(field);
    await waitFor(() => expect(slot.rpcCalls.some((c) => c.method === "saveFlowSettings" && (c.input as FlowSettings).flows[0]?.description === "задачи с /plan")).toBe(true));
  });
});

describe("`/` в инструкции пробуждения агента", () => {
  it("открывает навыки каталога в секции настроек автоповтора", async () => {
    const asked: Asked[] = [];
    const slot = renderSlot<PluginSettingsSectionProps, never>(app.settingsSections.find((s) => s.id === "automation-retry")!, {}, {
      rpc: {
        getFlowSettings: () => ({ ...settings, wakeAgentAfterLastRetry: true }),
        saveFlowSettings: (input: unknown) => input,
        getStageCatalog: () => ({ skills: [], executors: [] }),
        mentions: (input: Asked) => {
          asked.push(input);
          return { kind: "found", items: [{ kind: "skill", name: "plan", insert: "plan" }] };
        },
      } as never,
      settings: { language: "Русский" },
    });
    const field = (await slot.findByRole("textbox", { name: "Наказ агенту" })) as HTMLTextAreaElement;
    field.focus();
    fireEvent.change(field, { target: { value: "/p" } });
    field.setSelectionRange(2, 2);
    fireEvent.keyUp(field);
    const list = await slot.findByRole("listbox", { name: "Навыки и команды" });
    expect(within(list).getByRole("option").textContent).toBe("/plan");
    expect(asked.at(-1)).toEqual({ trigger: "/", query: "" });
  });
});
