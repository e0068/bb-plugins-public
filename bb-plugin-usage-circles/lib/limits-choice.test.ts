import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  DEFAULT_LIMITS,
  FOOTER_RINGS,
  gridLimits,
  LAYOUT_OPTIONS,
  providersWithoutData,
  layoutOf,
  moveLimit,
  parseLimits,
  shownLimits,
  toggleLimit,
  type ProviderStateWire,
} from "./usage-model";

const IDS = FOOTER_RINGS.map(({ id }) => id);

describe("layoutOf", () => {
  it("reads each option of the Window layout setting, and the list for anything else", () => {
    expect(LAYOUT_OPTIONS.map(layoutOf)).toEqual(["list", "grid", "all"]);
    expect(layoutOf(undefined)).toBe("list");
    expect(layoutOf("Tiles")).toBe("list");
  });
});

describe("parseLimits", () => {
  it("shows every limit in the footer's order when nothing is stored", () => {
    expect(parseLimits(undefined)).toEqual(IDS.map((id) => ({ id, shown: true })));
    expect(DEFAULT_LIMITS).toEqual(parseLimits(null));
  });

  it("keeps the stored order and choice, drops unknown ids and repeats, and adds missing limits shown at the end", () => {
    const stored = [
      { id: "codex-weekly", shown: false },
      { id: "nope", shown: true },
      { id: "claude-fable", shown: true },
      { id: "codex-weekly", shown: true },
    ];
    expect(parseLimits(stored)).toEqual([
      { id: "codex-weekly", shown: false },
      { id: "claude-fable", shown: true },
      { id: "claude-session", shown: true },
      { id: "claude-weekly", shown: true },
      { id: "codex-session", shown: true },
    ]);
  });

  it("always answers every limit exactly once, whatever is stored", () => {
    fc.assert(
      fc.property(fc.anything(), (raw) => {
        expect(parseLimits(raw).map(({ id }) => id).sort()).toEqual([...IDS].sort());
      }),
    );
  });
});

describe("moveLimit and toggleLimit", () => {
  it("moves a limit one place up or down and leaves it at the edge", () => {
    expect(moveLimit(DEFAULT_LIMITS, "claude-weekly", -1).map(({ id }) => id).slice(0, 2)).toEqual(["claude-weekly", "claude-session"]);
    expect(moveLimit(DEFAULT_LIMITS, "claude-weekly", 1).map(({ id }) => id).slice(1, 3)).toEqual(["claude-fable", "claude-weekly"]);
    expect(moveLimit(DEFAULT_LIMITS, "claude-session", -1)).toEqual(DEFAULT_LIMITS);
    expect(moveLimit(DEFAULT_LIMITS, "codex-weekly", 1)).toEqual(DEFAULT_LIMITS);
  });

  it("moving keeps every limit and its choice; moving back undoes it", () => {
    fc.assert(
      fc.property(fc.constantFrom(...IDS), fc.constantFrom(-1 as const, 1 as const), (id, step) => {
        const moved = moveLimit(DEFAULT_LIMITS, id, step);
        expect([...moved].sort((a, b) => a.id.localeCompare(b.id))).toEqual([...DEFAULT_LIMITS].sort((a, b) => a.id.localeCompare(b.id)));
        const atEdge = moved === DEFAULT_LIMITS || moved.every((limit, index) => limit.id === DEFAULT_LIMITS[index]!.id);
        if (!atEdge) expect(moveLimit(moved, id, step === 1 ? -1 : 1)).toEqual(DEFAULT_LIMITS);
      }),
    );
  });

  it("toggling hides a shown limit and shows it again, in place", () => {
    const hidden = toggleLimit(DEFAULT_LIMITS, "claude-fable");
    expect(hidden[2]).toEqual({ id: "claude-fable", shown: false });
    expect(toggleLimit(hidden, "claude-fable")).toEqual(DEFAULT_LIMITS);
  });
});

describe("shownLimits", () => {
  const provider = (id: string, windows: ProviderStateWire["usage"]): ProviderStateWire => ({ id, title: id, logoUrl: `/${id}`, tint: null, usage: windows });
  const providers = [
    provider("claude-code", {
      status: "ok",
      windows: [
        { label: "Current session", usedPercent: 19, resetsAt: null },
        { label: "Current week (all models)", usedPercent: 81, resetsAt: null },
        { label: "Current week (Fable)", usedPercent: 51, resetsAt: null },
      ],
    }),
    provider("codex", { status: "ok", windows: [{ label: "Current session", usedPercent: 3, resetsAt: null }] }),
  ];

  it("lists the shown limits that have data, in the chosen order, each with its provider and window", () => {
    const limits = toggleLimit(moveLimit(DEFAULT_LIMITS, "codex-session", -1), "claude-weekly");
    const shown = shownLimits(providers, limits);
    expect(shown.map(({ ring }) => ring.id)).toEqual(["claude-session", "codex-session", "claude-fable"]);
    expect(shown[1]!.provider).toBe(providers[1]);
    expect(shown[2]!.window).toBe((providers[0]!.usage as { windows: unknown[] }).windows[2]);
  });
});

describe("gridLimits", () => {
  const claude: ProviderStateWire = {
    id: "claude-code",
    title: "Claude Code",
    logoUrl: "/claude",
    tint: null,
    usage: {
      status: "ok",
      windows: [
        { label: "Current session", usedPercent: 10, resetsAt: null },
        { label: "Current week (all models)", usedPercent: 20, resetsAt: null },
        { label: "Current week (Sonnet)", usedPercent: 30, resetsAt: null },
      ],
    },
  };
  const codex: ProviderStateWire = { ...claude, id: "codex", title: "Codex", usage: { status: "ok", windows: [{ label: "Current session", usedPercent: 5, resetsAt: null }] } };

  it("lists the chosen limits of both providers in the chosen order, then the windows no ring stands for", () => {
    const limits = ["codex-session", "claude-session", "claude-weekly", "claude-fable", "codex-weekly"].map((id) => ({ id, shown: id !== "claude-session" }));
    expect(gridLimits([claude, codex], limits).map(({ provider, window }) => `${provider.id}:${window.label}`)).toEqual([
      "codex:Current session",
      "claude-code:Current week (all models)",
      "claude-code:Current week (Sonnet)",
    ]);
  });

  it("leaves out a provider with no data", () => {
    expect(gridLimits([claude, { ...codex, usage: { status: "not_installed" } }], DEFAULT_LIMITS).every(({ provider }) => provider.id === "claude-code")).toBe(true);
  });
});

describe("providersWithoutData", () => {
  const provider = (id: string, usage: ProviderStateWire["usage"]): ProviderStateWire => ({ id, title: id, logoUrl: `/${id}`, tint: null, usage });

  it("names the providers that should report data and do not, leaving out the ones not installed", () => {
    const providers = [
      provider("claude-code", { status: "ok", windows: [] }),
      provider("codex", { status: "unauthenticated" }),
      provider("other", { status: "not_installed" }),
    ];
    expect(providersWithoutData(providers).map(({ id }) => id)).toEqual(["codex"]);
  });
});
