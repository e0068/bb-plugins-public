import { describe, expect, it } from "vitest";
import {
  CSS_FIELDS,
  DEFAULTS,
  FLAG_FIELDS,
  descriptors,
  parse,
  toCssVars,
  toFlags,
  type KasimovSettings,
  type SettingValue,
} from "./kasimov-settings";

describe("DEFAULTS", () => {
  it("совпадают с дефолтами таблиц полей", () => {
    for (const f of CSS_FIELDS) expect(DEFAULTS[f.field]).toBe(f.default);
    for (const f of FLAG_FIELDS) expect(DEFAULTS[f.field]).toBe(f.default);
  });
});

describe("descriptors", () => {
  it("строковые поля — type string, флаги — type boolean, с дефолтом", () => {
    for (const f of CSS_FIELDS) {
      const d = descriptors[f.key];
      expect(d).toMatchObject({ type: "string", label: f.label, default: f.default });
    }
    for (const f of FLAG_FIELDS) {
      const d = descriptors[f.key];
      expect(d).toMatchObject({ type: "boolean", label: f.label, default: f.default });
    }
  });

  it("ключи настроек уникальны", () => {
    const keys = [...CSS_FIELDS, ...FLAG_FIELDS].map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("parse", () => {
  it("undefined → все дефолты", () => {
    expect(parse(undefined)).toEqual(DEFAULTS);
  });

  it("пустой объект → все дефолты", () => {
    expect(parse({})).toEqual(DEFAULTS);
  });

  it("валидное значение каждого поля применяется", () => {
    for (const f of CSS_FIELDS) {
      expect(parse({ [f.key]: "ЗНАЧ" })[f.field]).toBe("ЗНАЧ");
    }
    for (const f of FLAG_FIELDS) {
      const flipped = !f.default;
      expect(parse({ [f.key]: flipped })[f.field]).toBe(flipped);
    }
  });

  it("значение неверного типа падает на дефолт (тотальность)", () => {
    for (const f of CSS_FIELDS) {
      expect(parse({ [f.key]: true })[f.field]).toBe(f.default);
    }
    for (const f of FLAG_FIELDS) {
      expect(parse({ [f.key]: "да" })[f.field]).toBe(f.default);
    }
  });

  it("неизвестные ключи отбрасываются", () => {
    const values: Record<string, SettingValue> = { мусор: "x", другое: true };
    expect(parse(values)).toEqual(DEFAULTS);
  });
});

describe("toCssVars", () => {
  it("дефолты дают все CSS-переменные с их значениями", () => {
    const vars = toCssVars(DEFAULTS);
    for (const f of CSS_FIELDS) expect(vars[f.cssVar]).toBe(f.default);
    expect(Object.keys(vars)).toHaveLength(CSS_FIELDS.length);
  });

  it("пустое значение поля исключает его переменную (пусто = дефолт CSS)", () => {
    const s: KasimovSettings = { ...DEFAULTS, size: "" };
    const vars = toCssVars(s);
    expect(vars["--kasi-size"]).toBeUndefined();
    expect(Object.keys(vars)).toHaveLength(CSS_FIELDS.length - 1);
  });
});

describe("toFlags", () => {
  it("отражает оба флага на всех комбинациях", () => {
    for (const followLinks of [true, false]) {
      for (const frontmatter of [true, false]) {
        const s: KasimovSettings = { ...DEFAULTS, followLinks, frontmatter };
        expect(toFlags(s)).toEqual({ followLinks, frontmatter });
      }
    }
  });
});
