// «Смёрджить PR» без найденного PR спрашивает, лежит ли код окружения уже в main (BBPL-987): спрашивается git
// рабочей копии окружения, а копии на диске нет — ответ «не узнать», и шаг не выдумывает «уже влито».
import { describe, expect, it } from "vitest";

import type { GitPorts, GitRun } from "../wiring/git-run";
import { environmentInMain, type Sdk } from "./pr-helpers";

const ok: GitRun = { code: 0, stdout: "", stderr: "" };

const sdkOf = (path: string | null) =>
  ({ environments: { get: async () => ({ id: "e1", hostId: "h", path, branchName: "b", baseBranch: "main", defaultBranch: null, mergeBaseBranch: null }) } }) as unknown as Sdk;

const gitAt = () => {
  const opened: string[] = [];
  const git = (path: string): GitPorts => (opened.push(path), { run: async () => ok });
  return { opened, git };
};

describe("код окружения в main", () => {
  it("спрашивается git рабочей копии окружения: коммит ветки в main — «in-main»", async () => {
    const { opened, git } = gitAt();
    expect(await environmentInMain(sdkOf("/wt"), git, "e1")).toBe("in-main");
    expect(opened).toEqual(["/wt"]);
  });

  it("у окружения нет копии на диске — «не узнать», git не трогается", async () => {
    const { opened, git } = gitAt();
    expect(await environmentInMain(sdkOf(null), git, "e1")).toBe("unknown");
    expect(opened).toEqual([]);
  });
});
