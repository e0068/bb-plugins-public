import { describe, expect, it } from "vitest";
import { fastForwardArgs, fetchBaseArgs } from "./git-commands";

describe("git-commands", () => {
  it("fetchBaseArgs — fetch ремоута с именем базы", () => {
    expect(fetchBaseArgs("main")).toEqual(["fetch", "origin", "main"]);
  });

  it("fastForwardArgs — merge --ff-only на origin/<base>", () => {
    expect(fastForwardArgs("main")).toEqual(["merge", "--ff-only", "origin/main"]);
  });

  it("имя базы с слэшем сохраняется как есть", () => {
    expect(fastForwardArgs("release/1.2")).toEqual([
      "merge",
      "--ff-only",
      "origin/release/1.2",
    ]);
  });
});
