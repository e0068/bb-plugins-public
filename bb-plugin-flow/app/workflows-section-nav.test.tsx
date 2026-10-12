// @vitest-environment jsdom
// Страница Flow переходит между flow и разделом Workflows, не пересоздаваясь: переход в обе стороны не роняет страницу.
import { cleanup } from "@testing-library/react";
import type { PluginNavPanelProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, describe, expect, it, vi } from "vitest";

import { builtinStage } from "../lib/stage-constants";
import type { FlowSettings } from "../shared/contract";

const app = await loadPluginApp(() => import("../app"));

afterEach(cleanup);
vi.setConfig({ testTimeout: 20000 });

const settings: FlowSettings = { version: 2, flows: [{ id: "default", name: "Default", stages: [builtinStage("questions", [])] }, { id: "quick", name: "Quick", stages: [] }], minButtonWidth: 170 };

describe("переход между flow и разделом Workflows", () => {
  it("flow → Workflows → другой flow", async () => {
    const panel = app.navPanels.find((p) => p.id === "flows")!;
    const slot = renderSlot<PluginNavPanelProps, never>(panel, { subPath: "default" }, {
      rpc: {
        getFlowSettings: () => settings,
        saveFlowSettings: (input: unknown) => input,
        getStageCatalog: () => ({ skills: [], executors: [] }),
        workflowList: () => ({ dir: "/h/.claude/workflows", items: [{ name: "review", path: "/h/.claude/workflows/review.js", description: "", reason: null }] }),
        workflowAgents: () => [],
        workflowProviders: () => [],
      } as never,
    });
    const Page = panel.component;
    expect(await slot.findByRole("textbox", { name: "Название flow" })).toBeTruthy();
    slot.lifecycle.rerender(<Page subPath="workflows" />);
    expect(await slot.findByRole("button", { name: /review/ })).toBeTruthy();
    slot.lifecycle.rerender(<Page subPath="quick" />);
    expect(((await slot.findByRole("textbox", { name: "Название flow" })) as HTMLInputElement).value).toBe("Quick");
  });
});
