// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import type { PluginNavPanelProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, describe, expect, it } from "vitest";

import { builtinAutomationStage } from "../core/automation-run";
import { automationStage, builtinStage } from "../lib/stage-constants";
import type { FlowSettings, flowSettingsRpcContract, StageCatalog } from "../shared/contract";
import { BUILTIN_AUTOMATION_ICON, EXTERNAL_AUTOMATION_ICON, KIND_ICONS, SKILL_ICON } from "./stage-icons";

const app = await loadPluginApp(() => import("../app"));

afterEach(cleanup);

const settings: FlowSettings = {
  flows: [
    {
      id: "default",
      name: "Default",
      stages: [
        builtinStage("questions", []),
        { id: "task", kind: "skill", skill: "task-flow", name: "Задача", executors: [] },
        builtinAutomationStage(["questions", "task"]),
        automationStage({ id: "click-merge", name: "Merge" }),
      ],
    },
  ],
  minButtonWidth: 170,
};
const catalog: StageCatalog = { skills: [], executors: [] };

const open = () =>
  renderSlot<PluginNavPanelProps, typeof flowSettingsRpcContract>(app.navPanels.find((p) => p.id === "flows")!, { subPath: "" }, {
    rpc: { getFlowSettings: () => settings, saveFlowSettings: (input: unknown) => input, getStageCatalog: () => catalog, getRootSkill: () => null } as never,
    settings: { language: "Русский" },
  });

describe("иконка этапа на странице Flow", () => {
  it.each([
    [1, KIND_ICONS.questions],
    [2, SKILL_ICON],
    [3, BUILTIN_AUTOMATION_ICON],
    [4, EXTERNAL_AUTOMATION_ICON],
  ])("в строке %i стоит сразу после номера, перед полями, и больше нигде в строке", async (n, icon) => {
    const slot = open();
    const row = await slot.findByRole("row", { name: `Этап ${n}` });
    const cells = [...row.querySelectorAll('[role="cell"]')];
    expect(cells[0]!.textContent).toContain(String(n));
    expect(cells[0]!.querySelector(`[data-icon="${icon}"]`)).not.toBeNull();
    expect(cells[0]!.querySelector("input")).toBeNull();
    expect(row.querySelectorAll(`[data-icon="${icon}"]`)).toHaveLength(1);
  });
});
