// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { presentFooterWindow, registerFooterWindow, resetFooterWindowsForTests } from "@bb-plugins/footer-window";
import { allLimitsIcon, allLimitsPanel, FooterPlacement, publishLayout, publishLimits, publishRingStyle, publishUsage, providerPanel, ringIcon } from "./footer-items";
import { DEFAULT_RING_DIMS, DEFAULT_RING_STYLE, type RingStyle } from "./ring-style";
import { DEFAULT_COLORING, DEFAULT_LIMITS, FOOTER_RINGS, moveLimit, toggleLimit, type StateWire } from "./usage-model";

const ring = (id: string) => FOOTER_RINGS.find((candidate) => candidate.id === id)!;

const STATE: StateWire = {
  openOnHover: true,
  coloring: DEFAULT_COLORING,
  providers: [
    {
      id: "claude-code",
      title: "Claude Code",
      logoUrl: "/claude",
      tint: { light: "#d97757", dark: "#d97757" },
      usage: {
        status: "ok",
        windows: [
          { label: "Current session", usedPercent: 12, resetsAt: null },
          { label: "Current week (all models)", usedPercent: 95, resetsAt: null },
        ],
      },
    },
    { id: "codex", title: "Codex", logoUrl: "/codex", tint: null, usage: { status: "unauthenticated" } },
  ],
  ring: DEFAULT_RING_STYLE,
  layout: "list",
  limits: DEFAULT_LIMITS,
};

const CORNER: RingStyle = { logo: "corner", dims: DEFAULT_RING_DIMS };
const percent = (value: string) => Number.parseFloat(value);

afterEach(() => {
  cleanup();
  act(() => {
    publishUsage(null);
    publishRingStyle(DEFAULT_RING_STYLE);
  });
});

describe("ring icon", () => {
  it("draws the ring of its own window with the provider's logo in the top right corner when the logo goes there", () => {
    const Icon = ringIcon(ring("claude-weekly"));
    const view = render(<Icon className="size-4" />);
    act(() => {
      publishRingStyle(CORNER);
      publishUsage(STATE);
    });
    expect(view.container.querySelector("svg.usage-circles__ring")?.getAttribute("data-tier")).toBe("red");
    const badge = view.container.querySelector<HTMLElement>("[data-provider-badge]")!;
    expect(badge.querySelector(".usage-circles__logo")?.getAttribute("aria-label")).toBe("Claude Code");
    expect(badge.style.position).toBe("absolute");
    expect(badge.style.top).not.toBe("");
    expect(badge.style.right).not.toBe("");
  });

  it("follows new usage without remounting", () => {
    const Icon = ringIcon(ring("claude-session"));
    const view = render(<Icon />);
    act(() => publishUsage(STATE));
    const red = { ...STATE, providers: [{ ...STATE.providers[0]!, usage: { status: "ok" as const, windows: [{ label: "Current session", usedPercent: 99, resetsAt: null }] } }] };
    act(() => publishUsage(red));
    expect(view.container.querySelector("svg.usage-circles__ring")?.getAttribute("data-tier")).toBe("red");
  });

  it("keeps an empty ring at full opacity while there is no data for its window", () => {
    const Icon = ringIcon(ring("codex-weekly"));
    const view = render(<Icon />);
    act(() => publishUsage(STATE));
    const root = view.container.firstElementChild as HTMLElement;
    expect(root.querySelector("svg.usage-circles__ring")).not.toBeNull();
    expect(root.style.opacity).toBe("");
    expect(root.querySelector(".usage-circles__logo")?.getAttribute("aria-label")).toBe("Codex");
  });

  it("puts the provider's logo in the middle of the rings by default, sized to the style", () => {
    const Icon = ringIcon(ring("claude-session"));
    const view = render(<Icon />);
    act(() => publishUsage(STATE));
    const logo = view.container.querySelector<HTMLElement>("[data-provider-logo-center]")!;
    expect(logo.querySelector(".usage-circles__logo")?.getAttribute("aria-label")).toBe("Claude Code");
    expect(percent(logo.style.width)).toBeCloseTo((12 / 28) * 100);
    expect(logo.style.left).toBe("50%");
    expect(view.container.querySelector("[data-provider-badge]")).toBeNull();
  });

  it("places and sizes the corner logo from the style, in shares of the ring so it scales with bb's box", () => {
    const Icon = ringIcon(ring("claude-session"));
    const view = render(<Icon />);
    act(() => {
      publishRingStyle({ logo: "corner", dims: { ...DEFAULT_RING_DIMS, size: 20, cornerLogo: 8, cornerPad: 1, cornerTop: 2, cornerRight: 3 } });
      publishUsage(STATE);
    });
    const badge = view.container.querySelector<HTMLElement>("[data-provider-badge]")!;
    expect(percent(badge.style.width)).toBeCloseTo(50);
    expect(percent(badge.style.padding)).toBeCloseTo(5);
    expect(percent(badge.style.top)).toBeCloseTo(-10);
    expect(percent(badge.style.right)).toBeCloseTo(-15);
  });

  it("follows a new style without remounting", () => {
    const Icon = ringIcon(ring("claude-session"));
    const view = render(<Icon />);
    act(() => publishUsage(STATE));
    act(() => publishRingStyle(CORNER));
    expect(view.container.querySelector("[data-provider-badge]")).not.toBeNull();
    expect(view.container.querySelector("[data-provider-logo-center]")).toBeNull();
  });

  it("grows bb's footer icon box to the style's ring size", () => {
    const Icon = ringIcon(ring("claude-session"));
    document.body.innerHTML = `<li data-footer-item="plugin:usage-circles/claude-session"><button><span data-icon-root class="size-4 opacity-80" id="root"></span></button></li>`;
    render(<Icon className="size-full" />, { container: document.getElementById("root")! });
    act(() => publishRingStyle({ logo: "center", dims: { ...DEFAULT_RING_DIMS, size: 22 } }));
    expect(document.getElementById("root")!.style.width).toBe("22px");
  });

  it("fills nearly the whole footer button, at full opacity, instead of bb's small dimmed icon box", () => {
    const Icon = ringIcon(ring("claude-session"));
    document.body.innerHTML = `<li data-footer-item="plugin:usage-circles/claude-session"><button><span data-icon-root class="size-4 opacity-80" id="root"></span></button></li>`;
    render(<Icon className="size-full" />, { container: document.getElementById("root")! });
    act(() => publishUsage(STATE));
    const box = document.getElementById("root")!;
    expect(box.style.width).toBe("28px");
    expect(box.style.height).toBe("28px");
    expect(box.style.opacity).toBe("1");
  });

  it("leaves bb's icon box alone outside the footer row, as in the overflow menu", () => {
    const Icon = ringIcon(ring("claude-session"));
    document.body.innerHTML = `<div role="menuitem"><span data-icon-root class="size-4" id="root"></span></div>`;
    render(<Icon className="size-full" />, { container: document.getElementById("root")! });
    expect(document.getElementById("root")!.style.width).toBe("");
  });
});

describe("provider panel", () => {
  it("lists every window of the item's provider", () => {
    const Panel = providerPanel("claude-code", "session");
    const view = render(<Panel dismiss={() => {}} />);
    act(() => publishUsage(STATE));
    expect(view.container.textContent).toContain("Claude Code Limits");
    expect(view.container.querySelectorAll(".usage-circles__window-row").length).toBe(2);
  });

  it("marks the limit of the ring the window was opened from", () => {
    const Panel = providerPanel("claude-code", "weekly");
    const view = render(<Panel dismiss={() => {}} />);
    act(() => publishUsage(STATE));
    const marked = Array.from(view.container.querySelectorAll<HTMLElement>(".usage-circles__window-row")).filter((row) => row.dataset.highlighted === "true");
    expect(marked.map((row) => row.textContent)).toEqual([expect.stringContaining("7 days")]);
  });

  it("says why a signed-out provider has nothing to show", () => {
    const Panel = providerPanel("codex", "session");
    const view = render(<Panel dismiss={() => {}} />);
    act(() => publishUsage(STATE));
    expect(view.container.querySelector(".usage-circles__status")?.textContent).not.toBe("");
  });
});

describe("the chosen limits and layout", () => {
  const rows = (container: HTMLElement) => Array.from(container.querySelectorAll(".usage-circles__window-row")).map((row) => row.textContent);

  it("shows only the chosen limits of the provider, in the chosen order", () => {
    const Panel = providerPanel("claude-code", "session");
    const view = render(<Panel dismiss={() => {}} />);
    act(() => publishUsage({ ...STATE, limits: moveLimit(DEFAULT_LIMITS, "claude-weekly", -1) }));
    expect(rows(view.container)).toEqual([expect.stringContaining("7 days"), expect.stringContaining("5 hour")]);
    act(() => publishLimits(toggleLimit(DEFAULT_LIMITS, "claude-weekly")));
    expect(rows(view.container)).toEqual([expect.stringContaining("5 hour")]);
  });

  it("still shows a limit no ring stands for, after the chosen ones", () => {
    const Panel = providerPanel("claude-code", "session");
    const view = render(<Panel dismiss={() => {}} />);
    const claude = STATE.providers[0]!;
    const windows = [
      { label: "Current session", usedPercent: 12, resetsAt: null },
      { label: "Current week (all models)", usedPercent: 95, resetsAt: null },
      { label: "Current week (Sonnet)", usedPercent: 40, resetsAt: null },
    ];
    act(() => publishUsage({ ...STATE, providers: [{ ...claude, usage: { status: "ok", windows } }], limits: toggleLimit(DEFAULT_LIMITS, "claude-weekly") }));
    expect(rows(view.container)).toEqual([expect.stringContaining("5 hour"), expect.stringContaining("Sonnet")]);
  });

  it("hides the rings of the limits switched off, in the list and grid layouts", () => {
    const style = render(<FooterPlacement layout="list" limits={toggleLimit(DEFAULT_LIMITS, "codex-weekly")} />).container.querySelector("style")?.textContent ?? "";
    expect(style).toContain("plugin:usage-circles/codex-weekly");
    expect(style).not.toContain("plugin:usage-circles/codex-session");
  });

  it("closes the window of an item the layout hides, and forgets its pin", () => {
    const controller = { calls: [] as string[], open() { this.calls.push("open"); }, close() { this.calls.push("close"); }, toggle() {} };
    const item = { pluginId: "usage-circles", itemId: "claude-session" };
    registerFooterWindow({ ...item, label: "Claude Code — 5-hour limit" }, controller);
    presentFooterWindow(item);
    render(<FooterPlacement layout="all" limits={DEFAULT_LIMITS} />);
    expect(controller.calls).toEqual(["open", "close"]);
    resetFooterWindowsForTests();
  });

  it("shows the windows in a new layout at once, before the backend answers with it", () => {
    const Panel = providerPanel("claude-code", "session");
    const view = render(<Panel dismiss={() => {}} />);
    act(() => publishUsage(STATE));
    act(() => publishLayout("grid"));
    expect(view.container.querySelectorAll(".usage-circles__card").length).toBe(2);
  });

  it("shows every chosen limit of both providers in a ring's window in the grid layout, under Usage Limits, each card with its provider's logo and the ring's own marked", () => {
    const Panel = providerPanel("claude-code", "session");
    const view = render(<Panel dismiss={() => {}} />);
    const codex = { ...STATE.providers[1]!, usage: { status: "ok" as const, windows: [{ label: "Current session", usedPercent: 19, resetsAt: null }, { label: "Weekly limit", usedPercent: 4, resetsAt: null }] } };
    act(() => publishUsage({ ...STATE, providers: [STATE.providers[0]!, codex], layout: "grid" }));
    expect(view.getByRole("heading").textContent).toBe("Usage Limits");
    const cards = Array.from(view.container.querySelectorAll<HTMLElement>(".usage-circles__card"));
    expect(cards.map((card) => card.querySelector(".usage-circles__card-heading")?.textContent)).toEqual(["5 hour12%", "7 days95%", "5 hour19%", "7 days4%"]);
    expect(cards.map((card) => card.querySelector(".usage-circles__logo")?.getAttribute("aria-label"))).toEqual(["Claude Code", "Claude Code", "Codex", "Codex"]);
    expect(cards.map((card) => card.dataset.highlighted ?? "")).toEqual(["true", "", "", ""]);
    expect(view.container.querySelector(".usage-circles__window-row")).toBeNull();
  });

  it("says in the grid layout why a provider has no data, so its ring's window does not just drop it", () => {
    const Panel = providerPanel("codex", "session");
    const view = render(<Panel dismiss={() => {}} />);
    act(() => publishUsage({ ...STATE, layout: "grid" }));
    expect(view.container.querySelector(".usage-circles__status")?.textContent).toBe("Not authenticated");
    expect(view.container.querySelectorAll(".usage-circles__card").length).toBe(2);
  });

  it("keeps a limit no ring stands for in the grid layout, after the chosen ones", () => {
    const Panel = providerPanel("claude-code", "session");
    const view = render(<Panel dismiss={() => {}} />);
    const claude = STATE.providers[0]!;
    const windows = [...(claude.usage.status === "ok" ? claude.usage.windows : []), { label: "Current week (Sonnet)", usedPercent: 40, resetsAt: null }];
    act(() => publishUsage({ ...STATE, providers: [{ ...claude, usage: { status: "ok", windows } }, STATE.providers[1]!], layout: "grid" }));
    const headings = Array.from(view.container.querySelectorAll(".usage-circles__card-heading")).map((heading) => heading.textContent);
    expect(headings.at(-1)).toContain("Sonnet");
  });

  it("heads the window of every limit Usage Limits and shows each chosen limit with data as a card", () => {
    const Panel = allLimitsPanel();
    const view = render(<Panel dismiss={() => {}} />);
    act(() => publishUsage({ ...STATE, layout: "all" }));
    expect(view.getByRole("heading").textContent).toBe("Usage Limits");
    expect(Array.from(view.container.querySelectorAll(".usage-circles__card-heading")).map((heading) => heading.textContent)).toEqual(["5 hour12%", "7 days95%"]);
  });

  it("draws the ring of the first chosen limit, with no provider's logo, in the item of every limit", () => {
    const Icon = allLimitsIcon();
    const view = render(<Icon />);
    act(() => publishUsage({ ...STATE, limits: moveLimit(DEFAULT_LIMITS, "claude-weekly", -1) }));
    expect(view.container.querySelector("svg.usage-circles__ring")?.getAttribute("data-tier")).toBe("red");
    act(() => publishUsage(STATE));
    expect(view.container.querySelector("svg.usage-circles__ring")?.getAttribute("data-tier")).not.toBe("red");
    expect(view.container.querySelector(".usage-circles__logo")).toBeNull();
  });

  it("never hides the item of every limit, so it shows wherever Customize footer puts it; the layout of every limit hides the five rings", () => {
    const hidden = (layout: StateWire["layout"]) => render(<FooterPlacement layout={layout} limits={DEFAULT_LIMITS} />).container.querySelector("style")?.textContent ?? "";
    expect(hidden("list")).toBe("");
    expect(hidden("grid")).toBe("");
    const rings = hidden("all");
    expect(FOOTER_RINGS.every(({ id }) => rings.includes(`[data-footer-item="plugin:usage-circles/${id}"]`))).toBe(true);
    expect(rings).not.toContain("usage-limits");
  });
});
