// @vitest-environment jsdom
//
// A project wears its Tasks+ board's icon wherever the section names it — the
// pill of its group and the caption under a thread — and wears the new one as
// soon as Tasks+ says a board changed. A project without a board, or a bb
// without Tasks+, keeps the bare name.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { announceProjectsChanged } from "@bb-plugins/task-bridge";
import { MemoryStorage } from "./memory-storage.testkit";

const thread = (id: string, title: string, projectId: string) =>
  ({
    id,
    projectId,
    title,
    titleFallback: null,
    parentThreadId: null,
    sectionId: null,
    originKind: null,
    originPluginId: null,
    providerId: "claude",
    hasPendingInteraction: false,
    activity: { workflows: 0, backgroundAgents: 0, backgroundCommands: 0, planMode: 0, goals: 0 },
    indicator: "none",
    indicatorLabel: null,
    isUnread: false,
    isPinned: false,
    isArchived: false,
    environment: null,
    host: null,
    createdAt: 0,
    updatedAt: 0,
    lastReadAt: null,
    latestAttentionAt: 1000,
  }) as PluginSidebarThread;

const SIDEBAR = {
  status: "ready" as const,
  threads: [thread("th_a", "Тред Альфы", "p_alpha"), thread("th_b", "Тред Беты", "p_beta")],
  projects: [
    { id: "p_alpha", name: "Альфа", isPersonal: false },
    { id: "p_beta", name: "Бета", isPersonal: false },
  ],
};

const ROCKET = { bbProjectId: "p_alpha", drawing: { kind: "emoji", char: "🚀" } };
const FIRE = { bbProjectId: "p_alpha", drawing: { kind: "emoji", char: "🔥" } };

async function renderSection(projectIcons: () => unknown) {
  const app = await loadPluginApp(() => import("./app"));
  return renderSlot(app.homepageSections[0]!, { projectId: null }, {
    sidebarThreads: SIDEBAR,
    rpc: { listPostponed: () => ({ postponed: [] }), projectIcons },
  });
}

/** The icon a project wears inside an element, or null for none. */
const iconIn = (element: HTMLElement, projectId: string) => element.querySelector(`[data-project-icon="${projectId}"]`);

beforeEach(() => {
  vi.stubGlobal("localStorage", new MemoryStorage());
  // jsdom ships no scrollIntoView, and the grouped track calls it.
  Object.defineProperty(Element.prototype, "scrollIntoView", { configurable: true, writable: true, value: vi.fn() });
});

afterEach(cleanup);
afterEach(() => {
  vi.unstubAllGlobals();
  delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
});

describe("a project's icon in the section", () => {
  it("stands before the project's name under a thread, and not for a project without a board", async () => {
    const slot = await renderSection(() => ({ icons: [ROCKET] }));
    const caption = (await slot.findByText("Альфа")).closest("span")!;
    await vi.waitFor(() => expect(iconIn(caption, "p_alpha")?.textContent).toBe("🚀"));
    expect(iconIn(slot.getByText("Бета").closest("span")!, "p_beta")).toBeNull();
  });

  it("stands before the project's name in its group's pill", async () => {
    const slot = await renderSection(() => ({ icons: [ROCKET] }));
    fireEvent.click(await slot.findByRole("button", { name: /По проекту/ }));
    const alpha = slot.getByRole("button", { name: /Альфа/ });
    await vi.waitFor(() => expect(iconIn(alpha, "p_alpha")?.textContent).toBe("🚀"));
    expect(iconIn(slot.getByRole("button", { name: /Бета/ }), "p_beta")).toBeNull();
  });

  it("changes as soon as Tasks+ says a board changed", async () => {
    let icons = [ROCKET];
    const slot = await renderSection(() => ({ icons }));
    const caption = (await slot.findByText("Альфа")).closest("span")!;
    await vi.waitFor(() => expect(iconIn(caption, "p_alpha")?.textContent).toBe("🚀"));

    icons = [FIRE];
    act(() => announceProjectsChanged(window));
    await vi.waitFor(() => expect(iconIn(caption, "p_alpha")?.textContent).toBe("🔥"));
  });

  it("draws a sign of several parts without React mixing them up", async () => {
    // Tasks+ glyphs carry a `key` of their own, the same in every node.
    const errors = vi.spyOn(console, "error");
    const glyph = (...ds: string[]) => ({
      bbProjectId: "p_alpha",
      drawing: { kind: "glyph", nodes: ds.map((d) => ["path", { d, key: "0" }]), ink: { color: "steelblue" } },
    });
    let icons = [glyph("M1 1")];
    const slot = await renderSection(() => ({ icons }));
    const caption = (await slot.findByText("Альфа")).closest("span")!;
    await vi.waitFor(() => expect(iconIn(caption, "p_alpha")).not.toBeNull());

    icons = [glyph("M2 2", "M3 3")];
    act(() => announceProjectsChanged(window));
    await vi.waitFor(() =>
      expect([...iconIn(caption, "p_alpha")!.querySelectorAll("path")].map((path) => path.getAttribute("d"))).toEqual(["M2 2", "M3 3"]),
    );
    expect(errors.mock.calls.flat().join(" ")).not.toMatch(/same key/);
    errors.mockRestore();
  });

  it("is not there at all when Tasks+ is not", async () => {
    const projectIcons = vi.fn(() => ({ icons: null }));
    const slot = await renderSection(projectIcons);
    await slot.findByText("Тред Альфы");
    await vi.waitFor(() => expect(projectIcons).toHaveBeenCalled());
    await act(async () => {});
    expect(slot.container.querySelector("[data-project-icon]")).toBeNull();
  });

  it("stays when Tasks+ stops answering for a while", async () => {
    let answer: unknown = { icons: [ROCKET] };
    const slot = await renderSection(() => answer);
    const caption = (await slot.findByText("Альфа")).closest("span")!;
    await vi.waitFor(() => expect(iconIn(caption, "p_alpha")?.textContent).toBe("🚀"));

    answer = { icons: null };
    act(() => announceProjectsChanged(window));
    await act(async () => {});
    expect(iconIn(caption, "p_alpha")?.textContent).toBe("🚀");
  });
});
