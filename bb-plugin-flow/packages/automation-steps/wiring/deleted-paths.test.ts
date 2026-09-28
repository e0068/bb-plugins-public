import { describe, expect, it } from "vitest";

import { deletedPathsSince } from "./deleted-paths";

const ports = (code: number, stdout: string) => ({ run: async () => ({ code, stdout, stderr: code === 0 ? "" : "fatal: bad revision" }) });

describe("deletedPathsSince", () => {
  it("git не ответил — шаг падает, а не собирает PR без удалений", async () => {
    await expect(deletedPathsSince(ports(128, ""), "a".repeat(40))).rejects.toThrow("fatal: bad revision");
  });

  it("ответ git — список удалённых путей", async () => {
    expect(await deletedPathsSince(ports(0, "old/t.md\0"), "a".repeat(40))).toEqual(["old/t.md"]);
  });
});
