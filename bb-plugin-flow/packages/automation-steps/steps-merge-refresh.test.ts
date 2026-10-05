// «Смёрджить PR» вливает то, что закоммичено в ветке треда, а не то, что лежало
// в PR на шаге «Открыть PR»: PR собирается через API без пуша, и коммиты после
// его открытия иначе на GitHub не попадают — так потерялись три коммита PR #685.
import { describe, expect, it } from "vitest";

import { createSteps, lastBumpKey, MERGE_REFRESHED, type StepPorts } from "./steps";
import type { PluginsPort } from "./wiring/plugin-reinstall";

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

/** Журнал того, что шаг сделал с PR, по порядку. */
const harness = (refresh: StepPorts["refreshPr"], store = kv()) => {
  const log: string[] = [];
  const sdk = {
    threads: { get: async () => ({ id: "t1", environmentId: "e1", title: "T" }) },
    environments: {
      get: async () => ({ id: "e1", hostId: "h", path: "/tmp/w", branchName: "b", baseBranch: "main", remoteUrl: null }),
      mergePullRequest: async ({ method }: { method: string }) => void log.push(`merge:${method}`),
    },
  } as unknown as StepPorts["sdk"];
  const ports: StepPorts = {
    sdk,
    kv: store,
    settings: { get: async () => ({ githubToken: "token" }) },
    plugins,
    ownPluginId: "flow",
    refreshPr: async (threadId) => {
      log.push(`refresh:${threadId}`);
      return refresh!(threadId);
    },
  };
  return { steps: createSteps(ports), log };
};

describe("«Смёрджить PR» и коммиты после «Открыть PR»", () => {
  it("сначала догоняет ветку открытого PR до ветки треда, потом вливает её коммитом слияния", async () => {
    const { steps, log } = harness(async () => "updated");
    expect(await steps["git.merge"]("t1")).toMatchObject({ ok: true });
    expect(log).toEqual(["refresh:t1", "merge:merge"]);
  });

  it("PR уже на ветке треда — вливает без лишнего обновления", async () => {
    const { steps, log } = harness(async () => "unchanged");
    expect(await steps["git.merge"]("t1")).toMatchObject({ ok: true });
    expect(log).toEqual(["refresh:t1", "merge:merge"]);
  });

  it("незакоммиченное в дереве — шаг падает с причиной и старое содержимое PR не вливает", async () => {
    const { steps, log } = harness(async () => Promise.reject(new Error("Can't update the open PR right now (dirty) — commit the changes first.")));
    const outcome = await steps["git.merge"]("t1");
    expect(outcome).toMatchObject({ ok: false, error: expect.stringContaining("dirty") });
    expect(log).toEqual(["refresh:t1"]);
  });
});

describe("версия после догоняния PR", () => {
  it("догнанный PR называет это в строке шага", async () => {
    const { steps } = harness(async () => "updated");
    expect(await steps["git.merge"]("t1")).toMatchObject({ ok: true, detail: MERGE_REFRESHED });
  });

  it("PR догнан, а бамп был — версия поднимается заново; не поднялась — мёрджа нет", async () => {
    const store = kv();
    await store.set(lastBumpKey("e1"), "patch");
    const { steps, log } = harness(async () => "updated", store);
    expect(await steps["git.merge"]("t1")).toMatchObject({ ok: false, error: expect.stringContaining("Versions not raised") });
    expect(log).toEqual(["refresh:t1"]);
  });

  it("PR не менялся — бамп на нём цел, заново версию не поднимает", async () => {
    const store = kv();
    await store.set(lastBumpKey("e1"), "patch");
    const { steps, log } = harness(async () => "unchanged", store);
    expect(await steps["git.merge"]("t1")).toMatchObject({ ok: true });
    expect(log).toEqual(["refresh:t1", "merge:merge"]);
  });
});
