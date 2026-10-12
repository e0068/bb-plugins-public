// @vitest-environment jsdom
// Настройки плагина приходят после первого показа панели и меняются, пока она открыта: панель переживает это —
// сперва треды bb, потом список flow, и обратно.
import { cleanup } from "@testing-library/react";
import type { PluginThreadListProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, describe, expect, it, vi } from "vitest";

import { builtinStage } from "../lib/stage-constants";
import { flowRoute } from "../lib/panel-path";
import type { FlowSettings } from "../shared/contract";

let values: Record<string, string | number | boolean> | undefined;

vi.mock("@get-bb/plugin-sdk/app", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@get-bb/plugin-sdk/app")>()),
  useSettings: () => ({ values, isLoading: values === undefined }),
}));

const app = await loadPluginApp(() => import("../app"));

afterEach(() => {
  cleanup();
  values = undefined;
});

const settings: FlowSettings = { version: 2, minButtonWidth: 170, flows: [{ id: "default", name: "Default", stages: [builtinStage("criteria", [])] }] };
const Original = () => <div data-testid="bb-threads">треды bb</div>;
const props: PluginThreadListProps = { activeThreadId: null, activeProjectId: null, isCompactViewport: false, onNavigate: vi.fn(), searchQuery: "", Original };
const Panel = app.threadLists[0]!.component;

const open = () => {
  window.history.pushState({}, "", flowRoute("default"));
  return renderSlot<PluginThreadListProps, never>({ component: Panel }, props, {
    rpc: { getFlowSettings: () => settings, saveFlowSettings: (input: unknown) => input, getStageCatalog: () => ({ skills: [], executors: [] }) } as never,
  });
};

describe("список в панели тредов и настройки, пришедшие позже", () => {
  it("пока настройки грузятся, панель показывает треды, а пришла включённая — список flow", async () => {
    const slot = open();
    expect(await slot.findByTestId("bb-threads")).toBeTruthy();
    values = { language: "Русский", showFlowsInThreadsPanel: true };
    slot.lifecycle.rerender(<Panel {...props} />);
    expect(await slot.findByRole("navigation", { name: "Flow" })).toBeTruthy();
    expect(slot.queryByTestId("bb-threads")).toBeNull();
  });

  it("настройку выключили при открытой панели — вернулись треды", async () => {
    values = { language: "Русский", showFlowsInThreadsPanel: true };
    const slot = open();
    expect(await slot.findByRole("navigation", { name: "Flow" })).toBeTruthy();
    values = { language: "Русский", showFlowsInThreadsPanel: false };
    slot.lifecycle.rerender(<Panel {...props} />);
    expect(await slot.findByTestId("bb-threads")).toBeTruthy();
  });
});
