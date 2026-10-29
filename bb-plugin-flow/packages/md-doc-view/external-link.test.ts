import { describe, expect, it } from "vitest";

import { isExternalLink } from "./external-link";

describe("isExternalLink", () => {
  it("a web or mail address leads out of the app, whatever the case of its scheme", () => {
    expect(isExternalLink("http://example.com/x")).toBe(true);
    expect(isExternalLink("https://example.com/x")).toBe(true);
    expect(isExternalLink("HTTPS://example.com/x")).toBe(true);
    expect(isExternalLink("mailto:a@b.com")).toBe(true);
  });

  it("a path, an anchor, an empty link and any other scheme stay in", () => {
    expect(isExternalLink("tasks/x.md")).toBe(false);
    expect(isExternalLink("/abs/https.md")).toBe(false);
    expect(isExternalLink("#x")).toBe(false);
    expect(isExternalLink("")).toBe(false);
    expect(isExternalLink("javascript:alert(1)")).toBe(false);
    expect(isExternalLink("file:///etc/passwd")).toBe(false);
  });
});
