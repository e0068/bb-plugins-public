import { describe, expect, it } from "vitest";
import {
  fileRefFromCode,
  isInTabLink,
  parseHref,
  resolveRelative,
} from "./resolve";

describe("isInTabLink", () => {
  it("excludes scheme, protocol-relative, anchor, and empty links", () => {
    expect(isInTabLink("http://example.com/x")).toBe(false);
    expect(isInTabLink("https://example.com/x")).toBe(false);
    expect(isInTabLink("mailto:a@b.com")).toBe(false);
    expect(isInTabLink("//example.com/x")).toBe(false);
    expect(isInTabLink("#x")).toBe(false);
    expect(isInTabLink("")).toBe(false);
  });

  it("recognizes local paths as valid for navigation", () => {
    expect(isInTabLink("tasks/x.md")).toBe(true);
    expect(isInTabLink("./y.md")).toBe(true);
    expect(isInTabLink("/abs/z.md")).toBe(true);
  });
});

describe("parseHref", () => {
  it("strips the title first, then the anchor", () => {
    expect(parseHref('path "t"#sec')).toEqual({ path: "path", anchor: "sec" });
  });

  it("no title and no anchor — the whole path, anchor null", () => {
    expect(parseHref("tasks/x.md")).toEqual({ path: "tasks/x.md", anchor: null });
  });

  it("anchor only, no title", () => {
    expect(parseHref("tasks/x.md#section")).toEqual({
      path: "tasks/x.md",
      anchor: "section",
    });
  });

  it("doesn't strip trailing punctuation — a legitimate dot in the filename stays intact", () => {
    expect(parseHref("notes/v1.2.md")).toEqual({
      path: "notes/v1.2.md",
      anchor: null,
    });
  });
});

describe("resolveRelative", () => {
  it("deduplicates the trailing slash of an absolute link", () => {
    expect(resolveRelative("dir/a.md", "/a/b/")).toBe(
      resolveRelative("dir/a.md", "/a/b"),
    );
  });

  it("resolves a relative path against the file's directory", () => {
    expect(resolveRelative("dir/a.md", "b.md")).toBe("/dir/b.md");
  });

  it("collapses ..", () => {
    expect(resolveRelative("dir/a.md", "../c.md")).toBe("/c.md");
  });

  it("an absolute ref doesn't depend on fromPath", () => {
    expect(resolveRelative("dir/a.md", "/abs/z.md")).toBe("/abs/z.md");
  });
});

describe("fileRefFromCode", () => {
  it("recognizes a file link in inline code", () => {
    expect(fileRefFromCode("references/x.md")).toBe("references/x.md");
    expect(fileRefFromCode("  references/x.md  ")).toBe("references/x.md");
  });

  it("regular code is not a link", () => {
    expect(fileRefFromCode("const x")).toBe(null);
    expect(fileRefFromCode("user-scalable=no")).toBe(null);
  });
});
