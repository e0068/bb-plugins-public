// @vitest-environment jsdom
//
// Promises of the thread preview window: the sidebar opens it on the host's own
// thread rows, and on both surfaces it carries the thread's title on top and
// where and how the thread runs underneath, at the size the settings name.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, within } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { PluginSidebarThread, PluginThreadListProps } from "@get-bb/plugin-sdk/app";

function thread(over: Partial<PluginSidebarThread>): PluginSidebarThread {
  return {
    id: "th_1",
    projectId: "p_alpha",
    title: "Тред",
    titleFallback: null,
    parentThreadId: null,
    sectionId: null,
    originKind: null,
    originPluginId: null,
    providerId: "claude-code",
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
    ...over,
  };
}

const THREADS = {
  status: "ready" as const,
  threads: [
    thread({
      id: "th_wt",
      title: "Тред в дереве",
      environment: { id: "env_1", name: null, branchName: "bb/feature", workspaceDisplayKind: "managed-worktree" },
      host: { id: "h_1", name: "MacBook" },
    }),
    thread({ id: "th_plain", title: "Простой тред", projectId: "p_beta" }),
  ],
  projects: [
    { id: "p_alpha", name: "Альфа", isPersonal: false },
    { id: "p_beta", name: "Бета", isPersonal: false },
  ],
};

const DETAILS = {
  listPostponed: () => ({ postponed: [] }),
  threadDetails: ({ threadId }: { threadId: string }) =>
    threadId === "th_wt"
      ? {
          execution: { model: "claude-opus-5", reasoningLevel: "high", permissionMode: "auto" },
          git: { commitsAhead: 2, uncommitted: true },
        }
      : { execution: null, git: null },
};

/** The host's own thread list: rows it marks with the thread they open. */
function HostList() {
  return (
    <nav aria-label="Треды bb">
      {THREADS.threads.map((t) => (
        <a key={t.id} href={`#${t.id}`} data-sidebar-thread-id={t.id}>
          <span>{t.title} в панели</span>
        </a>
      ))}
    </nav>
  );
}

const LIST_PROPS: PluginThreadListProps = {
  activeThreadId: null,
  activeProjectId: null,
  isCompactViewport: false,
  onNavigate: () => {},
  searchQuery: "",
  Original: HostList,
};

type Options = Parameters<typeof renderSlot>[2];

async function renderSidebar(options: Options = {}) {
  const app = await loadPluginApp(() => import("./app"));
  expect(app.threadLists).toHaveLength(1);
  return renderSlot(app.threadLists[0]!, LIST_PROPS, {
    sidebarThreads: THREADS,
    rpc: DETAILS,
    settings: { previewDelaySeconds: "1" },
    ...options,
  });
}

async function renderHome(options: Options = {}) {
  const app = await loadPluginApp(() => import("./app"));
  return renderSlot(app.homepageSections[0]!, { projectId: null }, {
    sidebarThreads: THREADS,
    rpc: DETAILS,
    settings: { previewDelaySeconds: "1" },
    ...options,
  });
}

type Slot = ReturnType<typeof renderSlot>;

const sidebarRow = (slot: Slot, id: string) =>
  slot.container.querySelector(`[data-sidebar-thread-id="${id}"]`) as HTMLElement;

/** Point at an element the way a mouse does, then let the delay run out. */
async function hover(target: HTMLElement, ms: number) {
  fireEvent.pointerOver(target, { pointerType: "mouse" });
  fireEvent.pointerEnter(target, { pointerType: "mouse" });
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
}

const preview = (slot: Slot) => slot.queryByTestId("thread-preview");

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("preview on the sidebar's thread rows", () => {
  it("offers itself as a thread list and keeps bb's own list inside", async () => {
    const slot = await renderSidebar();
    expect(slot.getByRole("navigation", { name: "Треды bb" })).toBeDefined();
    expect(slot.getByText("Простой тред в панели")).toBeDefined();
  });

  it("opens the hovered row's conversation once the delay is up", async () => {
    const slot = await renderSidebar();
    await hover(within(sidebarRow(slot, "th_plain")).getByText("Простой тред в панели"), 1000);

    const card = preview(slot)!;
    expect(within(card).getByTestId("bb-thread-chat").getAttribute("data-thread-id")).toBe("th_plain");
  });

  it("stays shut until the delay is up, and never opens with the delay at zero", async () => {
    const early = await renderSidebar();
    await hover(sidebarRow(early, "th_plain"), 500);
    expect(preview(early)).toBeNull();
    cleanup();

    const off = await renderSidebar({ settings: { previewDelaySeconds: "0" } });
    await hover(sidebarRow(off, "th_plain"), 60_000);
    expect(preview(off)).toBeNull();
  });

  it("opens nothing for the list's parts that are not thread rows", async () => {
    const slot = await renderSidebar();
    await hover(slot.getByRole("navigation", { name: "Треды bb" }), 5000);
    expect(preview(slot)).toBeNull();
  });

  it("follows the pointer to the next row", async () => {
    const slot = await renderSidebar();
    await hover(sidebarRow(slot, "th_plain"), 1000);
    fireEvent.pointerLeave(sidebarRow(slot, "th_plain"), { pointerType: "mouse" });
    await hover(sidebarRow(slot, "th_wt"), 1000);

    expect(within(preview(slot)!).getByRole("heading", { name: "Тред в дереве" })).toBeDefined();
  });
});

describe("the preview window's title and footer", () => {
  it("heads the sidebar preview with the thread's title", async () => {
    const slot = await renderSidebar();
    await hover(sidebarRow(slot, "th_plain"), 1000);
    expect(within(preview(slot)!).getByRole("heading", { name: "Простой тред" })).toBeDefined();
  });

  it("puts the project, branch, machine, agent options, commits and pull request underneath", async () => {
    const slot = await renderSidebar({
      sidebarPullRequests: {
        th_wt: { number: 42, title: "PR", url: "https://example.test/pr/42", state: "open", attention: "none" },
      },
    });
    await hover(sidebarRow(slot, "th_wt"), 1000);
    const footer = within(preview(slot)!).getByTestId("thread-preview-footer");

    for (const text of [
      "Альфа",
      "bb/feature",
      "MacBook",
      "claude-opus-5",
      "усилие высокое",
      "режим авто",
      "коммитов: 2",
      "есть незакоммиченные правки",
      "PR #42 открыт",
    ]) {
      expect(within(footer).getByText(text)).toBeDefined();
    }
  });

  it("gives the home screen's preview the same title and footer", async () => {
    const slot = await renderHome();
    await hover(slot.getByText("Тред в дереве").closest("li") as HTMLElement, 1000);
    const card = preview(slot)!;

    expect(within(card).getByRole("heading", { name: "Тред в дереве" })).toBeDefined();
    const footer = within(card).getByTestId("thread-preview-footer");
    expect(within(footer).getByText("bb/feature")).toBeDefined();
    expect(within(footer).getByText("режим авто")).toBeDefined();
  });
});

describe("the preview window's size", () => {
  it("takes its width and height from the settings on the sidebar", async () => {
    const slot = await renderSidebar({
      settings: { previewDelaySeconds: "1", previewWidth: "640", previewHeight: "480" },
    });
    await hover(sidebarRow(slot, "th_plain"), 1000);
    const card = preview(slot)!;
    expect(card.style.width).toBe("640px");
    expect(card.style.maxHeight).toBe("min(480px, 100vh)");
  });

  it("takes the same size on the home screen", async () => {
    const slot = await renderHome({
      settings: { previewDelaySeconds: "1", previewWidth: "700", previewHeight: "500" },
    });
    await hover(slot.getByText("Простой тред").closest("li") as HTMLElement, 1000);
    expect(preview(slot)!.style.width).toBe("700px");
  });
});

describe("reaching into the sidebar preview", () => {
  it("keeps the window open while the pointer moves over it", async () => {
    const slot = await renderSidebar();
    await hover(sidebarRow(slot, "th_plain"), 1000);
    const card = preview(slot)!;

    // A browser reports each step inside the window as a move from one of its
    // parts to another, not as an arrival from outside.
    const heading = within(card).getByRole("heading", { name: "Простой тред" });
    fireEvent.pointerOver(card, { pointerType: "mouse", relatedTarget: sidebarRow(slot, "th_plain") });
    fireEvent.pointerOver(heading, { pointerType: "mouse", relatedTarget: card });
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });

    expect(preview(slot)).not.toBeNull();
  });
});
