// @vitest-environment jsdom
//
// The queue draws its rows as far as the screen reaches: a long list of
// threads made every way to Home restyle hundreds of rows nobody could see.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";

import { FIRST_ROWS, ROW_STEP } from "./src/core/drawn-rows";

const THREADS = 40;

const thread = (index: number): PluginSidebarThread => ({
  id: `th_${index}`,
  projectId: "p_alpha",
  title: `Тред ${index}`,
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
  latestAttentionAt: 1000 + index,
});

const LONG_QUEUE = {
  status: "ready" as const,
  threads: Array.from({ length: THREADS }, (_, index) => thread(index)),
  projects: [{ id: "p_alpha", name: "Альфа", isPersonal: false }],
};

/** The observers the section set up, each with what it watches. */
const observers: { callback: IntersectionObserverCallback; targets: Element[] }[] = [];

class FakeIntersectionObserver {
  readonly targets: Element[] = [];
  constructor(readonly callback: IntersectionObserverCallback) {
    observers.push(this);
  }
  observe(target: Element) {
    this.targets.push(target);
  }
  disconnect() {
    observers.splice(observers.indexOf(this), 1);
  }
}

/** The screen scrolls far enough for every watched end of a list to come into reach. */
const scrollToEnd = () =>
  act(() => {
    for (const { callback, targets } of [...observers]) {
      callback(targets.map((target) => ({ target, isIntersecting: true }) as IntersectionObserverEntry), {} as IntersectionObserver);
    }
  });

const renderQueue = async () => {
  const app = await loadPluginApp(() => import("./app"));
  return renderSlot(app.homepageSections[0]!, { projectId: null }, {
    sidebarThreads: LONG_QUEUE,
    rpc: { listPostponed: () => ({ postponed: [] }) },
  });
};

const rows = (slot: Awaited<ReturnType<typeof renderQueue>>) => slot.container.querySelectorAll("[data-queue-row]").length;

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  observers.length = 0;
});

describe("rows drawn as far as the screen reaches", () => {
  beforeEach(() => vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver));

  it("opens Home with the first batch of a long queue, the count still naming all of it", async () => {
    const slot = await renderQueue();
    await slot.findByText(`Threads: ${THREADS}`);
    expect(rows(slot)).toBe(FIRST_ROWS);
  });

  it("draws the next batch each time the end of the drawn rows comes into reach, down to the last row", async () => {
    const slot = await renderQueue();
    await slot.findByText(`Threads: ${THREADS}`);
    scrollToEnd();
    expect(rows(slot)).toBe(FIRST_ROWS + ROW_STEP);
    scrollToEnd();
    expect(rows(slot)).toBe(THREADS);
    expect(observers).toHaveLength(0);
  });
});

describe("a browser without IntersectionObserver", () => {
  beforeEach(() => vi.stubGlobal("IntersectionObserver", undefined));

  it("draws the whole queue at once", async () => {
    const slot = await renderQueue();
    await slot.findByText(`Threads: ${THREADS}`);
    expect(rows(slot)).toBe(THREADS);
  });
});
