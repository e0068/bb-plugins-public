import { describe, expect, it } from "vitest";
import { parseFrontmatter } from "./frontmatter.js";
import { mapFrontmatter, parseDollars, parseMinutes, statusFromFolder } from "./map.js";

describe("parseFrontmatter", () => {
  it("splits a leading --- block from the body", () => {
    const { data, body } = parseFrontmatter(
      "---\ntitle: Hook URL field\ntype: feature\n---\n# Heading\n\nBody.\n",
    );
    expect(data.title).toBe("Hook URL field");
    expect(data.type).toBe("feature");
    expect(body).toBe("# Heading\n\nBody.\n");
  });

  it("returns empty data for a document without frontmatter", () => {
    const { data, body, error } = parseFrontmatter("Just markdown, no block.");
    expect(data).toEqual({});
    expect(body).toBe("Just markdown, no block.");
    expect(error).toBeUndefined();
  });

  it("does not throw on malformed YAML, but flags it with error", () => {
    const { data, error } = parseFrontmatter("---\ntitle: : :\n bad\n---\nbody");
    expect(data).toEqual({});
    expect(error).toBeTruthy();
  });

  it("flags an unquoted title with a bare colon as an error", () => {
    const { data, error } = parseFrontmatter(
      "---\ntitle: Custom plugin: rings\n---\nbody",
    );
    expect(data).toEqual({});
    expect(error).toBeTruthy();
  });

  it("accepts a quoted title with a colon, no error", () => {
    const { data, error } = parseFrontmatter(
      '---\ntitle: "Custom plugin: rings"\n---\nbody',
    );
    expect(error).toBeUndefined();
    expect(data.title).toBe("Custom plugin: rings");
  });

  it("flags frontmatter that parses to a scalar, not a mapping", () => {
    const { data, error } = parseFrontmatter("---\njust a scalar\n---\nbody");
    expect(data).toEqual({});
    expect(error).toBeTruthy();
  });

  it("does not flag a file with no --- block at all", () => {
    const { error } = parseFrontmatter("# Plain\n\nNo frontmatter here.\n");
    expect(error).toBeUndefined();
  });

  it("takes the last value when a union merge leaves a key twice", () => {
    const { data, error } = parseFrontmatter(
      "---\ntitle: Task\nestimate: s\nestimate: m\n---\nbody",
    );
    expect(error).toBeUndefined();
    expect(data.estimate).toBe("m");
  });
});

describe("parseMinutes", () => {
  it("reads whole minutes from a number or a numeric string", () => {
    expect(parseMinutes(90)).toBe(90);
    expect(parseMinutes("45")).toBe(45);
    expect(parseMinutes(0)).toBe(0);
  });

  it("rejects fractions, junk and negatives", () => {
    expect(parseMinutes(1.5)).toBeNull();
    expect(parseMinutes("an hour")).toBeNull();
    expect(parseMinutes(-5)).toBeNull();
    expect(parseMinutes(null)).toBeNull();
  });
});

describe("parseDollars", () => {
  it("reads dollars with or without a $ sign, rounded to cents", () => {
    expect(parseDollars(34.1)).toBe(34.1);
    expect(parseDollars("$60")).toBe(60);
    expect(parseDollars("12.345")).toBe(12.35);
    expect(parseDollars(0)).toBe(0);
  });

  it("rejects junk, negatives and non-finite values", () => {
    expect(parseDollars("cheap")).toBeNull();
    expect(parseDollars(-1)).toBeNull();
    expect(parseDollars(Number.POSITIVE_INFINITY)).toBeNull();
    expect(parseDollars(undefined)).toBeNull();
  });
});

describe("statusFromFolder", () => {
  it("accepts canonical statuses and legacy aliases", () => {
    expect(statusFromFolder("in_progress")).toBe("in_progress");
    expect(statusFromFolder("to-do")).toBe("todo");
    expect(statusFromFolder("in-progress")).toBe("in_progress");
    expect(statusFromFolder("nonsense")).toBeNull();
  });

  it("принимает написание с пробелами и заглавными: «In progress», «To do»", () => {
    expect(statusFromFolder("In progress")).toBe("in_progress");
    expect(statusFromFolder("In Review")).toBe("in_review");
    expect(statusFromFolder("To do")).toBe("todo");
    expect(statusFromFolder("Done")).toBe("done");
  });
});

describe("mapFrontmatter", () => {
  it("maps known fields, reads time and money, ignores legacy tokens, and drops invalid values", () => {
    const { data, body } = parseFrontmatter(
      [
        "---",
        "title: URL field in the toolbar",
        "type: feature",
        "estimate: m",
        "priority: high",
        "checks: [design, test, bogus]",
        "tokens: 120k",
        "tokens_actual: 140k",
        "minutes: 90",
        "minutes_actual: 120",
        "budget: 34.1",
        "limit: 60",
        "cost: 41.5",
        "due: 2026-09-01",
        "labels: [frontend, editor]",
        "parent: toolbar-redesign",
        "slug: hook-url-field",
        "---",
        "body",
      ].join("\n"),
    );
    const mapped = mapFrontmatter(data, "todo", "fallback-slug", body);
    expect(mapped).toEqual({
      slug: "hook-url-field",
      title: "URL field in the toolbar",
      description: "body",
      status: "todo",
      priority: "high",
      type: "feature",
      estimate: "m",
      plannedMinutes: 90,
      actualMinutes: 120,
      budget: 34.1,
      budgetLimit: 60,
      cost: 41.5,
      dueDate: "2026-09-01",
      labels: ["frontend", "editor"],
      parentRef: "toolbar-redesign",
      checks: ["design", "test"],
    });
  });

  it("falls back for missing/invalid fields without throwing", () => {
    const mapped = mapFrontmatter(
      { type: "not-a-type", estimate: "xxl", due: "soon" },
      "backlog",
      "derived-from-filename",
    );
    expect(mapped.slug).toBe("derived-from-filename");
    expect(mapped.title).toBe("derived-from-filename");
    expect(mapped.priority).toBe("none");
    expect(mapped.type).toBeNull();
    expect(mapped.estimate).toBeNull();
    expect(mapped.dueDate).toBeNull();
    expect(mapped.checks).toEqual([]);
    expect(mapped.parentRef).toBeNull();
    expect(mapped.description).toBe("");
  });

  it("maps the legacy type alias chore to refactor", () => {
    const mapped = mapFrontmatter({ type: "chore" }, "backlog", "slug");
    expect(mapped.type).toBe("refactor");
  });

  it("keeps the body verbatim apart from blank edges and CRLF", () => {
    const body = "\n# Heading\n\nA paragraph with `code` and a [link](../x.md).\n\n";
    const mapped = mapFrontmatter({}, "todo", "slug", body);
    expect(mapped.description).toBe(
      "# Heading\n\nA paragraph with `code` and a [link](../x.md).",
    );
    expect(mapFrontmatter({}, "todo", "s", "a\r\n\r\nb\r\n").description).toBe(
      "a\n\nb",
    );
  });

  it("does not dedent an indented block that opens the body", () => {
    const mapped = mapFrontmatter({}, "todo", "s", "\n    code\n    more\n");
    expect(mapped.description).toBe("    code\n    more");
  });
});
