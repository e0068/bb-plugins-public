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
      workflowAgents: () => [{ value: "reviewer", model: "opus", effort: "", provider: "claude-code", scope: "user", path: "/Users/owner/.claude/agents/reviewer.md" }],
      workflowProviders: () => [],
      agentDocRead: ({ path }: { path: string }) => ({ path, content: "# Reviewer agent", sha256: "a1", error: null }),
      agentDocWrite: () => ({ outcome: "written", sha256: "a2" }),
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

  it("настройки выбранного узла встают справа от дерева, а не вместо него", async () => {
    // Вкладка уже 720 px — прежде здесь дерево уступало место настройкам с кнопкой «← Workflow».
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(private readonly report: ResizeObserverCallback) {}
        observe(target: Element) {
          this.report([{ target, contentRect: { width: 400 } } as unknown as ResizeObserverEntry], this as unknown as ResizeObserver);
        }
        unobserve() {}
        disconnect() {}
      },
    );
    const slot = open("/Users/owner/.claude/workflows/review.js", built);
    fireEvent.click((await slot.findByRole("button", { name: "Review" })).closest('[role="button"]')!);
    expect(await slot.findByText("Repeat", { selector: "span, label, div" })).toBeTruthy();
    expect(slot.getByLabelText("outline workflow name")).toBeTruthy();
    expect(slot.queryByRole("button", { name: /^Back to/ })).toBeNull();
  });

  it("выбранный агент: справа сверху его файл, как в Claude Config, под ним настройки шага", async () => {
    const slot = open("/Users/owner/.claude/workflows/review.js", built);
    fireEvent.click((await slot.findByText("reviewer", { selector: "span" })).closest('[role="button"]')!);
    expect(await slot.findByText("/Users/owner/.claude/agents/reviewer.md", {}, { timeout: 5000 })).toBeTruthy();
    expect(slot.rpcCalls.find((c) => c.method === "agentDocRead")?.input).toEqual({ path: "/Users/owner/.claude/agents/reviewer.md" });
    expect(slot.getByLabelText("agent detail model")).toBeTruthy();
    expect(slot.getByLabelText("outline workflow name")).toBeTruthy();
  });

  it("другой .js и файл не с хоста — встроенное превью bb", async () => {
    expect(await open("/work/repo/src/app.js", "").findByText("bb preview")).toBeTruthy();
    cleanup();
    expect(await open(".claude/workflows/review.js", built, "workspace").findByText("bb preview")).toBeTruthy();
  });
});
