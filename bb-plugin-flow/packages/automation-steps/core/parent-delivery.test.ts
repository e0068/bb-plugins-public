import { describe, expect, it } from "vitest";

import { parentDelivery } from "./parent-delivery";

const parent = { branchName: "bb/umbrella-thr_p", path: "/w/parent" };
const child = { base: "bb/umbrella-thr_p", defaultBranch: "main", branch: "bb/wave-0-thr_c", parent };

describe("parentDelivery", () => {
  it("дочерний тред, чья база — ветка родителя, сдаёт работу в дерево родителя", () => {
    expect(parentDelivery(child)).toEqual({
      branch: "bb/wave-0-thr_c",
      parentBranch: "bb/umbrella-thr_p",
      parentPath: "/w/parent",
    });
  });

  it("тред без родителя идёт обычным путём", () => {
    expect(parentDelivery({ ...child, parent: null })).toBeNull();
  });

  it("дочерний тред от main идёт обычным путём: его база — не ветка родителя", () => {
    expect(parentDelivery({ ...child, base: "main" })).toBeNull();
  });

  it("дочерний тред от main, чей родитель тоже на main, идёт обычным путём: main есть на origin", () => {
    expect(parentDelivery({ ...child, base: "main", parent: { branchName: "main", path: "/w/checkout" } })).toBeNull();
  });

  it("без дерева родителя на диске сдавать некуда", () => {
    expect(parentDelivery({ ...child, parent: { ...parent, path: null } })).toBeNull();
  });

  it("без своей ветки или без базы сдавать нечего", () => {
    expect(parentDelivery({ ...child, branch: null })).toBeNull();
    expect(parentDelivery({ ...child, base: null })).toBeNull();
    expect(parentDelivery({ ...child, parent: { ...parent, branchName: null } })).toBeNull();
  });

  it("тред в той же ветке, что родитель, в себя не сдаёт", () => {
    expect(parentDelivery({ ...child, branch: "bb/umbrella-thr_p" })).toBeNull();
  });
});
