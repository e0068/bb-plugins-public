import { describe, expect, it } from "vitest";
import { asPreviewToast, parsePreviewToastArgv, PREVIEW_TOAST_CHANNEL } from "./preview-toast";

describe("parsePreviewToastArgv", () => {
  it("tone + title alone → the minimal toast, empty details, no link", () => {
    const r = parsePreviewToastArgv(["--tone", "success", "--title", "Done"]);
    expect(r).toEqual({
      ok: true,
      toast: { tone: "success", title: "Done", details: [], link: null },
    });
  });

  it("every prop at once → details repeat, link and threadLink both filled", () => {
    const r = parsePreviewToastArgv([
      "--tone", "error",
      "--title", "Pull Request #312",
      "--detail", "Reinstalled projects",
      "--detail", "Archived the thread",
      "--link-label", "View on GitHub",
      "--link-url", "https://github.com/e0068/bb-plugins/pull/312",
      "--thread-label", "Open thread",
      "--thread-id", "thr_abc",
    ]);
    expect(r).toEqual({
      ok: true,
      toast: {
        tone: "error",
        title: "Pull Request #312",
        details: ["Reinstalled projects", "Archived the thread"],
        link: { label: "View on GitHub", url: "https://github.com/e0068/bb-plugins/pull/312" },
        threadLink: { label: "Open thread", threadId: "thr_abc" },
      },
    });
  });

  it("--json carries a whole Notification, validated the same way", () => {
    const json = JSON.stringify({ tone: "warning", title: "Hi", details: ["a"], link: null });
    const r = parsePreviewToastArgv(["--json", json]);
    expect(r).toEqual({ ok: true, toast: { tone: "warning", title: "Hi", details: ["a"], link: null } });
  });

  it("an unknown tone is refused, not silently coerced", () => {
    const r = parsePreviewToastArgv(["--tone", "boom", "--title", "x"]);
    expect(r.ok).toBe(false);
  });

  it("a title is required", () => {
    const r = parsePreviewToastArgv(["--tone", "success"]);
    expect(r.ok).toBe(false);
  });

  it("a link with only one half is refused (both label and url or neither)", () => {
    const r = parsePreviewToastArgv(["--tone", "success", "--title", "x", "--link-url", "https://x"]);
    expect(r.ok).toBe(false);
  });

  it("malformed --json is refused", () => {
    const r = parsePreviewToastArgv(["--json", "{not json"]);
    expect(r.ok).toBe(false);
  });
});

describe("asPreviewToast", () => {
  it("accepts a well-formed realtime payload and normalizes missing details to []", () => {
    expect(asPreviewToast({ tone: "success", title: "Hi", link: null })).toEqual({
      tone: "success",
      title: "Hi",
      details: [],
      link: null,
    });
  });

  it("rejects a payload that is not a valid toast", () => {
    expect(asPreviewToast({ tone: "nope", title: "" })).toBeNull();
    expect(asPreviewToast("string")).toBeNull();
    expect(asPreviewToast(null)).toBeNull();
  });

  it("the channel name is a shared constant so publisher and subscriber can't drift", () => {
    expect(PREVIEW_TOAST_CHANNEL).toBe("preview-toast");
  });
});
