import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  addSection,
  applyGridLayout,
  type DashboardConfig,
  type DashboardSection,
  emptyDashboard,
  type GridLayoutItem,
  parseDashboard,
  removeSection,
  serializeDashboard,
  updateSectionRect,
} from "./dashboard-layout";

const rectArb = fc.record({
  x: fc.nat({ max: 100 }),
  y: fc.nat({ max: 100 }),
  w: fc.integer({ min: 1, max: 12 }),
  h: fc.integer({ min: 1, max: 12 }),
});

// Settings restricted to values that survive a JSON round-trip exactly (no NaN,
// no float drift) — the model carries them opaquely, so the kinds are what
// matter, not the range.
const settingArb = fc.oneof(fc.string(), fc.integer(), fc.boolean(), fc.constant(null));

const sectionArb: fc.Arbitrary<DashboardSection> = fc.record({
  id: fc.string({ minLength: 1 }),
  kind: fc.string({ minLength: 1 }),
  x: rectArb.map((r) => r.x),
  y: rectArb.map((r) => r.y),
  w: rectArb.map((r) => r.w),
  h: rectArb.map((r) => r.h),
  settings: fc.dictionary(fc.string(), settingArb),
});

const configArb: fc.Arbitrary<DashboardConfig> = fc
  .uniqueArray(sectionArb, { selector: (s) => s.id })
  .map((sections) => ({ version: 1 as const, sections }));

describe("serialize / parse round-trip", () => {
  it("parses back exactly what it serialised, for any valid dashboard", () => {
    fc.assert(
      fc.property(configArb, (config) => {
        const serialized = serializeDashboard(config);
        expect(serialized.ok).toBe(true);
        if (serialized.ok) expect(parseDashboard(serialized.json)).toEqual({ ok: true, config });
      }),
    );
  });

  it("refuses to serialise a config that breaks the schema, without throwing", () => {
    // w:0 is type-valid (z.infer loses .positive()) but violates the schema —
    // serialize must fail closed with an error, not throw and not persist it.
    const invalid = { version: 1 as const, sections: [{ id: "a", kind: "bar", x: 0, y: 0, w: 0, h: 2, settings: {} }] };
    const result = serializeDashboard(invalid);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.length).toBeGreaterThan(0);
  });

  it("returns a non-empty error, never throws, on non-JSON text", () => {
    const result = parseDashboard("}{ not json");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.length).toBeGreaterThan(0);
  });

  it("returns an error on JSON that breaks the schema", () => {
    expect(parseDashboard(JSON.stringify({ version: 2, sections: [] })).ok).toBe(false);
    expect(parseDashboard(JSON.stringify({ sections: [] })).ok).toBe(false);
    expect(parseDashboard(JSON.stringify({ version: 1, sections: [{ id: "a" }] })).ok).toBe(false);
  });

  it("defaults a section's settings to an empty object when the key is absent", () => {
    const result = parseDashboard(
      JSON.stringify({ version: 1, sections: [{ id: "a", kind: "bar", x: 0, y: 0, w: 2, h: 2 }] }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.config.sections[0].settings).toEqual({});
  });
});

describe("addSection", () => {
  it("appends a new-id section and is idempotent on a repeat", () => {
    fc.assert(
      fc.property(configArb, sectionArb, (config, section) => {
        fc.pre(!config.sections.some((s) => s.id === section.id));
        const once = addSection(config, section);
        expect(once.sections).toHaveLength(config.sections.length + 1);
        expect(addSection(once, section)).toEqual(once);
      }),
    );
  });

  it("adding then removing that id returns the original", () => {
    fc.assert(
      fc.property(configArb, sectionArb, (config, section) => {
        fc.pre(!config.sections.some((s) => s.id === section.id));
        expect(removeSection(addSection(config, section), section.id)).toEqual(config);
      }),
    );
  });
});

describe("removeSection", () => {
  it("is a no-op for an id that isn't present", () => {
    fc.assert(
      fc.property(configArb, fc.string({ minLength: 1 }), (config, id) => {
        fc.pre(!config.sections.some((s) => s.id === id));
        expect(removeSection(config, id)).toEqual(config);
      }),
    );
  });
});

describe("updateSectionRect", () => {
  it("moves only the target section's rect, keeping kind and settings", () => {
    fc.assert(
      fc.property(configArb, rectArb, (config, rect) => {
        fc.pre(config.sections.length > 0);
        const target = config.sections[0];
        const next = updateSectionRect(config, target.id, rect);
        const moved = next.sections.find((s) => s.id === target.id)!;
        expect({ x: moved.x, y: moved.y, w: moved.w, h: moved.h }).toEqual(rect);
        expect(moved.kind).toBe(target.kind);
        expect(moved.settings).toEqual(target.settings);
        // Every other section is untouched.
        expect(next.sections.filter((s) => s.id !== target.id)).toEqual(
          config.sections.filter((s) => s.id !== target.id),
        );
      }),
    );
  });

  it("is a no-op for an absent id", () => {
    const config = addSection(emptyDashboard(), {
      id: "a",
      kind: "bar",
      x: 0,
      y: 0,
      w: 2,
      h: 2,
      settings: {},
    });
    expect(updateSectionRect(config, "ghost", { x: 5, y: 5, w: 1, h: 1 })).toEqual(config);
  });
});

describe("applyGridLayout", () => {
  it("moves named sections, keeps the rest, ignores unknown ids, preserves kind/settings", () => {
    fc.assert(
      fc.property(configArb, (config) => {
        // Move every section by a fixed grid delta plus one item for a ghost id.
        const items: GridLayoutItem[] = config.sections.map((s) => ({
          i: s.id,
          x: s.x + 1,
          y: s.y + 2,
          w: s.w,
          h: s.h,
        }));
        const next = applyGridLayout(config, [...items, { i: "ghost", x: 9, y: 9, w: 1, h: 1 }]);
        expect(next.sections).toHaveLength(config.sections.length);
        next.sections.forEach((moved, index) => {
          const original = config.sections[index];
          expect(moved.x).toBe(original.x + 1);
          expect(moved.y).toBe(original.y + 2);
          expect(moved.kind).toBe(original.kind);
          expect(moved.settings).toEqual(original.settings);
        });
      }),
    );
  });

  it("keeps a section no item mentions at its current rect", () => {
    fc.assert(
      fc.property(configArb, (config) => {
        fc.pre(config.sections.length >= 2);
        // Mention only the FIRST section — the rest must survive untouched.
        const first = config.sections[0];
        const next = applyGridLayout(config, [{ i: first.id, x: first.x + 3, y: first.y + 4, w: first.w, h: first.h }]);
        expect(next.sections[0].x).toBe(first.x + 3);
        for (let i = 1; i < config.sections.length; i++) {
          expect(next.sections[i]).toEqual(config.sections[i]);
        }
      }),
    );
  });
});
