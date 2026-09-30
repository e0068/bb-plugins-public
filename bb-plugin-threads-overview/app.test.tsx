// @vitest-environment jsdom
//
// Shell promises of the section: what the queue looks like flat, what the
// "По проекту" toggle turns it into, and that the row's two icon actions reach
// the right places — the postpone rpc and the host's own archive flow. The
// ordering and grouping rules themselves are pinned in src/core/attention.test.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, within } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { PluginProvidersState, PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { formatWaitingSince } from "./src/core/format";

function idleThread(over: Partial<PluginSidebarThread> = {}): PluginSidebarThread {
  return {
    id: "th_1",
    projectId: "p_alpha",
    title: "Первый тред",
    titleFallback: null,
    parentThreadId: null,
    sectionId: null,
    originKind: null,
    originPluginId: null,
    providerId: "claude",
    hasPendingInteraction: false,
    activity: {
      workflows: 0,
      backgroundAgents: 0,
      backgroundCommands: 0,
      planMode: 0,
      goals: 0,
    },
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
    ...over,
  };
}

const TWO_PROJECTS = {
  status: "ready" as const,
  threads: [
    idleThread({ id: "th_a", title: "Тред Альфы", projectId: "p_alpha" }),
    idleThread({ id: "th_b", title: "Тред Беты", projectId: "p_beta" }),
    idleThread({ id: "th_c", title: "Второй Альфы", projectId: "p_alpha" }),
  ],
  projects: [
    { id: "p_alpha", name: "Альфа", isPersonal: false },
    { id: "p_beta", name: "Бета", isPersonal: false },
  ],
};

const THREE_PROJECTS = {
  ...TWO_PROJECTS,
  threads: [
    ...TWO_PROJECTS.threads,
    idleThread({ id: "th_g", title: "Тред Гаммы", projectId: "p_gamma" }),
  ],
  projects: [...TWO_PROJECTS.projects, { id: "p_gamma", name: "Гамма", isPersonal: false }],
};

const NO_MARKS = { listPostponed: () => ({ postponed: [] }) };

async function renderSection(
  options: Parameters<typeof renderSlot>[2] = {},
): Promise<ReturnType<typeof renderSlot>> {
  const app = await loadPluginApp(() => import("./app"));
  return renderSlot(app.homepageSections[0]!, { projectId: null }, {
    sidebarThreads: TWO_PROJECTS,
    rpc: NO_MARKS,
    ...options,
  });
}

/** The section with the experimental side panel and keyboard switched on in the plugin's settings. */
async function renderExperimental(
  options: Parameters<typeof renderSlot>[2] = {},
): Promise<ReturnType<typeof renderSlot>> {
  return renderSection({ ...options, settings: { experimentalSidePanel: true, ...options.settings } });
}

/**
 * jsdom has no layout, so every offset is 0 and the track would always report
 * slide 0. Hand the slides and their track the geometry a browser would give
 * them: slides of equal width laid left to right, the viewport one slide wide.
 */
function layOutTrack(slides: readonly HTMLElement[], slideWidth: number): void {
  const track = slides[0]!.parentElement!;
  slides.forEach((slide, index) => {
    fix(slide, "offsetLeft", index * slideWidth);
    fix(slide, "offsetWidth", slideWidth);
  });
  fix(track, "clientWidth", slideWidth);
}

function fix(element: HTMLElement, property: string, value: number): void {
  Object.defineProperty(element, property, { configurable: true, value });
}

/** The prototype that gives elements `onscrollend`, to take it away as a browser without scrollend would. */
function scrollEndOwner(): object {
  let owner: object | null = document.createElement("div");
  while (owner !== null && !Object.prototype.hasOwnProperty.call(owner, "onscrollend")) {
    owner = Object.getPrototypeOf(owner) as object | null;
  }
  if (owner === null) throw new Error("this DOM has no onscrollend to take away");
  return owner;
}

/** Scroll the track as a browser would, then let the section react to it. */
function scrollTrackTo(track: HTMLElement, scrollLeft: number): void {
  fix(track, "scrollLeft", scrollLeft);
  fireEvent.scroll(track);
}

// Node's own global `localStorage` (Storage API, Node 22+) shadows jsdom's
// and refuses every read/write without a `--localstorage-file` flag, so a
// plain in-memory stand-in goes in its place — fresh per test, like the
// section's own defaults.
class MemoryStorage implements Storage {
  private readonly map = new Map<string, string>();
  get length() {
    return this.map.size;
  }
  clear() {
    this.map.clear();
  }
  getItem(key: string) {
    return this.map.has(key) ? this.map.get(key)! : null;
  }
  key(index: number) {
    return [...this.map.keys()][index] ?? null;
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
  setItem(key: string, value: string) {
    this.map.set(key, value);
  }
}

beforeEach(() => {
  vi.stubGlobal("localStorage", new MemoryStorage());
});

afterEach(cleanup);
afterEach(() => vi.unstubAllGlobals());

describe("attention section, flat", () => {
  it("lists the queue with each thread's project under its title", async () => {
    const slot = await renderSection();
    await slot.findByText("Тред Альфы");
    expect(slot.getAllByText("Альфа")).toHaveLength(2);
    expect(slot.getByText("Бета")).toBeDefined();
  });

  it("labels the row actions for screen readers but shows no button text", async () => {
    const slot = await renderSection();
    const postpone = (await slot.findAllByLabelText("Отложить"))[0]!;
    const archive = slot.getAllByLabelText("Архивировать")[0]!;
    expect(postpone.textContent).toBe("");
    expect(archive.textContent).toBe("");
  });

  it("postpones a thread through rpc when its clock button is pressed", async () => {
    const slot = await renderSection();
    fireEvent.click((await slot.findAllByLabelText("Отложить"))[0]!);
    expect(slot.rpcCalls).toContainEqual({
      method: "setPostponed",
      input: { threadId: "th_a", postponed: true },
    });
  });

  it("archives a thread through the host's own action, not an rpc of its own", async () => {
    const slot = await renderSection();
    fireEvent.click((await slot.findAllByLabelText("Архивировать"))[0]!);
    expect(slot.sidebarActionCalls).toEqual([
      { method: "archive", threadId: "th_a" },
    ]);
    expect(slot.rpcCalls.map((call) => call.method)).not.toContain("setPostponed");
  });
});

describe("a row on a mouse", () => {
  it("fills under the pointer and drops its divider, as before", async () => {
    const slot = await renderSection();
    const row = (await slot.findByText("Тред Альфы")).closest("li")!;
    expect(row.className).toContain("hover:bg-state-hover");
    expect(row.className).toContain("hover:border-b-transparent");
  });
});

describe("section heading", () => {
  it("names the section Threads with its count, in the row of the sort buttons", async () => {
    const slot = await renderSection();
    const heading = await slot.findByRole("heading", { name: "Threads: 3" });
    const sort = slot.getByRole("button", { name: "Сортировка: Дольше ждут" });
    expect(heading.parentElement!.contains(sort)).toBe(true);
  });
});

describe("attention section, grouped by project", () => {
  // jsdom ships no scrollIntoView at all, so the swipe track needs one to call.
  const scrollIntoView = vi.fn();

  beforeEach(() => {
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      configurable: true,
      writable: true,
      value: scrollIntoView,
    });
  });

  afterEach(() => {
    scrollIntoView.mockReset();
    delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  });

  it("turns the queue into one slide per project, each named by a button", async () => {
    const slot = await renderSection();
    fireEvent.click(await slot.findByRole("button", { name: /По проекту/ }));

    const alpha = slot.getByLabelText("Альфа");
    const beta = slot.getByLabelText("Бета");
    expect(within(alpha).getAllByRole("listitem")).toHaveLength(2);
    expect(within(beta).getAllByRole("listitem")).toHaveLength(1);
    expect(slot.getByRole("button", { name: /Альфа/ })).toBeDefined();
    expect(slot.getByRole("button", { name: /Бета/ })).toBeDefined();
  });

  it("drops the project caption inside a group — the slide already names it", async () => {
    const slot = await renderSection();
    fireEvent.click(await slot.findByRole("button", { name: /По проекту/ }));

    const alpha = slot.getByLabelText("Альфа");
    expect(within(alpha).queryByText("Альфа")).toBeNull();
  });

  it("archives from inside the focused group, after putting its project in the composer", async () => {
    const slot = await renderSection();
    fireEvent.click(await slot.findByRole("button", { name: /По проекту/ }));
    const alpha = slot.getByRole("group", { name: "Альфа" });
    const row = within(alpha).getByText("Тред Альфы").closest("li") as HTMLElement;

    fireEvent.click(within(row).getByLabelText("Архивировать"));
    expect(slot.sidebarActionCalls).toEqual([
      { method: "openNewThread", options: { projectId: "p_alpha", focusPrompt: false } },
      { method: "archive", threadId: "th_a" },
    ]);
  });

  it("puts the project pills on a row of their own, under the heading and its controls", async () => {
    const slot = await renderSection();
    fireEvent.click(await slot.findByRole("button", { name: /По проекту/ }));
    const heading = slot.getByRole("heading", { name: "Threads: 3" });
    const pill = slot.getByRole("button", { name: /Альфа/ });

    expect(heading.parentElement!.contains(pill)).toBe(false);
    expect(
      heading.parentElement!.compareDocumentPosition(pill) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("lets the pills wrap onto more lines on a screen with a mouse", async () => {
    const slot = await renderSection();
    fireEvent.click(await slot.findByRole("button", { name: /По проекту/ }));
    const pills = slot.getByRole("button", { name: /Альфа/ }).parentElement!;
    expect(pills.className).toContain("flex-wrap");
  });

  it("focuses the first group and dims the rest", async () => {
    const slot = await renderSection();
    fireEvent.click(await slot.findByRole("button", { name: /По проекту/ }));

    expect(slot.getByLabelText("Альфа").className).toContain("opacity-100");
    expect(slot.getByLabelText("Бета").className).toContain("opacity-40");
  });

  it("keeps the rows of a dimmed group out of reach, and lights the group up on hover", async () => {
    const slot = await renderSection();
    fireEvent.click(await slot.findByRole("button", { name: /По проекту/ }));
    const alpha = slot.getByRole("group", { name: "Альфа" });
    const beta = slot.getByRole("group", { name: "Бета" });

    expect(within(beta).getByRole("list").hasAttribute("inert")).toBe(true);
    expect(within(alpha).getByRole("list").hasAttribute("inert")).toBe(false);
    expect(beta.className).toContain("hover:opacity-70");
  });

  it("brings a dimmed group to the centre when it is clicked", async () => {
    const slot = await renderSection();
    fireEvent.click(await slot.findByRole("button", { name: /По проекту/ }));
    const beta = slot.getByRole("group", { name: "Бета" });

    fireEvent.click(beta);

    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView.mock.instances[0]).toBe(beta);
    expect(slot.getByRole("button", { name: /Бета/ }).getAttribute("aria-pressed")).toBe("true");
  });

  it("follows the swipe: the slide under the viewport becomes the focused one", async () => {
    const slot = await renderSection();
    fireEvent.click(await slot.findByRole("button", { name: /По проекту/ }));
    const alpha = slot.getByRole("group", { name: "Альфа" });
    const beta = slot.getByRole("group", { name: "Бета" });
    layOutTrack([alpha, beta], 300);

    scrollTrackTo(alpha.parentElement!, 300);

    expect(slot.getByRole("button", { name: /Бета/ }).getAttribute("aria-pressed")).toBe("true");
    expect(slot.getByRole("button", { name: /Альфа/ }).getAttribute("aria-pressed")).toBe("false");
    expect(beta.className).toContain("opacity-100");
    expect(alpha.className).toContain("opacity-40");
  });

  it("scrolls to a group and marks it current when its button is pressed", async () => {
    const slot = await renderSection();
    fireEvent.click(await slot.findByRole("button", { name: /По проекту/ }));
    const beta = slot.getByRole("group", { name: "Бета" });

    fireEvent.click(slot.getByRole("button", { name: /Бета/ }));

    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView.mock.instances[0]).toBe(beta);
    expect(scrollIntoView.mock.calls[0]![0]).toMatchObject({ inline: "center" });
    expect(slot.getByRole("button", { name: /Бета/ }).getAttribute("aria-pressed")).toBe("true");
  });

  it("goes back to one flat list when the toggle is pressed again", async () => {
    const slot = await renderSection();
    const toggle = await slot.findByRole("button", { name: /По проекту/ });
    fireEvent.click(toggle);
    fireEvent.click(toggle);
    expect(slot.queryByLabelText("Альфа")).toBeNull();
    expect(slot.getAllByRole("listitem")).toHaveLength(3);
  });
});

describe("the home composer follows the project slide", () => {
  const scrollIntoView = vi.fn();

  beforeEach(() => {
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      configurable: true,
      writable: true,
      value: scrollIntoView,
    });
  });

  afterEach(() => {
    scrollIntoView.mockReset();
    delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  });

  const composerProjects = (slot: ReturnType<typeof renderSlot>) =>
    slot.sidebarActionCalls
      .filter((call) => call.method === "openNewThread")
      .map((call) => (call as { options?: { projectId?: string } }).options);

  it("puts the focused slide's project in the composer once grouping is on", async () => {
    const slot = await renderSection();
    fireEvent.click(await slot.findByRole("button", { name: /По проекту/ }));
    expect(composerProjects(slot)).toEqual([{ projectId: "p_alpha", focusPrompt: false }]);
  });

  it("moves the composer to the project whose pill is pressed", async () => {
    const slot = await renderSection();
    fireEvent.click(await slot.findByRole("button", { name: /По проекту/ }));
    fireEvent.click(slot.getByRole("button", { name: /Бета/ }));
    expect(composerProjects(slot).at(-1)).toEqual({ projectId: "p_beta", focusPrompt: false });
  });

  // Putting a project in the composer is a navigation in bb: Home redraws
  // under it, so doing it mid-swipe jerked the page and threw the track off.
  it("leaves the composer alone while a swipe is still crossing the slides", async () => {
    const slot = await renderSection({ sidebarThreads: THREE_PROJECTS });
    fireEvent.click(await slot.findByRole("button", { name: /По проекту/ }));
    const slides = ["Альфа", "Бета", "Гамма"].map((name) => slot.getByRole("group", { name }));
    layOutTrack(slides, 300);
    const track = slides[0]!.parentElement!;

    scrollTrackTo(track, 300);
    scrollTrackTo(track, 600);
    scrollTrackTo(track, 300);

    expect(composerProjects(slot)).toEqual([{ projectId: "p_alpha", focusPrompt: false }]);
    expect(slot.getByRole("button", { name: /Бета/ }).getAttribute("aria-pressed")).toBe("true");
  });

  it("puts the project the swipe comes to rest on in the composer, once", async () => {
    const slot = await renderSection({ sidebarThreads: THREE_PROJECTS });
    fireEvent.click(await slot.findByRole("button", { name: /По проекту/ }));
    const slides = ["Альфа", "Бета", "Гамма"].map((name) => slot.getByRole("group", { name }));
    layOutTrack(slides, 300);
    const track = slides[0]!.parentElement!;

    scrollTrackTo(track, 300);
    scrollTrackTo(track, 600);
    fireEvent(track, new Event("scrollend"));

    expect(composerProjects(slot).map((options) => options?.projectId)).toEqual(["p_alpha", "p_gamma"]);
  });

  it("asks nothing of the composer when the focused group goes and the track settles on its neighbour", async () => {
    const slot = await renderSection({ sidebarThreads: THREE_PROJECTS });
    fireEvent.click(await slot.findByRole("button", { name: /По проекту/ }));
    const slides = ["Альфа", "Бета", "Гамма"].map((name) => slot.getByRole("group", { name }));
    layOutTrack(slides, 300);
    const track = slides[0]!.parentElement!;
    scrollTrackTo(track, 600);
    fireEvent(track, new Event("scrollend"));

    fireEvent.click(within(rowOf(slot, "Тред Гаммы")).getByRole("button", { name: "Отложить" }));
    const left = ["Альфа", "Бета"].map((name) => slot.getByRole("group", { name }));
    layOutTrack(left, 300);
    scrollTrackTo(track, 300);
    fireEvent(track, new Event("scrollend"));

    expect(composerProjects(slot).map((options) => options?.projectId)).toEqual(["p_alpha", "p_gamma"]);
  });

  it("asks nothing more of the composer when a pill jump comes to rest", async () => {
    const slot = await renderSection({ sidebarThreads: THREE_PROJECTS });
    fireEvent.click(await slot.findByRole("button", { name: /По проекту/ }));
    const slides = ["Альфа", "Бета", "Гамма"].map((name) => slot.getByRole("group", { name }));
    layOutTrack(slides, 300);
    const track = slides[0]!.parentElement!;

    fireEvent.click(slot.getByRole("button", { name: /Гамма/ }));
    scrollTrackTo(track, 300);
    scrollTrackTo(track, 600);
    fireEvent(track, new Event("scrollend"));

    expect(composerProjects(slot).map((options) => options?.projectId)).toEqual(["p_alpha", "p_gamma"]);
  });

  it("takes a pause in the scrolling for the rest where the browser has no scrollend", async () => {
    const owner = scrollEndOwner();
    const descriptor = Object.getOwnPropertyDescriptor(owner, "onscrollend")!;
    delete (owner as { onscrollend?: unknown }).onscrollend;
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const slot = await renderSection({ sidebarThreads: THREE_PROJECTS });
      fireEvent.click(await slot.findByRole("button", { name: /По проекту/ }));
      const slides = ["Альфа", "Бета", "Гамма"].map((name) => slot.getByRole("group", { name }));
      layOutTrack(slides, 300);
      const track = slides[0]!.parentElement!;

      scrollTrackTo(track, 300);
      act(() => vi.advanceTimersByTime(50));
      scrollTrackTo(track, 600);
      act(() => vi.advanceTimersByTime(50));
      expect(composerProjects(slot)).toHaveLength(1);

      act(() => vi.advanceTimersByTime(500));
      expect(composerProjects(slot).map((options) => options?.projectId)).toEqual(["p_alpha", "p_gamma"]);
    } finally {
      vi.useRealTimers();
      Object.defineProperty(owner, "onscrollend", descriptor);
    }
  });

  it("asks nothing of the composer on a re-render or a sort, but asks again on a press of the pill in view", async () => {
    const slot = await renderSection();
    fireEvent.click(await slot.findByRole("button", { name: /По проекту/ }));
    fireEvent.click(slot.getByRole("button", { name: "Сортировка: Дольше ждут" }));
    expect(composerProjects(slot)).toHaveLength(1);

    fireEvent.click(slot.getByRole("button", { name: /Альфа/ }));
    expect(composerProjects(slot)).toEqual([
      { projectId: "p_alpha", focusPrompt: false },
      { projectId: "p_alpha", focusPrompt: false },
    ]);
  });

  it("leaves the composer alone in the flat list", async () => {
    const slot = await renderSection();
    await slot.findByText("Тред Альфы");
    expect(composerProjects(slot)).toEqual([]);
  });

  it("opens again on the slide chosen before, and asks nothing of the composer on the way back", async () => {
    const first = await renderSection();
    fireEvent.click(await first.findByRole("button", { name: /По проекту/ }));
    fireEvent.click(first.getByRole("button", { name: /Бета/ }));
    cleanup();

    const second = await renderSection();
    const beta = await second.findByRole("button", { name: /Бета/ });
    expect(beta.getAttribute("aria-pressed")).toBe("true");
    expect(composerProjects(second)).toEqual([]);
  });

  it("asks nothing of the composer for the slides a pill jump scrolls past", async () => {
    const slot = await renderSection({
      sidebarThreads: {
        ...TWO_PROJECTS,
        threads: [
          ...TWO_PROJECTS.threads,
          idleThread({ id: "th_g", title: "Тред Гаммы", projectId: "p_gamma" }),
        ],
        projects: [...TWO_PROJECTS.projects, { id: "p_gamma", name: "Гамма", isPersonal: false }],
      },
    });
    fireEvent.click(await slot.findByRole("button", { name: /По проекту/ }));
    const slides = ["Альфа", "Бета", "Гамма"].map((name) => slot.getByRole("group", { name }));
    layOutTrack(slides, 300);

    fireEvent.click(slot.getByRole("button", { name: /Гамма/ }));
    scrollTrackTo(slides[0]!.parentElement!, 300);
    scrollTrackTo(slides[0]!.parentElement!, 600);

    expect(composerProjects(slot).map((options) => options?.projectId)).toEqual(["p_alpha", "p_gamma"]);
  });

  it("orders the pills as the left panel lists the projects, not alphabetically", async () => {
    const slot = await renderSection({
      sidebarThreads: { ...TWO_PROJECTS, projects: [...TWO_PROJECTS.projects].reverse() },
    });
    fireEvent.click(await slot.findByRole("button", { name: /По проекту/ }));

    const pills = slot
      .getAllByRole("button")
      .filter((button) => /^(Альфа|Бета)/.test(button.textContent ?? ""));
    expect(pills.map((pill) => pill.textContent)).toEqual(["Бета1", "Альфа2"]);
  });

  it("keeps the pressed pill lit while the track scrolls past the slides before it", async () => {
    const slot = await renderSection({ sidebarThreads: THREE_PROJECTS });
    fireEvent.click(await slot.findByRole("button", { name: /По проекту/ }));
    const slides = ["Альфа", "Бета", "Гамма"].map((name) => slot.getByRole("group", { name }));
    layOutTrack(slides, 300);

    fireEvent.click(slot.getByRole("button", { name: /Гамма/ }));
    scrollTrackTo(slides[0]!.parentElement!, 300);

    expect(slot.getByRole("button", { name: /Гамма/ }).getAttribute("aria-pressed")).toBe("true");
    expect(slot.getByRole("button", { name: /Бета/ }).getAttribute("aria-pressed")).toBe("false");
  });

  it("hands the focus back to the scroll once a wheel takes over a pill jump", async () => {
    const slot = await renderSection({ sidebarThreads: THREE_PROJECTS });
    fireEvent.click(await slot.findByRole("button", { name: /По проекту/ }));
    const slides = ["Альфа", "Бета", "Гамма"].map((name) => slot.getByRole("group", { name }));
    layOutTrack(slides, 300);

    fireEvent.click(slot.getByRole("button", { name: /Гамма/ }));
    fireEvent.wheel(slides[0]!.parentElement!);
    scrollTrackTo(slides[0]!.parentElement!, 300);

    expect(slot.getByRole("button", { name: /Бета/ }).getAttribute("aria-pressed")).toBe("true");
  });

  it("lets the focus follow the scroll after the pill already in view is pressed", async () => {
    const slot = await renderSection({ sidebarThreads: THREE_PROJECTS });
    fireEvent.click(await slot.findByRole("button", { name: /По проекту/ }));
    const slides = ["Альфа", "Бета", "Гамма"].map((name) => slot.getByRole("group", { name }));
    layOutTrack(slides, 300);

    fireEvent.click(slot.getByRole("button", { name: /Альфа/ }));
    scrollTrackTo(slides[0]!.parentElement!, 300);

    expect(slot.getByRole("button", { name: /Бета/ }).getAttribute("aria-pressed")).toBe("true");
  });

  it("keeps a pill jump going when the page, not the track, is wheeled", async () => {
    const slot = await renderSection({ sidebarThreads: THREE_PROJECTS });
    fireEvent.click(await slot.findByRole("button", { name: /По проекту/ }));
    const slides = ["Альфа", "Бета", "Гамма"].map((name) => slot.getByRole("group", { name }));
    layOutTrack(slides, 300);

    fireEvent.click(slot.getByRole("button", { name: /Гамма/ }));
    fireEvent.wheel(slides[0]!.parentElement!, { deltaY: 40 });
    scrollTrackTo(slides[0]!.parentElement!, 300);

    expect(slot.getByRole("button", { name: /Гамма/ }).getAttribute("aria-pressed")).toBe("true");
  });

  it("leaves the composer alone while threads open in the side panel", async () => {
    const slot = await renderExperimental();
    fireEvent.keyDown(await slot.findByRole("button", { name: "На весь экран" }), { key: "Enter" });
    fireEvent.click(await slot.findByRole("menuitemradio", { name: "Открывать в боковой панели" }));
    fireEvent.click(slot.getByRole("button", { name: /По проекту/ }));
    fireEvent.click(slot.getByRole("button", { name: /Бета/ }));
    expect(composerProjects(slot)).toEqual([]);
  });

  it("leaves the composer's project in place when grouping is switched off", async () => {
    const slot = await renderSection();
    const toggle = await slot.findByRole("button", { name: /По проекту/ });
    fireEvent.click(toggle);
    fireEvent.click(toggle);
    expect(composerProjects(slot)).toEqual([{ projectId: "p_alpha", focusPrompt: false }]);
  });
});

describe("sort and grouping survive a reload", () => {
  it("keeps the По проекту toggle pressed after the section remounts", async () => {
    const first = await renderSection();
    fireEvent.click(await first.findByRole("button", { name: /По проекту/ }));
    cleanup();

    const second = await renderSection();
    expect(
      second.getByRole("button", { name: /По проекту/ }).getAttribute("aria-pressed"),
    ).toBe("true");
  });
});

describe("header controls", () => {
  it("keeps the other header controls worded, not iconised", async () => {
    const slot = await renderSection();
    expect(await slot.findByRole("button", { name: /По проекту/ })).toBeDefined();
  });
});

describe("hover preview of a thread's conversation", () => {
  /** Radix opens a hover card on a real pointer, and only after its own timer. */
  async function hoverFor(row: HTMLElement, ms: number): Promise<void> {
    fireEvent.pointerEnter(row, { pointerType: "mouse" });
    await act(async () => {
      vi.advanceTimersByTime(ms);
    });
  }

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("opens the hovered thread's conversation once the delay is up", async () => {
    const slot = await renderSection({ settings: { previewDelaySeconds: "2" } });
    await hoverFor(slot.getAllByRole("listitem")[0]!, 2000);

    expect(slot.getByTestId("bb-thread-chat").getAttribute("data-thread-id")).toBe(
      "th_a",
    );
  });

  it("stays shut until the delay is up", async () => {
    const slot = await renderSection({ settings: { previewDelaySeconds: "2" } });
    await hoverFor(slot.getAllByRole("listitem")[0]!, 1000);

    expect(slot.queryByTestId("bb-thread-chat")).toBeNull();
  });

  it("never opens when the delay is set to zero", async () => {
    const slot = await renderSection({ settings: { previewDelaySeconds: "0" } });
    await hoverFor(slot.getAllByRole("listitem")[0]!, 60_000);

    expect(slot.queryByTestId("bb-thread-chat")).toBeNull();
  });

  it("previews rows inside the focused project group too", async () => {
    const slot = await renderSection({ settings: { previewDelaySeconds: "1" } });
    fireEvent.click(slot.getByRole("button", { name: /По проекту/ }));
    const alpha = slot.getByRole("group", { name: "Альфа" });
    await hoverFor(within(alpha).getByText("Тред Альфы").closest("li") as HTMLElement, 1000);

    expect(slot.getByTestId("bb-thread-chat").getAttribute("data-thread-id")).toBe(
      "th_a",
    );
  });

  it("never previews a row of a dimmed group", async () => {
    const slot = await renderSection({ settings: { previewDelaySeconds: "1" } });
    fireEvent.click(slot.getByRole("button", { name: /По проекту/ }));
    const beta = slot.getByRole("group", { name: "Бета" });
    await hoverFor(within(beta).getAllByRole("listitem")[0]!, 1000);

    expect(slot.queryByTestId("bb-thread-chat")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Provider logos, and postponed rows as full as the queue's.

type ProviderInfo = PluginProvidersState["providers"][number];

/** A provider directory entry with only the fields the section reads. */
function providerInfo(over: { id: string; displayName: string; logoUrl: string | null; iconTint?: { light: string; dark: string } }): ProviderInfo {
  return {
    id: over.id,
    displayName: over.displayName,
    logoUrl: over.logoUrl,
    strings: over.iconTint ? { iconTint: over.iconTint } : undefined,
  } as unknown as ProviderInfo;
}

const PROVIDERS: Partial<PluginProvidersState> = {
  status: "ready",
  providers: [
    providerInfo({ id: "claude-code", displayName: "Claude Code", logoUrl: "/api/v1/system/providers/claude-code/logo?h=1", iconTint: { light: "#D97757", dark: "#D97757" } }),
    providerInfo({ id: "codex", displayName: "Codex", logoUrl: "/api/v1/system/providers/codex/logo?h=2" }),
  ],
};

const MIXED_PROVIDERS = {
  ...TWO_PROJECTS,
  threads: [
    idleThread({ id: "th_a", title: "Тред Альфы", projectId: "p_alpha", providerId: "codex" }),
    idleThread({ id: "th_b", title: "Тред Беты", projectId: "p_beta", providerId: "claude-code" }),
    idleThread({ id: "th_c", title: "Второй Альфы", projectId: "p_alpha", providerId: "acp-unknown" }),
  ],
};

function rowOf(slot: ReturnType<typeof renderSlot>, title: string): HTMLElement {
  return slot.getByText(title).closest("li") as HTMLElement;
}

/** bb's own composer, as far as the section can see it: a marked shell around an editable box. */
function mountComposer(text = ""): HTMLElement {
  const shell = document.createElement("div");
  shell.setAttribute("data-app-composer", "");
  shell.setAttribute("data-app-composer-role", "primary");
  const editor = document.createElement("div");
  editor.setAttribute("contenteditable", "true");
  editor.tabIndex = 0;
  editor.textContent = text;
  shell.append(editor);
  document.body.append(shell);
  editor.focus();
  return editor;
}

afterEach(() => {
  document.querySelectorAll("[data-app-composer]").forEach((node) => node.remove());
});

describe("provider logo in a queue row", () => {
  it("shows the Codex logo at the left of a Codex thread's row", async () => {
    const slot = await renderSection({ sidebarThreads: MIXED_PROVIDERS, providers: PROVIDERS });
    const row = rowOf(slot, "Тред Альфы");
    const logo = within(row).getByRole("img", { name: "Codex" });
    expect(logo.dataset.logoUrl).toBe("/api/v1/system/providers/codex/logo?h=2");
    expect(logo.dataset.tint).toBeUndefined();
    expect(row.firstElementChild).toBe(logo);
  });

  it("shows the Claude Code logo in its orange tint", async () => {
    const slot = await renderSection({ sidebarThreads: MIXED_PROVIDERS, providers: PROVIDERS });
    const logo = within(rowOf(slot, "Тред Беты")).getByRole("img", { name: "Claude Code" });
    expect(logo.dataset.tint).toBe("light-dark(#D97757, #D97757)");
  });

  it("keeps the title in place with an empty slot when the provider is unknown", async () => {
    const slot = await renderSection({ sidebarThreads: MIXED_PROVIDERS, providers: PROVIDERS });
    const row = rowOf(slot, "Второй Альфы");
    expect(within(row).queryByRole("img")).toBeNull();
    expect((row.firstElementChild as HTMLElement).getAttribute("aria-hidden")).toBe("true");
  });

  it("shows no logo while the provider list is loading", async () => {
    const slot = await renderSection({ sidebarThreads: MIXED_PROVIDERS, providers: { status: "loading", providers: [] } });
    expect(within(rowOf(slot, "Тред Альфы")).queryByRole("img")).toBeNull();
    expect(slot.getByText("Тред Беты")).toBeDefined();
  });
});

describe("postponed rows", () => {
  const POSTPONED_BETA = { listPostponed: () => ({ postponed: [{ threadId: "th_b", at: 1 }] }), setPostponed: () => ({ ok: true as const }) };

  async function renderPostponed(settings: Record<string, string> = {}) {
    const slot = await renderSection({
      sidebarThreads: {
        ...TWO_PROJECTS,
        threads: [
          idleThread({ id: "th_a", title: "Тред Альфы", projectId: "p_alpha", providerId: "claude-code" }),
          idleThread({ id: "th_b", title: "Отложенный Беты", projectId: "p_beta", providerId: "codex" }),
        ],
      },
      providers: PROVIDERS,
      rpc: POSTPONED_BETA,
      settings,
    });
    fireEvent.click(await slot.findByRole("button", { name: /Отложено: 1/ }));
    return slot;
  }

  it("shows a postponed thread's project and provider logo once the list is unfolded", async () => {
    const slot = await renderPostponed();
    const row = rowOf(slot, "Отложенный Беты");
    expect(within(row).getByRole("img", { name: "Codex" })).toBeDefined();
    expect(within(row).getByText("Бета")).toBeDefined();
    expect(within(row).getByRole("button", { name: /Вернуть/ })).toBeDefined();
  });

  it("opens a postponed thread when its title is pressed", async () => {
    const slot = await renderPostponed();
    fireEvent.click(slot.getByText("Отложенный Беты"));
    expect(slot.navigateCalls).toContainEqual({ method: "toThread", threadId: "th_b" });
  });

  it("returns a postponed thread to the queue when Вернуть is pressed", async () => {
    const slot = await renderPostponed();
    fireEvent.click(within(rowOf(slot, "Отложенный Беты")).getByRole("button", { name: /Вернуть/ }));
    expect(slot.rpcCalls).toContainEqual({ method: "setPostponed", input: { threadId: "th_b", postponed: false } });
    expect(slot.queryByRole("button", { name: /Отложено/ })).toBeNull();
    expect(within(rowOf(slot, "Отложенный Беты")).getByLabelText("Отложить")).toBeDefined();
  });

  describe("hover preview", () => {
    beforeEach(() => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    async function hoverFor(row: HTMLElement, ms: number): Promise<void> {
      fireEvent.pointerEnter(row, { pointerType: "mouse" });
      await act(async () => {
        vi.advanceTimersByTime(ms);
      });
    }

    it("opens a postponed thread's conversation on hover once the delay is up", async () => {
      const slot = await renderPostponed({ previewDelaySeconds: "1" });
      await hoverFor(rowOf(slot, "Отложенный Беты"), 1000);
      expect(slot.getByTestId("bb-thread-chat").getAttribute("data-thread-id")).toBe("th_b");
    });

    it("never previews postponed rows when the delay is zero", async () => {
      const slot = await renderPostponed({ previewDelaySeconds: "0" });
      await hoverFor(rowOf(slot, "Отложенный Беты"), 60_000);
      expect(slot.queryByTestId("bb-thread-chat")).toBeNull();
    });
  });
});

// Row status in place of Archive, and the worktree mark beside the project.

const STATUS_THREADS = {
  ...TWO_PROJECTS,
  threads: [
    idleThread({ id: "th_a", title: "Тред Альфы", indicator: "unread-success" }),
    idleThread({ id: "th_b", title: "Тред Беты", projectId: "p_beta", hasPendingInteraction: true }),
    idleThread({ id: "th_c", title: "Второй Альфы", indicator: "unread-error" }),
    idleThread({ id: "th_d", title: "Тихий тред" }),
  ],
};

describe("thread status in a queue row", () => {
  it.each([
    ["Тред Альфы", "Новое сообщение"],
    ["Тред Беты", "Ждёт ответа"],
    ["Второй Альфы", "Новое сообщение с ошибкой"],
  ])("%s shows its status «%s» and no Archive button", async (title, status) => {
    const slot = await renderSection({ sidebarThreads: STATUS_THREADS });
    await slot.findByText(title);
    const row = rowOf(slot, title);
    expect(within(row).getByRole("img", { name: status })).toBeDefined();
    expect(within(row).queryByLabelText("Архивировать")).toBeNull();
  });

  it("a thread with no status keeps its Archive button and shows no status", async () => {
    const slot = await renderSection({ sidebarThreads: STATUS_THREADS });
    await slot.findByText("Тихий тред");
    const row = rowOf(slot, "Тихий тред");
    expect(within(row).getByLabelText("Архивировать")).toBeDefined();
    expect(within(row).queryByRole("img", { name: /сообщение|ответа/i })).toBeNull();
  });
});

describe("worktree mark beside the project", () => {
  const environment = (workspaceDisplayKind: "managed-worktree" | "unmanaged-worktree" | "other") => ({
    id: "env_1",
    name: null,
    branchName: "bb/x",
    workspaceDisplayKind,
  });
  const WORKTREES = {
    ...TWO_PROJECTS,
    threads: [
      idleThread({ id: "th_a", title: "Тред Альфы", environment: environment("managed-worktree") }),
      idleThread({ id: "th_b", title: "Тред Беты", projectId: "p_beta", environment: environment("unmanaged-worktree") }),
      idleThread({ id: "th_c", title: "Второй Альфы", environment: environment("other") }),
      idleThread({ id: "th_d", title: "Тихий тред" }),
    ],
  };

  it.each(["Тред Альфы", "Тред Беты"])("%s runs in a worktree and shows the folder mark", async (title) => {
    const slot = await renderSection({ sidebarThreads: WORKTREES });
    await slot.findByText(title);
    expect(within(rowOf(slot, title)).getByRole("img", { name: "Рабочее дерево" })).toBeDefined();
  });

  it.each(["Второй Альфы", "Тихий тред"])("%s has no worktree and no mark", async (title) => {
    const slot = await renderSection({ sidebarThreads: WORKTREES });
    await slot.findByText(title);
    expect(within(rowOf(slot, title)).queryByRole("img", { name: "Рабочее дерево" })).toBeNull();
  });

  it("marks a worktree inside a project group too, where the project caption is gone", async () => {
    const slot = await renderSection({ sidebarThreads: WORKTREES });
    fireEvent.click(await slot.findByText("По проекту"));
    expect(within(rowOf(slot, "Тред Альфы")).getByRole("img", { name: "Рабочее дерево" })).toBeDefined();
  });
});

describe("waiting for input is said once", () => {
  it("the status mark carries «Ждёт ответа», so the caption under the title does not repeat it", async () => {
    const slot = await renderSection({ sidebarThreads: STATUS_THREADS });
    await slot.findByText("Тред Беты");
    expect(within(rowOf(slot, "Тред Беты")).queryByText(/ждёт ответа/)).toBeNull();
  });
});

describe("the postponed list closes the section", () => {
  const POSTPONED_BETA = { listPostponed: () => ({ postponed: [{ threadId: "th_b", at: 1 }] }) };

  /** The section's own root: the outermost element the slot rendered. */
  const lastBlockHolds = (slot: ReturnType<typeof renderSlot>, toggle: HTMLElement) => {
    const root = slot.container.firstElementChild as HTMLElement;
    return root.lastElementChild!.contains(toggle);
  };

  it.each([false, true])("stays the last block of the section, grouped by project: %s", async (grouped) => {
    const slot = await renderSection({ rpc: POSTPONED_BETA });
    const toggle = await slot.findByRole("button", { name: /Отложено: 1/ });
    if (grouped) fireEvent.click(slot.getByRole("button", { name: /По проекту/ }));
    fireEvent.click(toggle);

    expect(lastBlockHolds(slot, toggle)).toBe(true);
  });
});

describe("where a thread opens", () => {
  const OPEN_MODES = /На весь экран|В боковой панели/;

  /** Open the open-mode dropdown from its trigger and choose one of its items. */
  async function pickOpenMode(slot: ReturnType<typeof renderSlot>, label: string): Promise<void> {
    fireEvent.keyDown(await slot.findByRole("button", { name: OPEN_MODES }), { key: "Enter" });
    fireEvent.click(await slot.findByRole("menuitemradio", { name: label }));
  }

  it("offers both modes after the По проекту toggle, full screen ticked by default", async () => {
    const slot = await renderExperimental();
    const trigger = await slot.findByRole("button", { name: "На весь экран" });
    const toggle = slot.getByRole("button", { name: /По проекту/ });
    expect(toggle.compareDocumentPosition(trigger) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    fireEvent.keyDown(trigger, { key: "Enter" });
    const items = await slot.findAllByRole("menuitemradio");
    expect(items.map((item) => item.textContent)).toEqual([
      "Открывать на весь экран",
      "Открывать в боковой панели",
    ]);
    expect(items.map((item) => item.getAttribute("aria-checked"))).toEqual(["true", "false"]);
  });

  it("opens a thread full screen by default", async () => {
    const slot = await renderExperimental();
    fireEvent.click(await slot.findByText("Тред Беты"));
    expect(slot.navigateCalls).toContainEqual({ method: "toThread", threadId: "th_b" });
    expect(slot.sidebarActionCalls).toEqual([]);
  });

  it("opens a thread in a split, as a drag to the right would, once the side panel is chosen", async () => {
    const slot = await renderExperimental();
    await pickOpenMode(slot, "Открывать в боковой панели");
    fireEvent.click(slot.getByText("Тред Беты"));
    expect(slot.sidebarActionCalls).toEqual([
      { method: "open", threadId: "th_b", options: { split: true } },
    ]);
    expect(slot.navigateCalls).not.toContainEqual({ method: "toThread", threadId: "th_b" });
  });

  it("opens a postponed thread in a split too", async () => {
    const slot = await renderExperimental({
      rpc: { listPostponed: () => ({ postponed: [{ threadId: "th_b", at: 1 }] }) },
    });
    await pickOpenMode(slot, "Открывать в боковой панели");
    fireEvent.click(await slot.findByRole("button", { name: /Отложено: 1/ }));
    fireEvent.click(slot.getByText("Тред Беты"));
    expect(slot.sidebarActionCalls).toEqual([
      { method: "open", threadId: "th_b", options: { split: true } },
    ]);
  });

  it("keeps the chosen mode after the section remounts", async () => {
    const first = await renderExperimental();
    await pickOpenMode(first, "Открывать в боковой панели");
    cleanup();

    const second = await renderExperimental();
    expect(await second.findByRole("button", { name: "В боковой панели" })).toBeDefined();
  });
});

describe("the side panel is reused, not stacked", () => {
  it("splits off a side panel again once the one it used is gone", async () => {
    // The test host reports every thread as open in no pane, which is how a closed side panel looks.
    const slot = await renderExperimental();
    fireEvent.keyDown(await slot.findByRole("button", { name: /На весь экран/ }), { key: "Enter" });
    fireEvent.click(await slot.findByRole("menuitemradio", { name: "Открывать в боковой панели" }));
    fireEvent.click(slot.getByText("Тред Беты"));
    fireEvent.click(slot.getByText("Тред Альфы"));
    expect(slot.sidebarActionCalls).toEqual([
      { method: "open", threadId: "th_b", options: { split: true } },
      { method: "open", threadId: "th_a", options: { split: true } },
    ]);
  });
});

describe("worktree mark placement", () => {
  const WORKTREE_ALPHA = {
    ...TWO_PROJECTS,
    threads: [
      idleThread({
        id: "th_a",
        title: "Тред Альфы",
        environment: { id: "env_1", name: null, branchName: "bb/x", workspaceDisplayKind: "managed-worktree" as const },
      }),
    ],
  };
  const precedes = (a: Node, b: Node) =>
    Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

  it("opens the second line, ahead of the project, in the flat queue", async () => {
    const slot = await renderSection({ sidebarThreads: WORKTREE_ALPHA });
    const title = await slot.findByText("Тред Альфы");
    const row = rowOf(slot, "Тред Альфы");
    const mark = within(row).getByRole("img", { name: "Рабочее дерево" });
    // The caption's own text, not the caption element that holds the mark as well.
    const project = within(row).getByText("Альфа").lastChild!;
    expect(project.textContent).toBe("Альфа");
    expect(precedes(mark, project)).toBe(true);
    expect(mark.parentElement).not.toBe(title.parentElement);
  });

  it("closes the first line, right after the title, inside a project group", async () => {
    const slot = await renderSection({ sidebarThreads: WORKTREE_ALPHA });
    fireEvent.click(await slot.findByText("По проекту"));
    const title = slot.getByText("Тред Альфы");
    const mark = within(rowOf(slot, "Тред Альфы")).getByRole("img", { name: "Рабочее дерево" });
    expect(mark.parentElement).toBe(title.parentElement);
    expect(precedes(title, mark)).toBe(true);
  });
});

describe("keyboard from the composer into the queue", () => {
  const rowTitles = (slot: ReturnType<typeof renderSlot>) =>
    slot.getAllByRole("listitem").map((row) => row.querySelector("button")!.textContent);
  const focusedRowText = () => document.activeElement?.closest("li")?.textContent ?? null;

  it("takes the down arrow in an empty composer to the first thread of the queue", async () => {
    const slot = await renderExperimental();
    await slot.findByText("Тред Альфы");
    const editor = mountComposer();
    fireEvent.keyDown(editor, { key: "ArrowDown" });
    expect(focusedRowText()).toContain(rowTitles(slot)[0]);
  });

  it("leaves the down arrow to a composer that holds text", async () => {
    const slot = await renderExperimental();
    await slot.findByText("Тред Альфы");
    const editor = mountComposer("черновик");
    fireEvent.keyDown(editor, { key: "ArrowDown" });
    expect(document.activeElement).toBe(editor);
  });

  it("walks the queue with the down and up arrows, and goes back to the composer from the top", async () => {
    const slot = await renderExperimental();
    await slot.findByText("Тред Альфы");
    const editor = mountComposer();
    const titles = rowTitles(slot);
    fireEvent.keyDown(editor, { key: "ArrowDown" });
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    expect(focusedRowText()).toContain(titles[1]);
    fireEvent.keyDown(document.activeElement!, { key: "ArrowUp" });
    expect(focusedRowText()).toContain(titles[0]);
    fireEvent.keyDown(document.activeElement!, { key: "ArrowUp" });
    expect(document.activeElement).toBe(editor);
  });

  it("goes back to the composer on Escape", async () => {
    const slot = await renderExperimental();
    await slot.findByText("Тред Альфы");
    const editor = mountComposer();
    fireEvent.keyDown(editor, { key: "ArrowDown" });
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(document.activeElement).toBe(editor);
  });

  it.each(["Enter", "ArrowRight"])("opens the selected thread on %s, the way a click would", async (key) => {
    const slot = await renderExperimental();
    await slot.findByText("Тред Альфы");
    const editor = mountComposer();
    const first = rowTitles(slot)[0]!;
    fireEvent.keyDown(editor, { key: "ArrowDown" });
    fireEvent.keyDown(document.activeElement!, { key });
    const threadId = TWO_PROJECTS.threads.find((thread) => first.includes(thread.title!))!.id;
    expect(slot.navigateCalls).toContainEqual({ method: "toThread", threadId });
  });

  it("ignores the empty composer of a thread in the next pane of a split window", async () => {
    const slot = await renderExperimental();
    await slot.findByText("Тред Альфы");
    const homePane = document.createElement("div");
    document.body.append(homePane);
    const homeEditor = mountComposer();
    homePane.append(homeEditor.parentElement!, slot.container);
    const threadEditor = mountComposer();
    fireEvent.keyDown(threadEditor, { key: "ArrowDown" });
    expect(document.activeElement).toBe(threadEditor);
    homePane.remove();
  });

  it("stays inside the focused project group", async () => {
    const slot = await renderExperimental();
    fireEvent.click(await slot.findByText("По проекту"));
    const editor = mountComposer();
    fireEvent.keyDown(editor, { key: "ArrowDown" });
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    const last = focusedRowText();
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    expect(focusedRowText()).toBe(last);
    expect(last).not.toContain("Тред Беты");
  });
});

describe("the side panel does not catch the left panel's clicks", () => {
  it("hands pane focus back to the home screen before a thread row of the left panel is pressed", async () => {
    const slot = await renderExperimental();
    fireEvent.keyDown(await slot.findByRole("button", { name: /На весь экран/ }), { key: "Enter" });
    fireEvent.click(await slot.findByRole("menuitemradio", { name: "Открывать в боковой панели" }));
    const sectionRoot = slot.container.firstElementChild!;
    const reached: EventTarget[] = [];
    slot.container.addEventListener("pointerdown", (event) => reached.push(event.target!));
    const sidebarRow = document.createElement("div");
    sidebarRow.setAttribute("data-sidebar-thread-id", "th_x");
    document.body.append(sidebarRow);

    fireEvent.pointerDown(sidebarRow);
    expect(reached).toEqual([sectionRoot]);
    sidebarRow.remove();
  });

  it("leaves the left panel's presses alone while threads open full screen", async () => {
    const slot = await renderExperimental();
    await slot.findByText("Тред Альфы");
    const reached: EventTarget[] = [];
    slot.container.addEventListener("pointerdown", (event) => reached.push(event.target!));
    const sidebarRow = document.createElement("div");
    sidebarRow.setAttribute("data-sidebar-thread-id", "th_x");
    document.body.append(sidebarRow);

    fireEvent.pointerDown(sidebarRow);
    expect(reached).toEqual([]);
    sidebarRow.remove();
  });

  it("leaves every other press alone", async () => {
    const slot = await renderExperimental();
    fireEvent.keyDown(await slot.findByRole("button", { name: /На весь экран/ }), { key: "Enter" });
    fireEvent.click(await slot.findByRole("menuitemradio", { name: "Открывать в боковой панели" }));
    const reached: EventTarget[] = [];
    slot.container.addEventListener("pointerdown", (event) => reached.push(event.target!));
    const elsewhere = document.createElement("div");
    document.body.append(elsewhere);

    fireEvent.pointerDown(elsewhere);
    expect(reached).toEqual([]);
    elsewhere.remove();
  });
});

describe("keyboard from the side panel's composer back to the queue", () => {
  /** A composer shell with an editable box holding `text`, the caret placed at `caret`. */
  function composer(text: string): HTMLElement {
    const shell = document.createElement("div");
    shell.setAttribute("data-app-composer", "");
    const editor = document.createElement("div");
    editor.setAttribute("contenteditable", "true");
    editor.tabIndex = 0;
    editor.textContent = text;
    shell.append(editor);
    return editor;
  }

  function placeCaret(editor: HTMLElement, offset: number): void {
    editor.focus();
    const text = editor.firstChild;
    const selection = window.getSelection()!;
    if (text === null) selection.collapse(editor, 0);
    else selection.collapse(text, offset);
  }

  /** The home pane holds its own composer and the section; the thread's pane holds another composer. */
  async function splitWindow() {
    const slot = await renderExperimental();
    await slot.findByText("Тред Альфы");
    const homePane = document.createElement("div");
    const threadPane = document.createElement("div");
    document.body.append(homePane, threadPane);
    homePane.append(composer("").parentElement!, slot.container);
    const threadEditor = composer("ответ");
    threadPane.append(threadEditor.parentElement!);
    return { slot, threadEditor, cleanUp: () => [homePane, threadPane].forEach((pane) => pane.remove()) };
  }

  const focusedRowText = () => document.activeElement?.closest("li")?.textContent ?? null;

  it("focuses the row of the thread opened in the side panel on the left arrow at the start of its composer", async () => {
    const { slot, threadEditor, cleanUp } = await splitWindow();
    fireEvent.keyDown(slot.getByRole("button", { name: /На весь экран/ }), { key: "Enter" });
    fireEvent.click(await slot.findByRole("menuitemradio", { name: "Открывать в боковой панели" }));
    fireEvent.click(slot.getByText("Тред Беты"));

    placeCaret(threadEditor, 0);
    fireEvent.keyDown(threadEditor, { key: "ArrowLeft" });
    expect(focusedRowText()).toContain("Тред Беты");
    cleanUp();
  });

  it("focuses the first row when no thread was opened from the section", async () => {
    const { slot, threadEditor, cleanUp } = await splitWindow();
    const first = slot.getAllByRole("listitem")[0]!.textContent;
    placeCaret(threadEditor, 0);
    fireEvent.keyDown(threadEditor, { key: "ArrowLeft" });
    expect(focusedRowText()).toBe(first);
    cleanUp();
  });

  it("leaves the left arrow to the composer when the caret is past the start", async () => {
    const { threadEditor, cleanUp } = await splitWindow();
    placeCaret(threadEditor, 2);
    fireEvent.keyDown(threadEditor, { key: "ArrowLeft" });
    expect(document.activeElement).toBe(threadEditor);
    cleanUp();
  });
});

describe("the side panel and keyboard stay off until switched on in the settings", () => {
  it("offers no choice of where a thread opens", async () => {
    const slot = await renderSection();
    await slot.findByText("Тред Альфы");
    expect(slot.queryByRole("button", { name: /На весь экран|В боковой панели/ })).toBeNull();
  });

  it("opens full screen even when the side panel was chosen while the setting was on", async () => {
    const on = await renderExperimental();
    fireEvent.keyDown(await on.findByRole("button", { name: /На весь экран/ }), { key: "Enter" });
    fireEvent.click(await on.findByRole("menuitemradio", { name: "Открывать в боковой панели" }));
    cleanup();

    const off = await renderSection();
    fireEvent.click(await off.findByText("Тред Беты"));
    expect(off.navigateCalls).toContainEqual({ method: "toThread", threadId: "th_b" });
    expect(off.sidebarActionCalls).toEqual([]);
  });

  it("leaves the down arrow of an empty composer alone", async () => {
    const slot = await renderSection();
    await slot.findByText("Тред Альфы");
    const shell = document.createElement("div");
    shell.setAttribute("data-app-composer", "");
    const editor = document.createElement("div");
    editor.setAttribute("contenteditable", "true");
    editor.tabIndex = 0;
    shell.append(editor);
    document.body.append(shell);
    editor.focus();

    fireEvent.keyDown(editor, { key: "ArrowDown" });
    expect(document.activeElement).toBe(editor);
    shell.remove();
  });

  it("does not press the section when a thread row of the left panel is pressed", async () => {
    const slot = await renderSection();
    await slot.findByText("Тред Альфы");
    const reached: EventTarget[] = [];
    slot.container.addEventListener("pointerdown", (event) => reached.push(event.target!));
    const sidebarRow = document.createElement("div");
    sidebarRow.setAttribute("data-sidebar-thread-id", "th_x");
    document.body.append(sidebarRow);

    fireEvent.pointerDown(sidebarRow);
    expect(reached).toEqual([]);
    sidebarRow.remove();
  });
});

describe("on a touch screen", () => {
  /** How wide the phone's screen is, in px: the swipes below start at x 300, on its right-edge strip. */
  const PHONE_WIDTH = 320;

  /** A coarse pointer, the way a phone or tablet reports itself, on a phone-wide screen. */
  function stubTouchScreen(): void {
    vi.stubGlobal("innerWidth", PHONE_WIDTH);
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
  }

  /** The part of a row that slides under the finger, and the tray of actions behind it. */
  const panelOf = (row: HTMLElement) => row.querySelector<HTMLElement>("[data-swipe-row]")!;
  const trayOf = (row: HTMLElement) => row.querySelector<HTMLElement>("[data-swipe-tray]")!;

  /** A finger, the way a touch screen reports one. */
  const TOUCH = { pointerType: "touch", pointerId: 1, isPrimary: true };

  /** Which layer a part of the row is painted on: the `z-<n>` its class sets, ground floor by default. */
  function layerOf(element: HTMLElement): number {
    const match = /(?:^|\s)z-(\d+)(?:\s|$)/.exec(element.className);
    return match === null ? 0 : Number(match[1]);
  }

  /** Put a finger on the row and move it there, without lifting it. */
  function startSwipe(row: HTMLElement, fromX: number, toX: number, dy = 0): HTMLElement {
    const target = panelOf(row);
    fireEvent.pointerDown(target, { ...TOUCH, clientX: fromX, clientY: 100 });
    fireEvent.pointerMove(target, { ...TOUCH, clientX: toX, clientY: 100 + dy });
    return target;
  }

  /** The browser's own touchmove — the one that turns into a page scroll unless it is stopped. */
  const touchMoves = (row: HTMLElement): boolean =>
    panelOf(row).dispatchEvent(new Event("touchmove", { bubbles: true, cancelable: true }));

  /** Drag a finger across a row from `fromX` to `toX`, `dy` down along the way, and lift it. */
  function swipe(row: HTMLElement, fromX: number, toX: number, dy = 0): void {
    const target = startSwipe(row, fromX, toX, dy);
    fireEvent.pointerMove(target, { ...TOUCH, clientX: toX, clientY: 100 + dy });
    fireEvent.pointerUp(target, { ...TOUCH, clientX: toX, clientY: 100 + dy });
  }

  beforeEach(stubTouchScreen);

  it("hides the tray under the row's own fill until the row is swiped", async () => {
    const slot = await renderSection();
    await slot.findByText("Тред Альфы");
    const row = rowOf(slot, "Тред Альфы");

    expect(panelOf(row).className).toContain("bg-background");
    expect(layerOf(panelOf(row))).toBeGreaterThan(layerOf(trayOf(row)));
  });

  it("gives the tray a storey of its own, where its lifted buttons stay put", async () => {
    const slot = await renderSection();
    await slot.findByText("Тред Альфы");
    // The buttons in the tray are lifted over the row's hit area; only a
    // storey of the tray's own keeps that lift from climbing over the fill.
    expect(trayOf(rowOf(slot, "Тред Альфы")).className).toMatch(/\bz-\d+\b/);
  });

  it("leaves hover rules off a row, so its divider never goes without the fill", async () => {
    const slot = await renderSection();
    await slot.findByText("Тред Альфы");
    expect(rowOf(slot, "Тред Альфы").className).not.toContain("hover:");
  });

  it("holds a horizontal swipe against the page scroll", async () => {
    const slot = await renderSection();
    await slot.findByText("Тред Альфы");
    const row = rowOf(slot, "Тред Альфы");
    startSwipe(row, 300, 280);

    expect(touchMoves(row)).toBe(false);
  });

  it("leaves an upright drag to the page scroll, stopping nothing", async () => {
    const slot = await renderSection();
    await slot.findByText("Тред Альфы");
    const row = rowOf(slot, "Тред Альфы");
    startSwipe(row, 300, 296, 60);

    expect(touchMoves(row)).toBe(true);
  });

  it("decides the axis once, so a finger that leaves the row keeps swiping, as before", async () => {
    const slot = await renderSection();
    await slot.findByText("Тред Альфы");
    const target = startSwipe(rowOf(slot, "Тред Альфы"), 300, 286);
    fireEvent.pointerMove(target, { ...TOUCH, clientX: 150, clientY: 340 });
    fireEvent.pointerUp(target, { ...TOUCH, clientX: 150, clientY: 340 });

    expect(
      within(rowOf(slot, "Тред Альфы")).getByRole("button", { name: "Отложить" }),
    ).toBeDefined();
  });

  it("keeps a row's Postpone and Archive out of reach until it is swiped", async () => {
    const slot = await renderSection();
    const row = rowOf(slot, await slot.findByText("Тред Альфы").then((el) => el.textContent!));
    expect(within(row).queryByRole("button", { name: "Отложить" })).toBeNull();
    expect(within(row).queryByRole("button", { name: "Архивировать" })).toBeNull();
  });

  it("reveals them on a swipe from right to left, and they work", async () => {
    const slot = await renderSection();
    await slot.findByText("Тред Альфы");
    swipe(rowOf(slot, "Тред Альфы"), 300, 150);

    expect(within(rowOf(slot, "Тред Альфы")).getByRole("button", { name: "Архивировать" })).toBeDefined();
    fireEvent.click(within(rowOf(slot, "Тред Альфы")).getByRole("button", { name: "Отложить" }));
    expect(slot.rpcCalls).toContainEqual({
      method: "setPostponed",
      input: { threadId: "th_a", postponed: true },
    });
  });

  it("does not open the thread at the end of a swipe", async () => {
    const slot = await renderSection();
    await slot.findByText("Тред Альфы");
    swipe(rowOf(slot, "Тред Альфы"), 300, 150);
    fireEvent.click(slot.getByText("Тред Альфы"));
    expect(slot.navigateCalls).toEqual([]);
  });

  it("closes a swiped row on a tap instead of opening its thread", async () => {
    const slot = await renderSection();
    await slot.findByText("Тред Альфы");
    swipe(rowOf(slot, "Тред Альфы"), 300, 150);
    fireEvent.click(slot.getByText("Тред Альфы"));
    fireEvent.click(slot.getByText("Тред Альфы"));

    expect(within(rowOf(slot, "Тред Альфы")).queryByRole("button", { name: "Отложить" })).toBeNull();
    expect(slot.navigateCalls).toEqual([]);
  });

  it("leaves a mostly vertical drag to the page scroll", async () => {
    const slot = await renderSection();
    await slot.findByText("Тред Альфы");
    swipe(rowOf(slot, "Тред Альфы"), 300, 285, 120);
    expect(within(rowOf(slot, "Тред Альфы")).queryByRole("button", { name: "Отложить" })).toBeNull();
  });

  it("keeps a single row open: swiping another closes the first", async () => {
    const slot = await renderSection();
    await slot.findByText("Тред Альфы");
    swipe(rowOf(slot, "Тред Альфы"), 300, 150);
    swipe(rowOf(slot, "Тред Беты"), 300, 150);
    expect(within(rowOf(slot, "Тред Альфы")).queryByRole("button", { name: "Отложить" })).toBeNull();
    expect(within(rowOf(slot, "Тред Беты")).getByRole("button", { name: "Отложить" })).toBeDefined();
  });

  it("opens a thread on a plain tap", async () => {
    const slot = await renderSection();
    fireEvent.click(await slot.findByText("Тред Беты"));
    expect(slot.navigateCalls).toContainEqual({ method: "toThread", threadId: "th_b" });
  });

  /** A finger put down on something and lifted: a tap, the way a touch screen reports one. */
  function tap(target: HTMLElement): void {
    fireEvent.pointerDown(target, { ...TOUCH, clientX: 10, clientY: 10 });
    fireEvent.pointerUp(target, { ...TOUCH, clientX: 10, clientY: 10 });
    fireEvent.click(target);
  }

  it("puts an open row away when a finger lands outside it", async () => {
    const slot = await renderSection();
    await slot.findByText("Тред Альфы");
    swipe(rowOf(slot, "Тред Альфы"), 300, 150);
    tap(slot.getByText("Тред Беты"));

    expect(within(rowOf(slot, "Тред Альфы")).queryByRole("button", { name: "Отложить" })).toBeNull();
  });

  it("spends that touch on closing, opening no thread with it", async () => {
    const slot = await renderSection();
    await slot.findByText("Тред Альфы");
    swipe(rowOf(slot, "Тред Альфы"), 300, 150);
    tap(slot.getByText("Тред Беты"));

    expect(slot.navigateCalls).toEqual([]);
  });

  it("leaves a finger inside the open row to the row's own buttons", async () => {
    const slot = await renderSection();
    await slot.findByText("Тред Альфы");
    swipe(rowOf(slot, "Тред Альфы"), 300, 150);
    const postpone = within(rowOf(slot, "Тред Альфы")).getByRole("button", { name: "Отложить" });
    tap(postpone);

    expect(slot.rpcCalls).toContainEqual({
      method: "setPostponed",
      input: { threadId: "th_a", postponed: true },
    });
  });

  it("puts an open row away when the list is scrolled", async () => {
    const slot = await renderSection();
    await slot.findByText("Тред Альфы");
    swipe(rowOf(slot, "Тред Альфы"), 300, 150);
    fireEvent.scroll(slot.getAllByRole("list")[0]!);

    expect(within(rowOf(slot, "Тред Альфы")).queryByRole("button", { name: "Отложить" })).toBeNull();
  });

  it("puts an open row away when a thread opens from the keyboard", async () => {
    const slot = await renderExperimental();
    await slot.findByText("Тред Альфы");
    swipe(rowOf(slot, "Тред Альфы"), 300, 150);
    // The click a touch screen sends at the end of the drag, which the row swallows.
    fireEvent.click(slot.getByText("Тред Альфы"));
    const editor = mountComposer();
    fireEvent.keyDown(editor, { key: "ArrowDown" });
    fireEvent.keyDown(document.activeElement!, { key: "Enter" });

    expect(within(rowOf(slot, "Тред Альфы")).queryByRole("button", { name: "Отложить" })).toBeNull();
  });

  describe("where a sideways swipe starts", () => {
    // The right-edge strip of a 320 px screen starts at x 272.
    const MIDDLE = 200;
    const isOpen = (row: HTMLElement) =>
      within(row).queryByRole("button", { name: "Отложить" }) !== null;

    it("leaves a swipe from the middle of the screen to the project slides, over a row too", async () => {
      const slot = await renderSection();
      await slot.findByText("Тред Альфы");
      const row = rowOf(slot, "Тред Альфы");
      startSwipe(row, MIDDLE, MIDDLE - 120);

      expect(touchMoves(row)).toBe(true);
      fireEvent.pointerUp(panelOf(row), { ...TOUCH, clientX: MIDDLE - 120, clientY: 100 });
      expect(isOpen(rowOf(slot, "Тред Альфы"))).toBe(false);
    });

    it("lets the row slide the page's way, not stirring it, while the slides turn", async () => {
      const slot = await renderSection();
      await slot.findByText("Тред Альфы");
      const row = rowOf(slot, "Тред Альфы");
      startSwipe(row, MIDDLE, MIDDLE - 120);

      expect(panelOf(row).style.transform).toBe("translateX(0px)");
      expect(panelOf(row).className).not.toContain("touch-pan-y");
    });

    it("opens the row's actions on a swipe to the left from the right-edge strip", async () => {
      const slot = await renderSection();
      await slot.findByText("Тред Альфы");
      swipe(rowOf(slot, "Тред Альфы"), 290, 150);

      expect(isOpen(rowOf(slot, "Тред Альфы"))).toBe(true);
    });

    it("holds a swipe to the left from the strip from its first pixel, so the slides stay put", async () => {
      const slot = await renderSection();
      await slot.findByText("Тред Альфы");
      const row = rowOf(slot, "Тред Альфы");
      startSwipe(row, 300, 299);

      expect(touchMoves(row)).toBe(false);
    });

    it("gives a swipe to the right from the strip of a closed row to the slides", async () => {
      const slot = await renderSection();
      await slot.findByText("Тред Альфы");
      const row = rowOf(slot, "Тред Альфы");
      startSwipe(row, 290, 310);

      expect(touchMoves(row)).toBe(true);
    });

    it("closes an open row on a swipe to the right started anywhere on it", async () => {
      const slot = await renderSection();
      await slot.findByText("Тред Альфы");
      swipe(rowOf(slot, "Тред Альфы"), 300, 150);
      const row = rowOf(slot, "Тред Альфы");
      startSwipe(row, MIDDLE - 100, MIDDLE);

      expect(touchMoves(row)).toBe(false);
      fireEvent.pointerUp(panelOf(row), { ...TOUCH, clientX: MIDDLE, clientY: 100 });
      expect(isOpen(rowOf(slot, "Тред Альфы"))).toBe(false);
    });
  });

  describe("the row's actions", () => {
    const actionsOf = async (slot: ReturnType<typeof renderSlot>) => {
      await slot.findByText("Тред Альфы");
      swipe(rowOf(slot, "Тред Альфы"), 300, 150);
      const row = rowOf(slot, "Тред Альфы");
      return {
        postpone: within(row).getByRole("button", { name: "Отложить" }),
        archive: within(row).getByRole("button", { name: "Архивировать" }),
      };
    };

    it("are 40 px squares with rounded corners", async () => {
      const { postpone, archive } = await actionsOf(await renderSection());
      for (const button of [postpone, archive]) {
        expect(button.className).toMatch(/\bsize-10\b/);
        expect(button.className).toMatch(/\brounded-md\b/);
      }
    });

    it("stand on a visible fill: Postpone grey, Archive red", async () => {
      const { postpone, archive } = await actionsOf(await renderSection());
      expect(postpone.className).toContain("bg-secondary");
      expect(archive.className).toContain("bg-destructive");
    });
  });

  describe("hover preview", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("never pops the conversation up, whatever the delay", async () => {
      const slot = await renderSection({ settings: { previewDelaySeconds: "1" } });
      fireEvent.pointerEnter(slot.getAllByRole("listitem")[0]!, { pointerType: "mouse" });
      await act(async () => {
        vi.advanceTimersByTime(60_000);
      });
      expect(slot.queryByTestId("bb-thread-chat")).toBeNull();
    });
  });
});

describe("sort toggle", () => {
  const OLD_AND_NEW = {
    sidebarThreads: {
      ...TWO_PROJECTS,
      threads: [
        idleThread({ id: "th_old", title: "Старый", latestAttentionAt: 1000 }),
        idleThread({ id: "th_new", title: "Новый", latestAttentionAt: 5000 }),
      ],
    },
  };

  function firstTitle(slot: ReturnType<typeof renderSlot>): string {
    const first = slot.getAllByRole("listitem")[0]!;
    return within(first).getAllByRole("button")[0]!.textContent ?? "";
  }

  it("stands as an icon that names the current order and opens no menu", async () => {
    const slot = await renderSection();
    const toggle = await slot.findByRole("button", { name: "Сортировка: Дольше ждут" });
    expect(toggle.textContent).toBe("");
    expect(toggle.getAttribute("aria-haspopup")).toBeNull();
  });

  it("turns the order around on one press, without a menu", async () => {
    const slot = await renderSection(OLD_AND_NEW);
    await slot.findByText("Старый");
    expect(firstTitle(slot)).toContain("Старый");

    fireEvent.click(slot.getByRole("button", { name: "Сортировка: Дольше ждут" }));

    expect(firstTitle(slot)).toContain("Новый");
    expect(slot.getByRole("button", { name: "Сортировка: Свежие" })).toBeDefined();
    expect(slot.queryByRole("menu")).toBeNull();
    expect(slot.queryAllByRole("menuitemradio")).toEqual([]);
  });

  it("turns it back on the next press", async () => {
    const slot = await renderSection(OLD_AND_NEW);
    await slot.findByText("Старый");
    fireEvent.click(slot.getByRole("button", { name: "Сортировка: Дольше ждут" }));
    fireEvent.click(slot.getByRole("button", { name: "Сортировка: Свежие" }));

    expect(firstTitle(slot)).toContain("Старый");
    expect(slot.getByRole("button", { name: "Сортировка: Дольше ждут" })).toBeDefined();
  });

  it("shows the other arrow once the order is turned", async () => {
    const slot = await renderSection();
    const before = (await slot.findByRole("button", { name: "Сортировка: Дольше ждут" })).innerHTML;
    fireEvent.click(slot.getByRole("button", { name: "Сортировка: Дольше ждут" }));
    const after = slot.getByRole("button", { name: "Сортировка: Свежие" }).innerHTML;
    expect(after).not.toBe(before);
  });

  it("keeps the turned order after the section remounts", async () => {
    const first = await renderSection();
    fireEvent.click(await first.findByRole("button", { name: "Сортировка: Дольше ждут" }));
    cleanup();

    const second = await renderSection();
    expect(await second.findByRole("button", { name: "Сортировка: Свежие" })).toBeDefined();
  });
});

describe("running threads toggle", () => {
  const WITH_RUNNING = {
    sidebarThreads: {
      ...TWO_PROJECTS,
      threads: [
        idleThread({ id: "th_idle", title: "Ждёт", latestAttentionAt: 1000 }),
        idleThread({ id: "th_run", title: "Работает сейчас", indicator: "runtime", latestAttentionAt: 2000 }),
        idleThread({
          id: "th_bg",
          title: "Фоновый агент",
          latestAttentionAt: 3000,
          activity: { workflows: 0, backgroundAgents: 1, backgroundCommands: 0, planMode: 0, goals: 0 },
        }),
      ],
    },
  };

  it("stands left of the project grouping", async () => {
    const slot = await renderSection(WITH_RUNNING);
    const toggle = await slot.findByRole("button", { name: "Работающие треды: скрыты" });
    const grouping = slot.getByRole("button", { name: /По проекту/ });
    expect(toggle.compareDocumentPosition(grouping) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("offers no archive on a thread that is still working", async () => {
    const slot = await renderSection(WITH_RUNNING);
    fireEvent.click(await slot.findByRole("button", { name: "Работающие треды: скрыты" }));
    const row = slot.getByText("Работает сейчас").closest("li")!;
    expect(within(row).queryByLabelText("Архивировать")).toBeNull();
  });

  it("puts them away again on the next press", async () => {
    const slot = await renderSection(WITH_RUNNING);
    fireEvent.click(await slot.findByRole("button", { name: "Работающие треды: скрыты" }));
    fireEvent.click(slot.getByRole("button", { name: "Работающие треды: показаны" }));
    expect(slot.queryByText("Работает сейчас")).toBeNull();
  });

  it("keeps the choice after the section remounts", async () => {
    const first = await renderSection(WITH_RUNNING);
    fireEvent.click(await first.findByRole("button", { name: "Работающие треды: скрыты" }));
    cleanup();

    const second = await renderSection(WITH_RUNNING);
    expect(await second.findByText("Работает сейчас")).toBeDefined();
  });

  it("hides running threads at first, counts only the waiting ones, and shows the icon crossed out", async () => {
    const slot = await renderSection(WITH_RUNNING);
    await slot.findByText("Ждёт");
    expect(slot.queryByText("Работает сейчас")).toBeNull();
    const toggle = slot.getByRole("button", { name: "Работающие треды: скрыты" });
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    expect(slot.getByRole("heading", { name: /Threads: 1/ })).toBeDefined();
  });

  it("brings running threads into the list and the count on a press, each marked as working", async () => {
    const slot = await renderSection(WITH_RUNNING);
    fireEvent.click(await slot.findByRole("button", { name: "Работающие треды: скрыты" }));

    expect(slot.getByText("Работает сейчас")).toBeDefined();
    expect(slot.getByText("Фоновый агент")).toBeDefined();
    const toggle = slot.getByRole("button", { name: "Работающие треды: показаны" });
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    expect(slot.getAllByRole("img", { name: "Работает" })).toHaveLength(2);
    expect(slot.getByRole("heading", { name: /Threads: 3/ })).toBeDefined();
  });
});

describe("time on a working thread", () => {
  const RUNNING_AND_WAITING = {
    sidebarThreads: {
      ...TWO_PROJECTS,
      threads: [
        idleThread({ id: "th_idle", title: "Ждёт", latestAttentionAt: 1000 }),
        idleThread({ id: "th_run", title: "Работает сейчас", indicator: "runtime", latestAttentionAt: 1000 }),
      ],
    },
  };

  it("shows no time next to the spinner of a working thread, and keeps it on a waiting one", async () => {
    const slot = await renderSection(RUNNING_AND_WAITING);
    fireEvent.click(await slot.findByRole("button", { name: "Работающие треды: скрыты" }));
    const time = formatWaitingSince(Date.now(), 1000);

    expect(within(rowOf(slot, "Ждёт")).getByText(time)).toBeDefined();
    expect(within(rowOf(slot, "Работает сейчас")).queryByText(time)).toBeNull();
    expect(within(rowOf(slot, "Работает сейчас")).getByRole("img", { name: "Работает" })).toBeDefined();
  });
});

describe("sort icon", () => {
  // The icon's horizontal bars, top to bottom, as their lengths: a sort icon
  // draws the queue's order as bars that shrink or grow down the list.
  function barLengths(button: HTMLElement): number[] {
    const bars = [...button.querySelectorAll("path")].flatMap((path) => {
      const bar = /^M([\d.]+) ([\d.]+)(?:H([\d.]+)|L([\d.]+) ([\d.]+))$/.exec(
        path.getAttribute("d") ?? "",
      );
      if (bar === null) return [];
      const [, x1, y1, h, lx, ly] = bar;
      if (h === undefined && Math.abs(Number(ly) - Number(y1)) > 0.01) return [];
      return [{ y: Number(y1), length: Math.abs(Number(h ?? lx) - Number(x1)) }];
    });
    return bars.sort((a, b) => a.y - b.y).map((bar) => bar.length);
  }

  const shrinking = (lengths: number[]) => lengths.every((l, i) => i === 0 || l < lengths[i - 1]!);
  const growing = (lengths: number[]) => lengths.every((l, i) => i === 0 || l > lengths[i - 1]!);

  it("draws the longest waits first as bars that shrink down the list", async () => {
    const slot = await renderSection();
    const lengths = barLengths(await slot.findByRole("button", { name: "Сортировка: Дольше ждут" }));
    expect(lengths.length).toBeGreaterThanOrEqual(3);
    expect(shrinking(lengths)).toBe(true);
  });

  it("draws the newest first as bars that grow down the list", async () => {
    const slot = await renderSection();
    fireEvent.click(await slot.findByRole("button", { name: "Сортировка: Дольше ждут" }));
    const lengths = barLengths(slot.getByRole("button", { name: "Сортировка: Свежие" }));
    expect(lengths.length).toBeGreaterThanOrEqual(3);
    expect(growing(lengths)).toBe(true);
  });
});

describe("a thread with only a background command", () => {
  const WITH_SERVER = {
    sidebarThreads: {
      ...TWO_PROJECTS,
      threads: [
        idleThread({
          id: "th_server",
          title: "Поднят сервер",
          indicator: "background-command",
          activity: { workflows: 0, backgroundAgents: 0, backgroundCommands: 1, planMode: 0, goals: 0 },
        }),
        idleThread({
          id: "th_busy",
          title: "Работает с сервером",
          indicator: "runtime",
          activity: { workflows: 0, backgroundAgents: 0, backgroundCommands: 1, planMode: 0, goals: 0 },
        }),
      ],
    },
  };

  it("stands in the queue while running threads are hidden", async () => {
    const slot = await renderSection(WITH_SERVER);
    expect(await slot.findByText("Поднят сервер")).toBeDefined();
    expect(slot.queryByText("Работает с сервером")).toBeNull();
    expect(slot.getByRole("button", { name: "Работающие треды: скрыты" })).toBeDefined();
  });

  it("marks its row as a running process, not as working", async () => {
    const slot = await renderSection(WITH_SERVER);
    const row = (await slot.findByText("Поднят сервер")).closest("li")!;
    const mark = within(row).getByRole("img", { name: "Запущен фоновый процесс" });
    expect(mark.innerHTML).not.toContain("animate-spin");
    expect(within(row).queryByRole("img", { name: "Работает" })).toBeNull();
  });

  it("offers no archive, which would cut the running process short", async () => {
    const slot = await renderSection(WITH_SERVER);
    const row = (await slot.findByText("Поднят сервер")).closest("li")!;
    expect(within(row).queryByLabelText("Архивировать")).toBeNull();
  });

  it("keeps the working mark on a thread that also runs a turn", async () => {
    const slot = await renderSection(WITH_SERVER);
    fireEvent.click(await slot.findByRole("button", { name: "Работающие треды: скрыты" }));
    const row = slot.getByText("Работает с сервером").closest("li")!;
    expect(within(row).getByRole("img", { name: "Работает" })).toBeDefined();
  });
});

describe("the project slide follows the home composer", () => {
  // jsdom scrolls nothing: the scrolling is recorded instead.
  const scrollIntoView = vi.fn();
  const scrollTo = vi.fn();

  // The whole test page stands for bb's new-thread screen, where the home composer lives.
  beforeEach(() => {
    Object.defineProperty(Element.prototype, "scrollIntoView", { configurable: true, writable: true, value: scrollIntoView });
    Object.defineProperty(Element.prototype, "scrollTo", { configurable: true, writable: true, value: scrollTo });
    document.body.setAttribute("data-panel-id", "root-compose-main-panel");
  });

  afterEach(() => {
    scrollIntoView.mockReset();
    scrollTo.mockReset();
    delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    delete (Element.prototype as { scrollTo?: unknown }).scrollTo;
    document.body.removeAttribute("data-panel-id");
  });

  /** The plugin's surface inside bb's new-thread composer, set to `projectId`. */
  async function renderInComposer(projectId: string | null): Promise<ReturnType<typeof renderSlot>> {
    const app = await loadPluginApp(() => import("./app"));
    const surfaces = app.composerCustomizations.flatMap((customization) => customization.banners ?? []);
    return renderSlot(surfaces[0]!, {}, { composer: { scope: { kind: "new-thread", projectId } } });
  }

  const pressed = (slot: ReturnType<typeof renderSlot>, name: RegExp) =>
    slot.getByRole("button", { name }).getAttribute("aria-pressed");

  const composerRequests = (slot: ReturnType<typeof renderSlot>) =>
    slot.sidebarActionCalls.filter((call) => call.method === "openNewThread");

  it("shows the slide of the project the composer was set to from outside — New thread on a project", async () => {
    const slot = await renderSection();
    fireEvent.click(await slot.findByRole("button", { name: /По проекту/ }));

    await renderInComposer("p_beta");

    expect(pressed(slot, /Бета/)).toBe("true");
    expect(pressed(slot, /Альфа/)).toBe("false");
  });

  it("does not hand the followed project back to the composer", async () => {
    const slot = await renderSection();
    fireEvent.click(await slot.findByRole("button", { name: /По проекту/ }));

    await renderInComposer("p_beta");

    expect(composerRequests(slot)).toHaveLength(1);
  });

  it("follows the composer when it changes project while Home stays open", async () => {
    const slot = await renderSection();
    fireEvent.click(await slot.findByRole("button", { name: /По проекту/ }));
    const composer = await renderInComposer("p_alpha");

    await composer.setComposerScope({ kind: "new-thread", projectId: "p_beta" });

    expect(pressed(slot, /Бета/)).toBe("true");
  });

  it("keeps the slide in view for a project with no threads in the section", async () => {
    const slot = await renderSection();
    fireEvent.click(await slot.findByRole("button", { name: /По проекту/ }));

    await renderInComposer("p_gamma");

    expect(pressed(slot, /Альфа/)).toBe("true");
  });

  it("keeps the slide in view while the composer has no project", async () => {
    const slot = await renderSection();
    fireEvent.click(await slot.findByRole("button", { name: /По проекту/ }));

    await renderInComposer(null);

    expect(pressed(slot, /Альфа/)).toBe("true");
  });

  it("scrolls the slide in along the track alone, leaving bb's page where it is", async () => {
    const slot = await renderSection();
    fireEvent.click(await slot.findByRole("button", { name: /По проекту/ }));
    const track = slot.getByRole("group", { name: "Бета" }).parentElement!;

    await renderInComposer("p_beta");

    expect(scrollTo.mock.instances).toEqual([track]);
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it("does not scroll for a project with no threads in the section", async () => {
    const slot = await renderSection();
    fireEvent.click(await slot.findByRole("button", { name: /По проекту/ }));

    await renderInComposer("p_gamma");

    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("does not hear a new-thread composer that stands off Home, such as a chat another plugin embeds", async () => {
    const slot = await renderSection();
    fireEvent.click(await slot.findByRole("button", { name: /По проекту/ }));
    document.body.removeAttribute("data-panel-id");

    await renderInComposer("p_beta");

    expect(pressed(slot, /Альфа/)).toBe("true");
  });
});
