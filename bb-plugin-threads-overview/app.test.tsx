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
  it("names the section with its count in the row of the sort buttons", async () => {
    const slot = await renderSection();
    const heading = await slot.findByRole("heading", { name: "Требуют внимания: 3" });
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

  it("focuses the first group and dims the rest", async () => {
    const slot = await renderSection();
    fireEvent.click(await slot.findByRole("button", { name: /По проекту/ }));

    expect(slot.getByLabelText("Альфа").className).toContain("opacity-100");
    expect(slot.getByLabelText("Бета").className).toContain("opacity-40");
  });

  it("keeps the row actions working inside the focused group", async () => {
    const slot = await renderSection();
    fireEvent.click(await slot.findByRole("button", { name: /По проекту/ }));
    const alpha = slot.getByRole("group", { name: "Альфа" });
    const row = within(alpha).getByText("Тред Альфы").closest("li") as HTMLElement;

    fireEvent.click(within(row).getByLabelText("Архивировать"));
    expect(slot.sidebarActionCalls).toEqual([
      { method: "archive", threadId: "th_a" },
    ]);
  });

  it("puts the project buttons on a row of their own, under the heading and its controls", async () => {
    const slot = await renderSection();
    fireEvent.click(await slot.findByRole("button", { name: /По проекту/ }));
    const heading = slot.getByRole("heading", { name: "Требуют внимания: 3" });
    const pill = slot.getByRole("button", { name: /Альфа/ });

    expect(heading.parentElement!.contains(pill)).toBe(false);
    expect(
      heading.parentElement!.compareDocumentPosition(pill) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
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

  it("keeps the chosen sort after the section remounts", async () => {
    const first = await renderSection();
    await pickSort(first, "Свежие");
    cleanup();

    const second = await renderSection();
    expect(second.getByRole("button", { name: "Сортировка: Свежие" })).toBeDefined();
    expect(second.queryByRole("button", { name: "Сортировка: Дольше ждут" })).toBeNull();
  });
});

/** Open the sort dropdown from its trigger and choose one of its items. */
async function pickSort(slot: ReturnType<typeof renderSlot>, label: string): Promise<void> {
  const trigger = await slot.findByRole("button", { name: /Дольше ждут|Свежие/ });
  fireEvent.keyDown(trigger, { key: "Enter" });
  fireEvent.click(await slot.findByRole("menuitemradio", { name: label }));
}

describe("sort dropdown", () => {
  it("stands as an icon whose name says the current order, and marks it in the menu", async () => {
    const slot = await renderSection();
    const trigger = await slot.findByRole("button", { name: "Сортировка: Дольше ждут" });
    expect(trigger.getAttribute("aria-haspopup")).toBe("menu");
    expect(trigger.textContent).toBe("");

    fireEvent.keyDown(trigger, { key: "Enter" });
    const items = await slot.findAllByRole("menuitemradio");
    expect(items.map((item) => item.textContent)).toEqual(["Дольше ждут", "Свежие"]);
    expect(items.map((item) => item.getAttribute("aria-checked"))).toEqual(["true", "false"]);
  });

  it("reorders the queue by the sort chosen from the menu", async () => {
    const slot = await renderSection({
      sidebarThreads: {
        ...TWO_PROJECTS,
        threads: [
          idleThread({ id: "th_old", title: "Старый", latestAttentionAt: 1000 }),
          idleThread({ id: "th_new", title: "Новый", latestAttentionAt: 5000 }),
        ],
      },
    });
    await slot.findByText("Старый");
    const titles = () =>
      slot.getAllByRole("listitem").map((row) => within(row).getAllByRole("button")[0]!.textContent);
    expect(titles()[0]).toContain("Старый");

    await pickSort(slot, "Свежие");

    expect(titles()[0]).toContain("Новый");
    expect(slot.getByRole("button", { name: "Сортировка: Свежие" })).toBeDefined();
  });

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
  /** A coarse pointer, the way a phone or tablet reports itself. */
  function stubTouchScreen(): void {
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
