// @vitest-environment jsdom
//
// A tap on a row of the queue on a phone: bb holds Home on the screen until
// the thread it was asked for has loaded, which over a remote connection takes
// a second or two with nothing to show for the tap. So the row grows into a
// screen at once, with the thread's title on it, and gives way to the thread
// the moment bb draws it. A mouse opens the thread as it always did.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";

function stubPointer(coarse: boolean): void {
  vi.stubGlobal(
    "matchMedia",
    (query: string) =>
      ({
        matches: coarse && query.includes("pointer: coarse"),
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }) as unknown as MediaQueryList,
  );
}

function thread(id: string, title: string): PluginSidebarThread {
  return {
    id,
    projectId: "p_alpha",
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
  };
}

const THREADS = {
  sidebarThreads: {
    status: "ready" as const,
    threads: [thread("th_a", "Тред Альфы"), thread("th_b", "Второй тред")],
    projects: [{ id: "p_alpha", name: "Альфа", isPersonal: false }],
  },
  rpc: { listPostponed: () => ({ postponed: [] }) },
};

// bb scopes a plugin's stylesheet to its own roots; a node outside draws bare.
const PLUGIN_STYLE_SCOPE = "[data-bb-plugin=threads-overview],[data-bb-plugin-root]:not([data-bb-plugin])";

/** bb's Home on a narrow screen, as it stands while the thread loads. */
function drawHome(): HTMLElement {
  const home = document.createElement("div");
  home.dataset.testid = "root-compose-compact-home";
  document.body.append(home);
  return home;
}

const opening = () => document.querySelector<HTMLElement>("[data-thread-open]");

async function tapRow(id: string) {
  const app = await loadPluginApp(() => import("./app"));
  const slot = renderSlot(app.homepageSections[0]!, { projectId: null }, THREADS);
  const row = await slot.findByText("Тред Альфы");
  vi.useFakeTimers();
  fireEvent.click(row.closest(`[data-queue-row=${id}]`)!);
  return slot;
}

beforeEach(() => {
  stubPointer(true);
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  });
});
afterEach(cleanup);
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("a tap on a row of the queue on a phone", () => {
  it("covers the screen at once with the thread's title, while bb still holds Home", async () => {
    drawHome();
    const slot = await tapRow("th_a");
    expect(opening()).not.toBeNull();
    expect(opening()!.textContent).toContain("Тред Альфы");
    expect(slot.navigateCalls).toContainEqual(expect.objectContaining({ method: "toThread" }));
  });

  it("is drawn in the plugin's own styles, out of reach of screen readers", async () => {
    drawHome();
    await tapRow("th_a");
    const layer = opening()!;
    expect(layer.matches(PLUGIN_STYLE_SCOPE)).toBe(true);
    expect(layer.getAttribute("aria-hidden")).toBe("true");
  });

  it("takes the touches that land on it, so none reaches the Home it hides", async () => {
    drawHome();
    await tapRow("th_a");
    expect(opening()!.style.pointerEvents).not.toBe("none");
  });

  it("gives way within five seconds if bb never leaves Home", async () => {
    drawHome();
    await tapRow("th_a");
    act(() => void vi.advanceTimersByTime(5200));
    expect(opening()).toBeNull();
  });

  it("opens out to the whole screen", async () => {
    drawHome();
    await tapRow("th_a");
    expect(opening()!.style.clipPath).toBe("inset(0px 0px 0px 0px round 0px)");
  });

  it("stays over the screen as long as bb holds Home", async () => {
    drawHome();
    await tapRow("th_a");
    act(() => void vi.advanceTimersByTime(2000));
    expect(opening()).not.toBeNull();
  });

  it("gives way to the thread once bb has drawn it in place of Home", async () => {
    const home = drawHome();
    await tapRow("th_a");
    home.remove();
    act(() => void vi.advanceTimersByTime(1000));
    expect(opening()).toBeNull();
  });

  it("gives way after a while even if bb never leaves Home", async () => {
    drawHome();
    await tapRow("th_a");
    act(() => void vi.advanceTimersByTime(20_000));
    expect(opening()).toBeNull();
  });

  it("leaves a single layer for a second tap before the first thread has opened", async () => {
    drawHome();
    await tapRow("th_a");
    fireEvent.click(document.querySelector("[data-queue-row=th_b]")!);
    expect(document.querySelectorAll("[data-thread-open]")).toHaveLength(1);
    expect(opening()!.textContent).toContain("Второй тред");
  });
});

describe("a click on a row with a mouse", () => {
  it("opens the thread as ever, with nothing laid over the screen", async () => {
    stubPointer(false);
    vi.resetModules();
    drawHome();
    const slot = await tapRow("th_a");
    expect(opening()).toBeNull();
    expect(slot.navigateCalls).toContainEqual(expect.objectContaining({ method: "toThread" }));
  });
});
