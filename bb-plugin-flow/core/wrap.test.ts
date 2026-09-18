// @vitest-environment node
import { describe, expect, it } from "vitest";

import { rowEnds } from "./wrap";

describe("ряды перенесённых кнопок", () => {
  it("у каждой кнопки — номер последней кнопки её ряда", () => {
    expect(rowEnds([0, 0, 0, 0, 56, 56, 56, 56])).toEqual([3, 3, 3, 3, 7, 7, 7, 7]);
    expect(rowEnds([0, 0, 48])).toEqual([1, 1, 2]);
  });

  it("без раскладки все кнопки в одном ряду", () => {
    expect(rowEnds([0, 0, 0])).toEqual([2, 2, 2]);
    expect(rowEnds([])).toEqual([]);
  });
});
