import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { decodeBase64, encodeBase64 } from "./base64";

describe("encodeBase64 / decodeBase64", () => {
  it("round-trips a known string", () => {
    expect(decodeBase64(encodeBase64("hello, world"))).toBe("hello, world");
  });

  it("property: decode(encode(x)) = x for any utf8 string", () => {
    fc.assert(
      fc.property(fc.string(), (text) => {
        expect(decodeBase64(encodeBase64(text))).toBe(text);
      }),
    );
  });
});
