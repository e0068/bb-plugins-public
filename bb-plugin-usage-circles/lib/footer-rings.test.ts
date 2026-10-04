import { describe, expect, it } from "vitest";
import { FOOTER_RINGS, ringWindow, windowKindOf, type ProviderStateWire } from "./usage-model";

const claude = (windows: Array<{ label: string; usedPercent: number }>): ProviderStateWire => ({
  id: "claude-code",
  title: "Claude Code",
  logoUrl: "/logo",
  tint: null,
  usage: { status: "ok", windows: windows.map((window) => ({ ...window, resetsAt: null })) },
});

describe("footer rings", () => {
  it("offers five rings: three Claude Code windows and two Codex windows, each with its own id", () => {
    expect(FOOTER_RINGS.map(({ providerId, kind }) => `${providerId}:${kind}`)).toEqual([
      "claude-code:session",
      "claude-code:weekly",
      "claude-code:fable",
      "codex:session",
      "codex:weekly",
    ]);
    expect(new Set(FOOTER_RINGS.map(({ id }) => id)).size).toBe(5);
  });

  it("tells the session, Fable and plain weekly windows apart by their labels", () => {
    expect(windowKindOf("Current session")).toBe("session");
    expect(windowKindOf("5-hour limit")).toBe("session");
    expect(windowKindOf("Weekly · Fable")).toBe("fable");
    expect(windowKindOf("Current week (all models)")).toBe("weekly");
  });

  it("picks the window a ring shows from its provider's usage", () => {
    const provider = claude([
      { label: "Current session", usedPercent: 10 },
      { label: "Current week (all models)", usedPercent: 20 },
      { label: "Current week (Fable)", usedPercent: 30 },
    ]);
    expect(ringWindow(provider, "weekly")?.usedPercent).toBe(20);
    expect(ringWindow(provider, "fable")?.usedPercent).toBe(30);
  });

  it("has no window for a ring whose provider is signed out or lacks that window", () => {
    expect(ringWindow(claude([{ label: "Current session", usedPercent: 10 }]), "fable")).toBeUndefined();
    expect(ringWindow({ ...claude([]), usage: { status: "unauthenticated" } }, "session")).toBeUndefined();
  });
});
