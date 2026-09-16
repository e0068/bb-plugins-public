import { describe, expect, it } from "vitest";
import { slugify, uniqueSlug, validateSlug } from "./slug.js";

describe("slugify", () => {
  it("lowercases and dasherizes an ASCII title", () => {
    expect(slugify("Hello, World!")).toBe("hello-world");
  });

  it("transliterates Cyrillic", () => {
    expect(slugify("Обратное зеркало")).toBe("obratnoe-zerkalo");
  });

  it("falls back to \"task\" when nothing alphanumeric survives", () => {
    expect(slugify("!!!")).toBe("task");
    expect(slugify("")).toBe("task");
  });

  it("collapses repeated separators and trims leading/trailing dashes", () => {
    expect(slugify("  -- a   b -- ")).toBe("a-b");
  });

  it("caps length and never ends on a dash", () => {
    const long = "a".repeat(80);
    const slug = slugify(long);
    expect(slug.length).toBeLessThanOrEqual(60);
    expect(slug.endsWith("-")).toBe(false);
  });
});

describe("uniqueSlug", () => {
  it("returns the plain slug when it isn't taken", () => {
    expect(uniqueSlug("New task", new Set())).toBe("new-task");
  });

  it("appends the first free numeric suffix on collision", () => {
    const taken = new Set(["new-task", "new-task-2"]);
    expect(uniqueSlug("New task", taken)).toBe("new-task-3");
  });
});

describe("validateSlug", () => {
  it("returns the trimmed slug as typed, Cyrillic included", () => {
    expect(validateSlug("  задача-один ", new Set())).toBe("задача-один");
  });

  it("rejects an empty slug", () => {
    expect(() => validateSlug("   ", new Set())).toThrow("slug must not be empty");
  });

  it.each(["a/b", "a\\b", "a b", ".hidden", "note.md", "../up"])(
    "rejects %j — not a bare file name",
    (raw) => {
      expect(() => validateSlug(raw, new Set())).toThrow(/bare file name/);
    },
  );

  it("rejects a taken slug regardless of case", () => {
    expect(() => validateSlug("My-Task", new Set(["my-task"]))).toThrow(/already taken/);
  });
});
