import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { DEFAULT_RING_DIMS, DIM_FIELDS, LOGO_OPTIONS, logoPlacementOf, parseRingDims, ringRadii, type RingDims } from "./ring-style";

describe("defaults", () => {
  it("are the owner's pick from the prototype", () => {
    expect(DEFAULT_RING_DIMS).toEqual({
      size: 28,
      outer: 2,
      inner: 2,
      gap: 1,
      segmentGap: 20,
      track: 80,
      centerLogo: 12,
      cornerLogo: 12,
      cornerPad: 1,
      cornerTop: 4,
      cornerRight: 4,
    });
  });

  it("sit inside every slider's range", () => {
    for (const field of DIM_FIELDS) {
      expect(DEFAULT_RING_DIMS[field.key]).toBeGreaterThanOrEqual(field.min);
      expect(DEFAULT_RING_DIMS[field.key]).toBeLessThanOrEqual(field.max);
    }
  });

  it("has one slider per dimension", () => {
    expect(DIM_FIELDS.map(({ key }) => key).sort()).toEqual(Object.keys(DEFAULT_RING_DIMS).sort());
  });
});

describe("logoPlacementOf", () => {
  it("reads the setting's label, the center by default", () => {
    expect(logoPlacementOf(LOGO_OPTIONS[0])).toBe("center");
    expect(logoPlacementOf(LOGO_OPTIONS[1])).toBe("corner");
    expect(logoPlacementOf(undefined)).toBe("center");
    expect(logoPlacementOf("sideways")).toBe("center");
  });
});

describe("parseRingDims", () => {
  it("gives the defaults for nothing stored", () => {
    expect(parseRingDims(undefined)).toEqual(DEFAULT_RING_DIMS);
    expect(parseRingDims("junk")).toEqual(DEFAULT_RING_DIMS);
  });

  it("keeps stored values and fills the missing ones with defaults", () => {
    expect(parseRingDims({ size: 22, outer: 3 })).toEqual({ ...DEFAULT_RING_DIMS, size: 22, outer: 3 });
  });

  it("pulls a value outside its slider back to the nearest end and drops non-numbers", () => {
    const size = DIM_FIELDS.find(({ key }) => key === "size")!;
    expect(parseRingDims({ size: 1000, outer: "thick", gap: Number.NaN })).toEqual({ ...DEFAULT_RING_DIMS, size: size.max });
  });

  it("always lands inside every slider's range", () => {
    fc.assert(
      fc.property(fc.dictionary(fc.constantFrom(...DIM_FIELDS.map(({ key }) => key)), fc.oneof(fc.double(), fc.string())), (raw) => {
        const dims = parseRingDims(raw);
        return DIM_FIELDS.every(({ key, min, max }) => dims[key] >= min && dims[key] <= max);
      }),
    );
  });
});

describe("ringRadii", () => {
  it("puts the outer ring flush with the box and the inner one a gap inside it", () => {
    expect(ringRadii(DEFAULT_RING_DIMS)).toEqual({ center: 14, outer: 13, inner: 10 });
  });

  it("drops the inner ring when the outer one leaves it no room", () => {
    const tight: RingDims = { ...DEFAULT_RING_DIMS, size: 14, outer: 5, gap: 4, inner: 4 };
    expect(ringRadii(tight).inner).toBeNull();
  });
});
