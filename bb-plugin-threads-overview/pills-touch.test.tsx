// @vitest-environment jsdom
//
// The project pills on a phone: one line that scrolls sideways, never a stack
// of wrapped lines eating the height the list needs.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";

function thread(id: string, projectId: string): PluginSidebarThread {
  return {
    id,
    projectId,
    title: id,
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
  };
}

const scrollIntoView = vi.fn();

beforeEach(() => {
  vi.stubGlobal(
    "matchMedia",
    (query: string) =>
      ({
        matches: query.includes("pointer: coarse"),
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }) as unknown as MediaQueryList,
  );
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  });
  Object.defineProperty(Element.prototype, "scrollIntoView", {
    configurable: true,
    writable: true,
    value: scrollIntoView,
  });
});
afterEach(cleanup);
afterEach(() => {
  scrollIntoView.mockReset();
  delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  vi.unstubAllGlobals();
});

async function renderGrouped() {
  const app = await loadPluginApp(() => import("./app"));
  const slot = renderSlot(app.homepageSections[0]!, { projectId: null }, {
    sidebarThreads: {
      status: "ready",
      threads: [thread("th_a", "p_alpha"), thread("th_b", "p_beta"), thread("th_c", "p_gamma")],
      projects: [
        { id: "p_alpha", name: "Альфа", isPersonal: false },
        { id: "p_beta", name: "Бета", isPersonal: false },
        { id: "p_gamma", name: "Гамма", isPersonal: false },
      ],
    },
    rpc: { listPostponed: () => ({ postponed: [] }) },
  });
  fireEvent.click(await slot.findByRole("button", { name: /По проекту/ }));
  return slot;
}

describe("project pills on a touch screen", () => {
  it("keep to one line that scrolls sideways", async () => {
    const slot = await renderGrouped();
    const row = slot.getByRole("button", { name: /Альфа/ }).parentElement!;
    expect(row.className).not.toContain("flex-wrap");
    expect(row.className).toContain("flex-nowrap");
    expect(row.className).toContain("overflow-x-auto");
  });

  it("never squeeze a pill to fit the line", async () => {
    const slot = await renderGrouped();
    expect(slot.getByRole("button", { name: /Гамма/ }).className).toContain("shrink-0");
  });

  it("bring the pill of the slide chosen into view by scrolling the line alone, never the page", async () => {
    const slot = await renderGrouped();
    const gamma = slot.getByRole("button", { name: /Гамма/ });
    const row = gamma.parentElement!;
    row.getBoundingClientRect = () => ({ left: 0, right: 200 }) as DOMRect;
    gamma.getBoundingClientRect = () => ({ left: 180, right: 260 }) as DOMRect;
    const scrollTo = vi.fn();
    row.scrollTo = scrollTo as unknown as typeof row.scrollTo;
    scrollIntoView.mockReset();

    fireEvent.click(gamma);

    expect(scrollTo).toHaveBeenCalledWith({ left: 60, behavior: "smooth" });
    expect(scrollIntoView.mock.instances).not.toContain(gamma);
  });
});
