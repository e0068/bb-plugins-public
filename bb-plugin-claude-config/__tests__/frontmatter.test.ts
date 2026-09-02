import { describe, expect, it } from "vitest";
import {
  fieldsFromJson,
  parseFrontmatter,
  serializeFrontmatter,
  setFieldValue,
} from "../src/frontmatter";

describe("fieldsFromJson", () => {
  it("top-level fields: primitives as strings, objects as JSON", () => {
    const fields = fieldsFromJson(
      '{"name":"x","version":"1.0.0","author":{"name":"A"}}',
    );
    expect(fields).toEqual([
      { kind: "field", key: "name", value: "x" },
      { kind: "field", key: "version", value: "1.0.0" },
      { kind: "field", key: "author", value: '{"name":"A"}' },
    ]);
  });

  it("invalid JSON or a non-object → empty", () => {
    expect(fieldsFromJson("not json")).toEqual([]);
    expect(fieldsFromJson("[1,2]")).toEqual([]);
    expect(fieldsFromJson("42")).toEqual([]);
  });
});

describe("parseFrontmatter", () => {
  it("parses fields and body", () => {
    const parsed = parseFrontmatter("---\nname: x\ntype: feature\n---\n\n# T");
    expect(parsed.hasFrontmatter).toBe(true);
    expect(parsed.entries).toEqual([
      { kind: "field", key: "name", value: "x" },
      { kind: "field", key: "type", value: "feature" },
    ]);
    expect(parsed.body).toBe("\n# T");
  });

  it("file without frontmatter — body is everything, no fields", () => {
    const parsed = parseFrontmatter("# Just a heading\ntext");
    expect(parsed.hasFrontmatter).toBe(false);
    expect(parsed.entries).toEqual([]);
    expect(parsed.body).toBe("# Just a heading\ntext");
  });

  it("unclosed delimiter — not frontmatter", () => {
    const parsed = parseFrontmatter("---\nname: x\nbody without a closing delimiter");
    expect(parsed.hasFrontmatter).toBe(false);
  });

  it("empty value and nested lines are preserved as raw", () => {
    const parsed = parseFrontmatter(
      "---\nauthor:\n  name: A\n# comment\n---\nbody",
    );
    expect(parsed.entries).toEqual([
      { kind: "field", key: "author", value: "" },
      { kind: "raw", text: "  name: A" },
      { kind: "raw", text: "# comment" },
    ]);
  });
});

describe("serializeFrontmatter round-trip", () => {
  const samples = [
    "---\nname: x\ntype: feature\n---\n\n# T",
    "---\nauthor:\n  name: A\n# comment\n---\nbody",
    "---\nname: x\n---\n",
  ];
  for (const sample of samples) {
    it(`returns the source unchanged: ${JSON.stringify(sample.slice(0, 20))}`, () => {
      const parsed = parseFrontmatter(sample);
      expect(serializeFrontmatter(parsed.entries, parsed.body)).toBe(sample);
    });
  }

  it("editing a value changes only its own field", () => {
    const parsed = parseFrontmatter("---\nname: x\ntype: feature\n---\nbody");
    const next = setFieldValue(parsed.entries, 0, "y");
    expect(serializeFrontmatter(next, parsed.body)).toBe(
      "---\nname: y\ntype: feature\n---\nbody",
    );
  });

  it("a non-empty value from an empty one is serialized with a space", () => {
    const entries = setFieldValue(
      [{ kind: "field", key: "due", value: "" }],
      0,
      "2026-09-01",
    );
    expect(serializeFrontmatter(entries, "body")).toBe(
      "---\ndue: 2026-09-01\n---\nbody",
    );
  });
});
