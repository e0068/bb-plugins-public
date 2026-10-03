// @vitest-environment jsdom
//
// The queue turned over on a phone. With "Инвертировать на телефоне" on, the
// section on bb's compact Home reads from the composer up: the count and the
// filters right above it, the project pills above them, the threads above the
// pills — the first one nearest — and the postponed ones at the far end. The
// count and the pills stay put while the threads scroll, and the threads open
// scrolled to their foot. jsdom lays nothing out, so the order and the scrolling
// are pinned on the flex direction and overflow the boxes get, as in
// compact-home-scroll.test.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, type RenderResult } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { compactHome045, utilitiesOn } from "./compact-home.testkit";
import { MemoryStorage } from "./memory-storage.testkit";

const PHONE_QUERY = "(max-width: 767px)";

function thread(id: string, title: string, projectId: string, latestAttentionAt: number): PluginSidebarThread {
  return {
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
    latestAttentionAt,
  };
}

const THREADS = {
  status: "ready" as const,
  threads: [
    thread("th_a", "Тред Альфы", "p_alpha", 1000),
    thread("th_b", "Тред Беты", "p_beta", 2000),
    thread("th_c", "Второй Альфы", "p_alpha", 3000),
    thread("th_p", "Отложенный", "p_beta", 4000),
  ],
  projects: [
    { id: "p_alpha", name: "Альфа", isPersonal: false },
    { id: "p_beta", name: "Бета", isPersonal: false },
  ],
};

const ONE_POSTPONED = {
  listPostponed: () => ({ postponed: [{ threadId: "th_p", at: 1 }] }),
  setPostponed: () => ({ ok: true as const }),
};

/** A screen `phone` or not, as the media queries the section asks report it. */
function stubScreen(phone: boolean): void {
  vi.stubGlobal(
    "matchMedia",
    (query: string) =>
      ({
        matches: phone && query === PHONE_QUERY,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }) as unknown as MediaQueryList,
  );
}

async function renderQueue(invertOnPhone: boolean): Promise<RenderResult> {
  const app = await loadPluginApp(() => import("./app"));
  const slot = renderSlot(app.homepageSections[0]!, { projectId: null }, {
    sidebarThreads: THREADS,
    rpc: ONE_POSTPONED,
    settings: { invertOnPhone },
  });
  await slot.findByRole("button", { name: /Отложено: 1/ });
  return slot;
}

const rootOf = (slot: RenderResult) =>
  slot.container.querySelector<HTMLElement>("[data-threads-overview-section]")!;

/** The section's markup, copied into bb 0.45's compact Home. */
function onCompactHome(slot: RenderResult): { scroller: HTMLElement; root: HTMLElement } {
  const { scroller, slotBox } = compactHome045();
  const root = rootOf(slot).cloneNode(true) as HTMLElement;
  slotBox.append(root);
  return { scroller, root };
}

/** The box the threads scroll in: the nearest one above the first row that scrolls on its own. */
function threadScroller(root: HTMLElement): HTMLElement | null {
  const row = root.querySelector("[data-queue-row]");
  for (let node = row?.parentElement ?? null; node !== null && node !== root; node = node.parentElement) {
    if (node.classList.contains("overflow-y-auto")) return node;
  }
  return null;
}

const titlesOf = (list: Element) =>
  Array.from(list.querySelectorAll("[data-queue-row]")).map((row) => row.textContent ?? "");

beforeEach(() => vi.stubGlobal("localStorage", new MemoryStorage()));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("on a phone with the queue turned over", () => {
  beforeEach(() => stubScreen(true));

  it("stands the count and the filters nearest the composer, the pills above them and the threads above the pills", async () => {
    const slot = await renderQueue(true);
    fireEvent.click(slot.getByRole("button", { name: "По проекту" }));
    const root = rootOf(slot);
    expect(root.classList).toContain("flex-col-reverse");
    const [header, pills, threads] = Array.from(root.children);
    expect(header!.querySelector("h2")?.textContent).toMatch(/: 3$/);
    expect(pills!.textContent).toContain("Альфа");
    expect(threads!.querySelector("[data-queue-row]")).not.toBeNull();
  });

  it("scrolls the threads alone, from their foot up, so the count and the pills stay put above the composer", async () => {
    const root = rootOf(await renderQueue(true));
    const scroller = threadScroller(root);
    expect(scroller).not.toBeNull();
    expect(scroller!.classList).toContain("flex-col-reverse");
    expect(scroller!.contains(root.querySelector("h2"))).toBe(false);
  });

  it("puts the first thread nearest the pills and the next ones above it", async () => {
    const root = rootOf(await renderQueue(true));
    const list = root.querySelector("[data-queue-row]")!.closest("ul")!;
    expect(list.classList).toContain("flex-col-reverse");
    expect(titlesOf(list)[0]).toContain("Тред Альфы");
  });

  it("turns every project's slide over the same way and lines the slides up at their foot", async () => {
    const slot = await renderQueue(true);
    fireEvent.click(slot.getByRole("button", { name: "По проекту" }));
    const slides = slot.getAllByRole("group");
    for (const slide of slides) expect(slide.querySelector("ul")!.classList).toContain("flex-col-reverse");
    const track = slides[0]!.parentElement!;
    expect(Array.from(track.classList)).toEqual(expect.arrayContaining(["items-end", "shrink-0"]));
  });

  it("keeps the postponed threads at the far end, right above the last thread", async () => {
    const root = rootOf(await renderQueue(true));
    const scroller = threadScroller(root)!;
    const postponed = Array.from(scroller.children).find((child) => /Отложено/.test(child.textContent ?? ""))!;
    const list = root.querySelector("[data-queue-row]")!.closest("ul")!;
    expect(Array.from(scroller.children).indexOf(postponed)).toBeGreaterThan(
      Array.from(scroller.children).findIndex((child) => child.contains(list)),
    );
    expect(postponed.classList).not.toContain("mt-auto");
    expect(postponed.classList).toContain("flex-col-reverse");
  });

  it("holds bb's boxes at the scroller's height, so the threads scroll inside the section and not the page", async () => {
    const { scroller, root } = onCompactHome(await renderQueue(true));
    const content = scroller.querySelector("[data-testid=root-compose-compact-scroll-content]")!;
    const contentUtilities = utilitiesOn(content, root);
    expect(contentUtilities).toEqual(expect.arrayContaining(["flex-1", "min-h-0"]));
    expect(contentUtilities).not.toContain("shrink-0");
    const sections = scroller.querySelector("[data-testid=plugin-homepage-sections]")!;
    for (const box of [sections.parentElement!, sections, sections.firstElementChild!]) {
      expect(utilitiesOn(box, root)).toContain("min-h-0");
    }
    expect(root.classList).toContain("min-h-0");
    expect(utilitiesOn(scroller, root)).toEqual(expect.arrayContaining(["top-14!", "flex", "flex-col"]));
  });
});

describe("on a phone with the queue turned over, under the card of the gesture home", () => {
  beforeEach(() =>
    vi.stubGlobal(
      "matchMedia",
      (query: string) =>
        ({
          matches: query === PHONE_QUERY || query.includes("pointer: coarse"),
          media: query,
          addEventListener: () => {},
          removeEventListener: () => {},
        }) as unknown as MediaQueryList,
    ),
  );

  it("draws the skeleton turned over too, filling the box from its foot", async () => {
    const app = await loadPluginApp(() => import("./app"));
    const overlay = app.appOverlays.find((registration) => registration.id === "home-swipe")!;
    renderSlot(overlay, {}, {
      context: { threadId: "th_a" },
      sidebarThreads: THREADS,
      rpc: ONE_POSTPONED,
      settings: { invertOnPhone: true },
    });
    const skeleton = document.querySelector("[data-home-swipe-skeleton]")!;
    expect(Array.from(skeleton.classList)).toEqual(expect.arrayContaining(["flex-col-reverse", "h-full"]));
  });

  it("lets the live section fill the box, so its threads scroll there as on Home", async () => {
    const root = rootOf(await renderQueue(true)).cloneNode(true) as HTMLElement;
    const box = document.createElement("div");
    box.setAttribute("data-home-swipe-section", "");
    box.append(root);
    document.body.append(box);
    expect(utilitiesOn(root, root)).toContain("h-full");
  });
});

describe("rows turned over on a phone", () => {
  beforeEach(() => stubScreen(true));

  it("draw the line between rows and none under the first, which stands on the pills", async () => {
    const root = rootOf(await renderQueue(true));
    const list = root.querySelector("[data-queue-row]")!.closest("ul")!;
    expect(Array.from(list.classList)).toEqual(
      expect.arrayContaining(["[&>li:first-child]:border-b-0", "[&>li:last-child:not(:first-child)]:border-b"]),
    );
  });
});

describe("the queue stays top-down", () => {
  it("on a wide screen with the setting on", async () => {
    stubScreen(false);
    const root = rootOf(await renderQueue(true));
    expect(root.classList).not.toContain("flex-col-reverse");
    expect(threadScroller(root)).toBeNull();
  });

  it("on a phone with the setting off", async () => {
    stubScreen(true);
    const root = rootOf(await renderQueue(false));
    expect(root.classList).not.toContain("flex-col-reverse");
    expect(threadScroller(root)).toBeNull();
  });
});
