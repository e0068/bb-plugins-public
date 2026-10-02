// @vitest-environment jsdom
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import type { PluginNavPanelProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { FlowSettings, flowSettingsRpcContract, StageCatalog, WorkStage } from "../shared/contract";

const app = await loadPluginApp(() => import("../app"));

// Строки высотой 40 с зазором в 1 пиксель между ними, как gap-px таблицы.
const ROW = 40;
const STEP = ROW + 1;

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const at = [...document.querySelectorAll("[data-stage-row]")].indexOf(this);
    const top = Math.max(0, at) * STEP;
    return { top, bottom: top + ROW, height: ROW, left: 0, right: 800, width: 800, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const stage = (id: string): WorkStage => ({ id, kind: "skill", skill: id, name: id, executors: [] });
const catalog: StageCatalog = { skills: [], executors: [] };

const open = (stages: WorkStage[]) => {
  const settings: FlowSettings = { flows: [{ id: "plugin", name: "BB Plugin", stages }], minButtonWidth: 170 };
  return renderSlot<PluginNavPanelProps, typeof flowSettingsRpcContract>(app.navPanels.find((p) => p.id === "flows")!, { subPath: "" }, {
    rpc: { getFlowSettings: () => settings, saveFlowSettings: (input: unknown) => input, getStageCatalog: () => catalog, getRootSkill: () => null } as never,
    settings: { language: "Русский" },
  });
};

describe("зазор между строками при перетаскивании", () => {
  it("указатель в зазоре — верхняя четверть следующей строки, а не последняя строка", async () => {
    const slot = open([stage("a"), stage("b"), stage("c"), stage("d")]);
    fireEvent.pointerDown(await slot.findByRole("button", { name: "Перетащить этап d" }));
    window.dispatchEvent(new MouseEvent("pointermove", { clientY: STEP - 0.5 }));
    await waitFor(() => expect(slot.getByRole("row", { name: "Этап 2" }).dataset.drop).toBe("top"));
    window.dispatchEvent(new MouseEvent("pointerup"));
    await waitFor(() => {
      const saved = slot.rpcCalls.filter((c) => c.method === "saveFlowSettings").at(-1)?.input as FlowSettings | undefined;
      expect(saved?.flows[0]?.stages.map((s) => s.id)).toEqual(["a", "d", "b", "c"]);
    });
  });
});
