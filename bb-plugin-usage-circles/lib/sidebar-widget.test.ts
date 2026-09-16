// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mountSidebarUsageCircles } from "./sidebar-widget";
import { DEFAULT_COLORING, type ProviderStateWire, type StateWire } from "./usage-model";

// The re-attach cadence in sidebar-widget.ts (MOUNT_RETRY_MS). Kept in sync by
// hand: these tests assert the widget recovers on that beat, not on the 60s
// data poll.
const MOUNT_RETRY_MS = 2_000;

/** A fresh sidebar footer + menu, replacing whatever was in the body — the
 * shape footerMenu() looks for, and the shape the host re-creates on a
 * settings save. Returns the menu the widget should mount into. */
function buildFooter(): HTMLElement {
  document.body.innerHTML = "";
  const footer = document.createElement("div");
  footer.setAttribute("data-sidebar", "footer");
  const menu = document.createElement("ul");
  menu.setAttribute("data-sidebar", "menu");
  footer.append(menu);
  document.body.append(footer);
  return menu;
}

function widgetIn(menu: HTMLElement): Element | null {
  return menu.querySelector(".usage-circles");
}

describe("mountSidebarUsageCircles", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // fetchState swallows a non-ok response and returns null, so the widget
    // mounts with no data — enough to assert on the row's presence without
    // stubbing the whole RPC envelope.
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({}) })));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  it("mounts into the footer menu on start", () => {
    const menu = buildFooter();
    const controller = new AbortController();
    mountSidebarUsageCircles("usage-circles", controller.signal);
    expect(widgetIn(menu)).not.toBeNull();
    controller.abort();
  });

  it("re-attaches within the retry beat after the host swaps the footer node", async () => {
    buildFooter();
    const controller = new AbortController();
    mountSidebarUsageCircles("usage-circles", controller.signal);

    // The host re-renders the sidebar (as a settings save does): the old
    // footer node — with our row inside it — is thrown away for a fresh one.
    const newMenu = buildFooter();
    expect(widgetIn(newMenu)).toBeNull();

    // Recovered on the mount beat alone — no 60s data poll needed.
    await vi.advanceTimersByTimeAsync(MOUNT_RETRY_MS);
    expect(widgetIn(newMenu)).not.toBeNull();

    controller.abort();
  });

  it("stops re-attaching after abort — no zombie widget", async () => {
    const menu = buildFooter();
    const controller = new AbortController();
    mountSidebarUsageCircles("usage-circles", controller.signal);
    expect(widgetIn(menu)).not.toBeNull();

    controller.abort();
    expect(widgetIn(menu)).toBeNull();

    buildFooter();
    await vi.advanceTimersByTimeAsync(5 * MOUNT_RETRY_MS);
    expect(document.querySelector(".usage-circles")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Two providers: a group per provider in the footer, a panel per provider.

const CLAUDE: ProviderStateWire = {
  id: "claude-code",
  title: "Claude Code",
  logoUrl: "/api/v1/system/providers/claude-code/logo?h=1",
  tint: { light: "#D97757", dark: "#D97757" },
  toggles: { session: true, weekly: true, fable: true },
  usage: {
    status: "ok",
    windows: [
      { label: "Current session", usedPercent: 32, resetsAt: null },
      { label: "Weekly limit", usedPercent: 85, resetsAt: null },
      { label: "Fable", usedPercent: 34, resetsAt: null },
    ],
  },
};

const CODEX: ProviderStateWire = {
  id: "codex",
  title: "Codex",
  logoUrl: "/api/v1/system/providers/codex/logo?h=2",
  tint: null,
  toggles: { session: true, weekly: true },
  usage: {
    status: "ok",
    windows: [
      { label: "Current session", usedPercent: 3, resetsAt: null },
      { label: "Weekly limit", usedPercent: 1, resetsAt: null },
    ],
  },
};

function stubState(over: Partial<StateWire> = {}): void {
  const state: StateWire = { openOnHover: true, coloring: DEFAULT_COLORING, providers: [CLAUDE, CODEX], ...over };
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ ok: true, result: state }) })));
}

function group(providerId: string): HTMLElement | null {
  return document.querySelector(`.usage-circles__toggle[data-provider-id="${providerId}"]`);
}

function panel(): HTMLElement | null {
  return document.querySelector(".usage-circles__panel");
}

async function mountWith(over: Partial<StateWire> = {}): Promise<{ menu: HTMLElement; controller: AbortController }> {
  stubState(over);
  const menu = buildFooter();
  const controller = new AbortController();
  mountSidebarUsageCircles("usage-circles", controller.signal);
  await vi.advanceTimersByTimeAsync(0); // flush the initial data fetch → render
  return { menu, controller };
}

describe("mountSidebarUsageCircles with two providers", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  it("sits in the same row as BB's own footer buttons: appended last, with no margin pulling it apart from them", async () => {
    stubState();
    const menu = buildFooter();
    // BB's own footer controls already sit in the menu as a horizontal row.
    const existing = document.createElement("li");
    existing.setAttribute("data-sidebar", "menu-item");
    menu.append(existing);
    const controller = new AbortController();
    mountSidebarUsageCircles("usage-circles", controller.signal);
    await vi.advanceTimersByTimeAsync(0);

    const widget = widgetIn(menu) as HTMLElement | null;
    expect(widget).not.toBeNull();
    expect(menu.lastElementChild).toBe(widget);
    expect(widget?.style.marginLeft).toBe("");
    controller.abort();
  });

  it("draws one group per provider, each led by its logo", async () => {
    const { controller } = await mountWith();
    const groups = Array.from(document.querySelectorAll<HTMLElement>(".usage-circles__toggle"));
    expect(groups.map((g) => g.dataset.providerId)).toEqual(["claude-code", "codex"]);
    expect(groups[0]!.firstElementChild?.getAttribute("aria-label")).toBe("Claude Code");
    expect(groups[1]!.firstElementChild?.getAttribute("aria-label")).toBe("Codex");
    expect(group("claude-code")!.querySelectorAll(".usage-circles__ring")).toHaveLength(3);
    expect(group("codex")!.querySelectorAll(".usage-circles__ring")).toHaveLength(2);
    controller.abort();
  });

  it("hides the group of a provider that is not installed", async () => {
    const { controller } = await mountWith({ providers: [CLAUDE, { ...CODEX, usage: { status: "not_installed" } }] });
    expect(group("claude-code")).not.toBeNull();
    expect(group("codex")).toBeNull();
    controller.abort();
  });

  it("shows only the logo for a provider that is signed out or expired", async () => {
    for (const status of ["unauthenticated", "expired"] as const) {
      const { controller } = await mountWith({ providers: [CLAUDE, { ...CODEX, usage: { status } }] });
      const codex = group("codex")!;
      expect(codex.children).toHaveLength(1);
      expect(codex.firstElementChild?.getAttribute("aria-label")).toBe("Codex");
      expect(codex.textContent).toBe("");
      controller.abort();
    }
  });

  it("opens the hovered provider's panel titled with its logo and Limits", async () => {
    const { controller } = await mountWith();
    expect(panel()).toBeNull();
    group("codex")!.dispatchEvent(new Event("mouseenter"));

    const open = panel()!;
    expect(open.getAttribute("aria-label")).toBe("Codex Limits");
    const header = open.querySelector(".usage-circles__panel-header")!;
    expect(header.textContent).toBe("Codex Limits");
    expect(header.querySelector<HTMLElement>("[role=img]")?.dataset.logoUrl).toBe(CODEX.logoUrl);
    expect(open.querySelectorAll(".usage-circles__window-row")).toHaveLength(2);
    controller.abort();
  });

  it("switches the panel to the other provider when the pointer moves to its group", async () => {
    const { controller } = await mountWith();
    group("codex")!.dispatchEvent(new Event("mouseenter"));
    group("codex")!.dispatchEvent(new Event("mouseleave"));
    group("claude-code")!.dispatchEvent(new Event("mouseenter"));

    expect(document.querySelectorAll(".usage-circles__panel")).toHaveLength(1);
    expect(panel()!.getAttribute("aria-label")).toBe("Claude Code Limits");
    expect(panel()!.querySelectorAll(".usage-circles__window-row")).toHaveLength(3);
    controller.abort();
  });

  it("lists every window in the panel even when its footer ring is toggled off", async () => {
    const { controller } = await mountWith({ providers: [CLAUDE, { ...CODEX, toggles: { session: true, weekly: false } }] });
    expect(group("codex")!.querySelectorAll(".usage-circles__ring")).toHaveLength(1);
    group("codex")!.dispatchEvent(new Event("mouseenter"));
    const labels = Array.from(panel()!.querySelectorAll(".usage-circles__window-heading span")).map((el) => el.textContent);
    expect(labels).toEqual(["Current session", "Weekly limit"]);
    controller.abort();
  });

  it("keeps a window visible in the footer when its provider has no switch for it", async () => {
    const codexWithFable: ProviderStateWire = {
      ...CODEX,
      toggles: { session: true, weekly: true },
      usage: { status: "ok", windows: [{ label: "Fable", usedPercent: 5, resetsAt: null }] },
    };
    const { controller } = await mountWith({ providers: [CLAUDE, codexWithFable] });
    expect(group("codex")!.querySelectorAll(".usage-circles__ring")).toHaveLength(1);
    controller.abort();
  });

  it("closes the panel after the pointer leaves, when openOnHover is on", async () => {
    const { controller } = await mountWith();
    group("claude-code")!.dispatchEvent(new Event("mouseenter"));
    group("claude-code")!.dispatchEvent(new Event("mouseleave"));
    expect(panel()).not.toBeNull(); // grace period keeps it open briefly
    await vi.advanceTimersByTimeAsync(200);
    expect(panel()).toBeNull();
    controller.abort();
  });

  it("does not open on hover when openOnHover is off", async () => {
    const { controller } = await mountWith({ openOnHover: false });
    group("codex")!.dispatchEvent(new Event("mouseenter"));
    expect(panel()).toBeNull();
    group("codex")!.dispatchEvent(new Event("click"));
    expect(panel()?.getAttribute("aria-label")).toBe("Codex Limits");
    controller.abort();
  });

  it("shows the sign-in status line in the panel of a signed-out provider", async () => {
    const { controller } = await mountWith({ providers: [CLAUDE, { ...CODEX, usage: { status: "unauthenticated" } }] });
    group("codex")!.dispatchEvent(new Event("mouseenter"));
    expect(panel()!.querySelector(".usage-circles__panel-header")?.textContent).toBe("Codex Limits");
    expect(panel()!.querySelector(".usage-circles__status")?.textContent).toBe("Not authenticated");
    controller.abort();
  });
});
