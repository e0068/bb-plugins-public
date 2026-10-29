// BBPL-992: PR #862 влили, а шаг Commit той же автоматизации положил в ветку журнал прогона и слил origin/main.
// Открытого PR у ветки больше нет, код ветки в main не весь — «Смёрджить PR» падал «not found» на каждом повторе.
// Хвост после влитого PR доезжает до main своим PR; PR, закрытый без мёржа, шаг в обход владельца не вливает.
import { describe, expect, it } from "vitest";

import type { GithubRequest } from "./core/github-requests";
import { createSteps, mergeTailOpened, type StepPorts } from "./steps";
import type { GithubResponse } from "./wiring/create-pr";
import type { GitPorts, GitRun } from "./wiring/git-run";
import type { PluginsPort } from "./wiring/plugin-reinstall";

const TREE = "83c99fce74321c0bbe9b3c67361a5c41006f43dd";
const OTHER_TREE = "1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d";
const REPO = "/repos/e0068/bb-plugins";

const ok = (stdout = ""): GitRun => ({ code: 0, stdout, stderr: "" });
const code = (value: number): GitRun => ({ code: value, stdout: "", stderr: "" });

type Main = "in-main" | "not-in-main" | "unknown";

/** git дерева треда: где код ветки относительно origin/main, ответ по подкоманде. */
const gitOf = (main: Main): GitPorts => ({
  run: async ([command]) => {
    if (main === "unknown") return code(128);
    if (command === "fetch") return ok();
    if (command === "merge-base") return main === "in-main" ? ok() : code(1);
    if (command === "merge-tree") return ok(`${OTHER_TREE}\n`);
    if (command === "rev-parse") return ok(`${TREE}\n`);
    return code(128);
  },
});

/** Закрытые PR ветки у GitHub, новые первыми. */
const MERGED = [{ number: 862, merged_at: "2026-10-27T16:30:00Z" }];
const CLOSED_UNMERGED = [{ number: 863, merged_at: null }, ...MERGED];
const NONE: unknown[] = [];

/** GitHub: закрытые PR ветки, открытых нет, хвост — один журнал прогона, новый PR #870 вливаемый. */
const githubOf = (closed: unknown[], calls: string[]) => (): { send(req: GithubRequest): Promise<GithubResponse> } => ({
  async send(req) {
    calls.push(`${req.method} ${req.path.replace(REPO, "")}`);
    if (req.path.includes("state=closed")) return { status: 200, data: closed };
    if (req.path.includes("state=open")) return { status: 200, data: [] };
    if (req.path.includes("/compare/")) return { status: 200, data: { behind_by: 0, files: [{ filename: "docs/flows/flow-stop-i-shevron-bannera.md" }] } };
    if (req.method === "GET" && req.path.endsWith("/pulls/870")) return { status: 200, data: { state: "open", merged: false, mergeable: true } };
    if (req.method === "PUT" && req.path.endsWith("/pulls/870/merge")) return { status: 200, data: { merged: true } };
    return { status: 404, data: { message: "Not Found" } };
  },
});

const kv = () => {
  const data = new Map<string, unknown>();
  return {
    get: async <T>(key: string) => data.get(key) as T | undefined,
    set: async (key: string, value: unknown) => void data.set(key, value),
    delete: async (key: string) => void data.delete(key),
    list: async () => [...data.keys()],
  };
};

const plugins: PluginsPort = {
  list: async () => ({ plugins: [] }),
  applyUpdate: async () => Promise.reject(new Error("не нужен")),
  install: async () => Promise.reject(new Error("не нужен")),
  remove: async () => Promise.reject(new Error("не нужен")),
};

/** bb 0.47.1: у хоста нет метода мёржа, открытого PR у ветки нет; журнал — что шаг сделал с PR и спросил у GitHub. */
const harness = ({ main, closed, openFails = false }: { main: Main; closed: unknown[]; openFails?: boolean }) => {
  const log: string[] = [];
  const github: string[] = [];
  const sdk = {
    threads: { get: async () => ({ id: "t1", environmentId: "e1", parentThreadId: null, title: "T" }) },
    environments: {
      get: async () => ({ id: "e1", hostId: "h", path: "/wt", branchName: "bb/thr_hzir73pbbg", baseBranch: "main", defaultBranch: null, mergeBaseBranch: null, remoteUrl: null }),
      status: async () => ({ outcome: "available", workspace: { workingTree: { hasUncommittedChanges: false } } }),
    },
    files: {
      read: async ({ path }: { path: string }) => {
        if (path !== "/wt/.git/config") throw new Error("not a file");
        return { content: '[remote "origin"]\n\turl = https://github.com/e0068/bb-plugins.git\n', contentEncoding: "utf8" };
      },
    },
  } as unknown as StepPorts["sdk"];
  const ports = {
    sdk,
    kv: kv(),
    settings: { get: async () => ({ githubToken: "token" }) },
    plugins,
    ownPluginId: "flow",
    git: () => gitOf(main),
    github: githubOf(closed, github),
    refreshPr: async (threadId: string) => (log.push(`refresh:${threadId}`), "no-open-pr" as const),
    openPr: async (threadId: string) => {
      log.push(`open:${threadId}`);
      if (openFails) throw new Error("Can't open a PR right now (nothing-to-pr).");
      return { url: "https://github.com/e0068/bb-plugins/pull/870", number: 870 };
    },
  } as StepPorts;
  return { steps: createSteps(ports), log, github };
};

describe("«Смёрджить PR» после влитого PR, когда на ветке новые коммиты", () => {
  it("кода ветки в main нет, последний PR влит — шаг открывает PR на хвост, вливает его и называет это", async () => {
    const { steps, log, github } = harness({ main: "not-in-main", closed: MERGED });
    expect(await steps["git.merge"]("t1")).toMatchObject({ ok: true, detail: expect.stringContaining(mergeTailOpened(870)) });
    expect(log).toEqual(["refresh:t1", "open:t1"]);
    expect(github).toContain("PUT /pulls/870/merge");
  });

  it("хвост не открыть — шаг красный с причиной, мёрдж не засчитан и не пробуется", async () => {
    const { steps, github } = harness({ main: "not-in-main", closed: MERGED, openFails: true });
    expect(await steps["git.merge"]("t1")).toMatchObject({ ok: false, error: expect.stringContaining("nothing-to-pr") });
    expect(github.filter((call) => call.startsWith("PUT"))).toEqual([]);
  });

  it("последний PR ветки закрыт без мёржа — шаг красный с этой причиной и PR не открывает", async () => {
    const { steps, log, github } = harness({ main: "not-in-main", closed: CLOSED_UNMERGED });
    expect(await steps["git.merge"]("t1")).toMatchObject({ ok: false, error: expect.stringContaining("closed without a merge") });
    expect(log).not.toContain("open:t1");
    expect(github.filter((call) => call.startsWith("PUT"))).toEqual([]);
  });

  it("влитого PR у ветки не было — шаг PR не открывает и падает, как раньше, «not found»", async () => {
    const { steps, log } = harness({ main: "not-in-main", closed: NONE });
    expect(await steps["git.merge"]("t1")).toMatchObject({ ok: false, error: expect.stringContaining("not found") });
    expect(log).not.toContain("open:t1");
  });

  it("код ветки уже в main — шаг зелёный «уже влито», новый PR не открывается", async () => {
    const { steps, log } = harness({ main: "in-main", closed: MERGED });
    expect(await steps["git.merge"]("t1")).toMatchObject({ ok: true, detail: "already merged" });
    expect(log).not.toContain("open:t1");
  });

  it("проверить main не вышло — шаг не открывает PR наугад и не выдумывает «уже влито»", async () => {
    const { steps, log } = harness({ main: "unknown", closed: MERGED });
    expect(await steps["git.merge"]("t1")).toMatchObject({ ok: false });
    expect(log).not.toContain("open:t1");
  });
});
