import { describe, expect, it } from "vitest";
import {
  fieldsFromJson,
  parseFrontmatter,
  serializeFrontmatter,
  setFieldValue,
} from "../src/frontmatter";

describe("fieldsFromJson", () => {
  it("поля верхнего уровня: примитивы строкой, объекты — JSON", () => {
    const fields = fieldsFromJson(
      '{"name":"x","version":"1.0.0","author":{"name":"A"}}',
    );
    expect(fields).toEqual([
      { kind: "field", key: "name", value: "x" },
      { kind: "field", key: "version", value: "1.0.0" },
      { kind: "field", key: "author", value: '{"name":"A"}' },
    ]);
  });

  it("невалидный JSON или не-объект → пусто", () => {
    expect(fieldsFromJson("не json")).toEqual([]);
    expect(fieldsFromJson("[1,2]")).toEqual([]);
    expect(fieldsFromJson("42")).toEqual([]);
  });
});

describe("parseFrontmatter", () => {
  it("разбирает поля и тело", () => {
    const parsed = parseFrontmatter("---\nname: x\ntype: feature\n---\n\n# T");
    expect(parsed.hasFrontmatter).toBe(true);
    expect(parsed.entries).toEqual([
      { kind: "field", key: "name", value: "x" },
      { kind: "field", key: "type", value: "feature" },
    ]);
    expect(parsed.body).toBe("\n# T");
  });

  it("файл без фронтматера — тело целиком, полей нет", () => {
    const parsed = parseFrontmatter("# Просто заголовок\nтекст");
    expect(parsed.hasFrontmatter).toBe(false);
    expect(parsed.entries).toEqual([]);
    expect(parsed.body).toBe("# Просто заголовок\nтекст");
  });

  it("незакрытый разделитель — не фронтматер", () => {
    const parsed = parseFrontmatter("---\nname: x\nтело без закрытия");
    expect(parsed.hasFrontmatter).toBe(false);
  });

  it("пустое значение и вложенные строки сохраняются как raw", () => {
    const parsed = parseFrontmatter(
      "---\nauthor:\n  name: A\n# коммент\n---\ntело",
    );
    expect(parsed.entries).toEqual([
      { kind: "field", key: "author", value: "" },
      { kind: "raw", text: "  name: A" },
      { kind: "raw", text: "# коммент" },
    ]);
  });
});

describe("serializeFrontmatter round-trip", () => {
  const samples = [
    "---\nname: x\ntype: feature\n---\n\n# T",
    "---\nauthor:\n  name: A\n# коммент\n---\nтело",
    "---\nname: x\n---\n",
  ];
  for (const sample of samples) {
    it(`возвращает исходник без правок: ${JSON.stringify(sample.slice(0, 20))}`, () => {
      const parsed = parseFrontmatter(sample);
      expect(serializeFrontmatter(parsed.entries, parsed.body)).toBe(sample);
    });
  }

  it("правка значения меняет только своё поле", () => {
    const parsed = parseFrontmatter("---\nname: x\ntype: feature\n---\nтело");
    const next = setFieldValue(parsed.entries, 0, "y");
    expect(serializeFrontmatter(next, parsed.body)).toBe(
      "---\nname: y\ntype: feature\n---\nтело",
    );
  });

  it("непустое значение из пустого сериализуется с пробелом", () => {
    const entries = setFieldValue(
      [{ kind: "field", key: "due", value: "" }],
      0,
      "2026-09-01",
    );
    expect(serializeFrontmatter(entries, "тело")).toBe(
      "---\ndue: 2026-09-01\n---\nтело",
    );
  });
});
