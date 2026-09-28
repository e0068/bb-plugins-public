import { describe, expect, it } from "vitest";

import { alreadyOpenPr, type PrSignal } from "./open-pr-refinement";

const signal = (over: Partial<PrSignal> = {}): PrSignal => ({
  presence: "absent",
  url: null,
  number: null,
  state: null,
  checksState: null,
  mergeability: null,
  ...over,
});

const openPr = { url: "https://github.com/e/r/pull/9", number: 9 };
const hostOpen = signal({ presence: "open", url: "https://github.com/e/r/pull/7", number: 7 });

describe("alreadyOpenPr", () => {
  it("GitHub показывает открытый PR — он и есть итог шага", () => {
    expect(alreadyOpenPr(signal(), { asked: true, pr: openPr })).toEqual(openPr);
  });

  it("GitHub ответил, что открытого PR нет, — открывается новый, даже если кэш bb держит прошлый", () => {
    expect(alreadyOpenPr(hostOpen, { asked: true, pr: null })).toBeNull();
    expect(alreadyOpenPr(signal(), { asked: true, pr: null })).toBeNull();
  });

  it("спросить не вышло — верим кэшу bb: второй PR дороже отчёта прежним адресом", () => {
    expect(alreadyOpenPr(hostOpen, { asked: false })).toEqual({ url: "https://github.com/e/r/pull/7", number: 7 });
  });

  it("спросить не вышло, и кэш ничего не знает — открывать PR", () => {
    expect(alreadyOpenPr(signal(), { asked: false })).toBeNull();
    expect(alreadyOpenPr(signal({ presence: "settled", state: "merged", url: "https://github.com/e/r/pull/3", number: 3 }), { asked: false })).toBeNull();
  });
});
