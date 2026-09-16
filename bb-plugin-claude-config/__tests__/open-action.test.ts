import { describe, expect, it } from "vitest";
import {
  DEFAULT_FILE_OPENER_LOCATION,
  DEFAULT_FILE_OPENER_RENDERER,
  isHostOpen,
  normalizeOpenerLocation,
  normalizeOpenerRenderer,
  opensInEditMode,
  OPENER_DESCRIPTORS,
  readOpenerSettings,
} from "../src/open-action";

// Two independent settings (memory/decisions/claude-config-opener-two-axes.md):
// where a file opens (inline column vs. bb's host tab) and, only when
// inline, what renders it (Kasimov vs. the older builtin column).
describe("normalizeOpenerLocation", () => {
  it("passes the two valid locations through as-is", () => {
    expect(normalizeOpenerLocation("inline")).toBe("inline");
    expect(normalizeOpenerLocation("host")).toBe("host");
  });

  it("undefined and garbage fall back to the inline default", () => {
    expect(normalizeOpenerLocation(undefined)).toBe(DEFAULT_FILE_OPENER_LOCATION);
    expect(normalizeOpenerLocation("random")).toBe("inline");
    expect(normalizeOpenerLocation(42)).toBe("inline");
  });
});

describe("normalizeOpenerRenderer", () => {
  it("passes the two valid renderers through as-is", () => {
    expect(normalizeOpenerRenderer("md-opener")).toBe("md-opener");
    expect(normalizeOpenerRenderer("builtin")).toBe("builtin");
  });

  it("undefined and garbage fall back to the md-opener default", () => {
    expect(normalizeOpenerRenderer(undefined)).toBe(DEFAULT_FILE_OPENER_RENDERER);
    expect(normalizeOpenerRenderer("random")).toBe("md-opener");
    expect(normalizeOpenerRenderer(42)).toBe("md-opener");
  });
});

describe("isHostOpen", () => {
  it("only the host location goes to the host tab", () => {
    expect(isHostOpen("host")).toBe(true);
    expect(isHostOpen("inline")).toBe(false);
  });

  it("the default (no setting) opens in the column, not the host", () => {
    expect(isHostOpen(normalizeOpenerLocation(undefined))).toBe(false);
  });
});

// The two settings' keys live in one place (OPENER_DESCRIPTORS) and
// readOpenerSettings reads exactly those keys — a renamed/mistyped key breaks
// here instead of the setting silently freezing on its default in server.ts
// or app.tsx.
describe("readOpenerSettings", () => {
  it("reads each descriptor's own default when nothing is set", () => {
    expect(readOpenerSettings(undefined)).toEqual({
      location: DEFAULT_FILE_OPENER_LOCATION,
      renderer: DEFAULT_FILE_OPENER_RENDERER,
    });
  });

  it("reads a value stored under each descriptor's own key", () => {
    const values = {
      fileOpenerLocation: "host",
      fileOpenerRenderer: "builtin",
    };
    expect(readOpenerSettings(values)).toEqual({ location: "host", renderer: "builtin" });
  });

  it("declares exactly the two keys readOpenerSettings depends on", () => {
    expect(Object.keys(OPENER_DESCRIPTORS).sort()).toEqual([
      "fileOpenerLocation",
      "fileOpenerRenderer",
    ]);
  });
});

// BBPL-250: the "open documents in edit mode" setting also has to hold in the
// `builtin` column (the panel's older renderer) — otherwise the setting is
// visible on the board and silently does nothing in one of the three modes.
describe("opensInEditMode", () => {
  const file = { content: "# doc", error: null };

  it("off — a document opens as a read, as before", () => {
    expect(opensInEditMode(false, file, false)).toBe(false);
  });

  it("on — a readable file opens ready to edit", () => {
    expect(opensInEditMode(true, file, false)).toBe(true);
  });

  it("an unreadable file stays an error, not an empty draft", () => {
    expect(opensInEditMode(true, { content: null, error: "not found" }, false)).toBe(false);
    expect(opensInEditMode(true, { content: null, error: null }, false)).toBe(false);
    expect(opensInEditMode(true, { content: "# doc", error: "denied" }, false)).toBe(false);
  });

  // A connector view is markdown assembled by the server out of several
  // sources — there is no single file behind it to write back to.
  it("a composite (assembled) view never opens in edit mode", () => {
    expect(opensInEditMode(true, file, true)).toBe(false);
  });

  it("a missing error field reads as no error", () => {
    expect(opensInEditMode(true, { content: "# doc" }, false)).toBe(true);
  });
});
