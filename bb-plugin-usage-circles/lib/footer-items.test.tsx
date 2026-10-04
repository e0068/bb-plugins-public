// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { publishRingStyle, publishUsage, providerPanel, ringIcon } from "./footer-items";
import { DEFAULT_RING_DIMS, DEFAULT_RING_STYLE, type RingStyle } from "./ring-style";
import { DEFAULT_COLORING, FOOTER_RINGS, type StateWire } from "./usage-model";

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
    expect(marked.map((row) => row.textContent)).toEqual([expect.stringContaining("Current week")]);
  });

  it("says why a signed-out provider has nothing to show", () => {
    const Panel = providerPanel("codex", "session");
    const view = render(<Panel dismiss={() => {}} />);
    act(() => publishUsage(STATE));
    expect(view.container.querySelector(".usage-circles__status")?.textContent).not.toBe("");
  });
});
