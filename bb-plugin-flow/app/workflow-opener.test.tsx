// @vitest-environment jsdom
// Правая панель: .js из папки workflow — конструктор workflow, любой другой .js — встроенное превью bb.
import { cleanup, fireEvent } from "@testing-library/react";
import type { PluginFileOpenerProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, describe, expect, it, vi } from "vitest";

import { blankAgent, blankPhase, blankTree, compile } from "@bb-plugins/workflow-builder/model";
import type { workflowFilesRpcContract } from "../shared/contract";

const app = await loadPluginApp(() => import("../app"));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const opener = () => app.fileOpeners.find((o) => o.id === "workflow")!;
const Original = () => <div>bb preview</div>;
const host = { kind: "host" as const, threadId: null, environmentId: null, projectId: null };

const built = (() => {
  const t = blankTree("review");
  t.description = "Reviews";
  t.phases = [{ ...blankPhase("Review"), steps: [{ ...blankAgent(), label: "reviewer", prompt: "Review it", agentType: "reviewer" }] }];
  return compile(t, "claude");
})();

const open = (path: string, source: string, kind: "host" | "workspace" = "host") =>
  renderSlot<PluginFileOpenerProps, typeof workflowFilesRpcContract>(opener(), { path, source: { ...host, kind }, Original }, {
    rpc: {
      workflowRead: () => ({ source }),
      workflowSave: (input: { path: string }) => ({ path: input.path }),
      workflowAgents: () => [{ value: "reviewer", model: "opus", effort: "", provider: "claude-code", scope: "user" }],
      workflowProviders: () => [],
    } as never,
  });

describe("открыватель .js", () => {
  it("регистрируется для расширения js", () => {
    expect(opener().extensions).toEqual(["js"]);
  });

  it("workflow, собранный конструктором, — дерево, правка и сохранение тем же файлом", async () => {
    const slot = open("/Users/owner/.claude/workflows/review.js", built);
    const name = (await slot.findByLabelText("outline workflow name")) as HTMLInputElement;
    expect(name.value).toBe("review");
    fireEvent.change(slot.getByLabelText("outline workflow description"), { target: { value: "Reviews twice" } });
    await vi.waitFor(() => expect((slot.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(false), { timeout: 5000 });
    fireEvent.click(slot.getByRole("button", { name: "Save" }));
    await vi.waitFor(() => expect(slot.rpcCalls.find((c) => c.method === "workflowSave")).toBeTruthy(), { timeout: 5000 });
    const saved = slot.rpcCalls.find((c) => c.method === "workflowSave")!.input as { path: string; source: string };
    expect(saved.path).toBe("/Users/owner/.claude/workflows/review.js");
    expect(saved.source).toContain("Reviews twice");
  });

  it("рукописный workflow — код с причиной, без кнопки сохранения", async () => {
    const slot = open("/Users/owner/.claude/workflows/epic.js", 'export const meta = { name: "epic" }\n');
    expect(await slot.findByText(/No builder mark — written by hand/)).toBeTruthy();
    expect(slot.queryByRole("button", { name: "Save" })).toBeNull();
  });

  it("другой .js и файл не с хоста — встроенное превью bb", async () => {
    expect(await open("/work/repo/src/app.js", "").findByText("bb preview")).toBeTruthy();
    cleanup();
    expect(await open(".claude/workflows/review.js", built, "workspace").findByText("bb preview")).toBeTruthy();
  });
});
