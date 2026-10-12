// @vitest-environment jsdom
// Раздел Workflows страницы Flow: список workflow, открытие в конструкторе, правка кода рукописного файла и новый workflow.
import { cleanup, fireEvent } from "@testing-library/react";
import type { PluginNavPanelProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, describe, expect, it, vi } from "vitest";

import { blankAgent, blankPhase, blankTree, compile } from "@bb-plugins/workflow-builder/model";
import { builtinStage } from "../lib/stage-constants";
import type { FlowSettings } from "../shared/contract";

const app = await loadPluginApp(() => import("../app"));

afterEach(cleanup);

const DIR = "/Users/owner/.claude/workflows";
const settings: FlowSettings = { version: 2, flows: [{ id: "default", name: "Default", stages: [builtinStage("questions", [])] }], minButtonWidth: 170 };

const review = (() => {
  const t = blankTree("review");
  t.description = "Reviews";
  t.phases = [{ ...blankPhase("Review"), steps: [{ ...blankAgent(), label: "reviewer", prompt: "Review it", agentType: "reviewer" }] }];
  return compile(t, "claude");
})();
const files: Record<string, string> = { [`${DIR}/review.js`]: review, [`${DIR}/lead-waves.js`]: "const MAX_ROUNDS = 5\n" };

const open = (subPath: string) =>
  renderSlot<PluginNavPanelProps, never>(app.navPanels.find((p) => p.id === "flows")!, { subPath }, {
    rpc: {
      getFlowSettings: () => settings,
      saveFlowSettings: (input: unknown) => input,
      getStageCatalog: () => ({ skills: [], executors: [] }),
      workflowList: () => ({
        dir: DIR,
        items: [
          { name: "lead-waves", path: `${DIR}/lead-waves.js`, description: "", reason: "edited" },
          { name: "review", path: `${DIR}/review.js`, description: "Reviews", reason: null },
        ],
      }),
      workflowRead: ({ path }: { path: string }) => ({ source: files[path] ?? "" }),
      workflowSave: ({ path }: { path: string }) => ({ path }),
      workflowAgents: () => [],
      workflowProviders: () => [],
    } as never,
  });

const saved = (slot: ReturnType<typeof open>) => slot.rpcCalls.find((c) => c.method === "workflowSave")?.input as { path: string; source: string } | undefined;

// Конструктор рисует редактор markdown на каждого агента: под нагрузкой полного прогона ему нужно больше пяти секунд по умолчанию.
vi.setConfig({ testTimeout: 20000 });

describe("раздел Workflows страницы Flow", () => {
  it("список workflow; рукописный помечен «код»", async () => {
    const slot = open("workflows");
    expect(await slot.findByRole("button", { name: /review/ })).toBeTruthy();
    expect(slot.getByRole("button", { name: /lead-waves/ }).textContent).toContain("код");
  });

  it("workflow конструктора открывается деревом и сохраняется в свой файл", async () => {
    const slot = open("workflows/review");
    fireEvent.change(await slot.findByLabelText("outline workflow description"), { target: { value: "Reviews twice" } });
    fireEvent.click(slot.getByRole("button", { name: "Save" }));
    await vi.waitFor(() => expect(saved(slot)?.source).toContain("Reviews twice"), { timeout: 5000 });
    expect(saved(slot)?.path).toBe(`${DIR}/review.js`);
  });

  it("рукописный workflow правится как код и сохраняется как есть", async () => {
    const slot = open("workflows/lead-waves");
    fireEvent.change(await slot.findByLabelText("workflow source"), { target: { value: "const MAX_ROUNDS = 7\n" } });
    fireEvent.click(slot.getByRole("button", { name: "Save" }));
    await vi.waitFor(() => expect(saved(slot)).toEqual({ path: `${DIR}/lead-waves.js`, source: "const MAX_ROUNDS = 7\n" }), { timeout: 5000 });
  });

  it("новый workflow: имя, пустой конструктор, первое сохранение создаёт файл", async () => {
    const slot = open("workflows/+new");
    fireEvent.change(await slot.findByLabelText("Имя нового workflow"), { target: { value: "review" } });
    expect(slot.getByText("Workflow с таким именем уже есть")).toBeTruthy();
    fireEvent.change(slot.getByLabelText("Имя нового workflow"), { target: { value: "ship-it" } });
    fireEvent.click(slot.getByRole("button", { name: "Создать" }));
    expect(((await slot.findByLabelText("outline workflow name")) as HTMLInputElement).value).toBe("ship-it");
  });
});
