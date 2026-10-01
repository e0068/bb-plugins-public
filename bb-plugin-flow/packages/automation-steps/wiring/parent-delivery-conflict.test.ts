import { describe, expect, it } from "vitest";

import { CatchUpConflict, runParentDelivery } from "./catch-up";
import type { GitPorts, GitRun } from "./git-run";

const ok = (stdout = ""): GitRun => ({ code: 0, stdout, stderr: "" });

describe("конфликт при доставке ветки в родителя", () => {
  it("называет файлы, но не зовётся конфликтом догоняния: агент дочернего треда тут ничего не сводит", async () => {
    const ports: GitPorts = {
      async run(args) {
        const line = args.join(" ");
        if (args[0] === "symbolic-ref") return ok("parent\n");
        if (line.startsWith("merge-base --is-ancestor")) return { code: 1, stdout: "", stderr: "" };
        if (line.startsWith("rev-parse -q --verify")) return { code: 1, stdout: "", stderr: "" };
        if (line.startsWith("diff --name-only")) return ok("a.ts\n");
        if (line === "merge --abort") return ok();
        if (args[0] === "merge") return { code: 1, stdout: "", stderr: "CONFLICT" };
        return ok();
      },
    };
    const failure = await runParentDelivery(ports, { branch: "child", parentBranch: "parent" }).then(
      () => null,
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(CatchUpConflict);
    expect((failure as Error).message).toContain("a.ts");
  });
});
