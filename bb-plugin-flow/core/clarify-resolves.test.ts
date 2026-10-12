// @vitest-environment node
import { describe, expect, it } from "vitest";

import { resolvesIssues, type ResolveTarget } from "./clarify";

const open: ResolveTarget = { threadId: "thr_1", kind: "clarify", answered: false };

describe("resolves — какие уточнения агент вправе закрыть как решённые", () => {
  it("неотвеченное уточнение этого треда закрывается", () => {
    expect(resolvesIssues("thr_1", [["dec_a", open]])).toEqual([]);
  });

  it("пустой список — закрывать нечего", () => {
    expect(resolvesIssues("thr_1", [])).toEqual([]);
  });

  it("неизвестный id отбивается", () => {
    expect(resolvesIssues("thr_1", [["dec_x", null]])).toEqual(["resolves dec_x is not a clarify of this thread"]);
  });

  it("уточнение другого треда отбивается так же, как неизвестный id", () => {
    expect(resolvesIssues("thr_1", [["dec_a", { ...open, threadId: "thr_2" }]])).toEqual(["resolves dec_a is not a clarify of this thread"]);
  });

  it("бриф не закрывается: решённым бывает только уточнение", () => {
    expect(resolvesIssues("thr_1", [["dec_a", { ...open, kind: "brief" }]])).toEqual(["resolves dec_a is not a clarify: only a clarify is closed this way"]);
  });

  it("отвеченное владельцем остаётся отвеченным", () => {
    expect(resolvesIssues("thr_1", [["dec_a", { ...open, answered: true }]])).toEqual(["resolves dec_a is already answered by the owner: its answer stands"]);
  });

  it("один плохой id роняет весь список: отказ называет каждый плохой", () => {
    const issues = resolvesIssues("thr_1", [["dec_a", open], ["dec_b", null], ["dec_c", { ...open, answered: true }]]);
    expect(issues).toHaveLength(2);
    expect(issues[0]).toContain("dec_b");
    expect(issues[1]).toContain("dec_c");
  });
});
