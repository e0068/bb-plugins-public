import { describe, expect, it } from "vitest";

import type { CliPorts, CliRun } from "./wiring/bb-cli-run";
import { isStepId, STEP_IDS, STEP_LABELS } from "./catalog";
import { createSteps, selfUpdatePendingKey, type StepPorts } from "./steps";
import type { PluginsPort } from "./wiring/plugin-reinstall";

const ran = (stdout: string, code = 0): CliRun => ({ kind: "ran", code, stdout, stderr: code === 0 ? "" : "refused" });

const kv = () => {
  const data = new Map<string, unknown>();
  return {
    get: async <T>(key: string) => data.get(key) as T | undefined,
    set: async (key: string, value: unknown) => void data.set(key, value),
    delete: async (key: string) => void data.delete(key),
    list: async () => [...data.keys()],
  };
};

/** SDK с тем, что шаги спрашивают у треда и окружения; всё остальное падает, как упал бы bb без окружения. */
const sdk = (over: { archive?: () => Promise<unknown>; environment?: { path: string | null }; merge?: (args: { method: string }) => Promise<unknown> }) =>
  ({
    threads: {
      get: async () => ({ id: "t1", environmentId: over.environment === undefined ? null : "e1", title: "T" }),
      archive: over.archive ?? (async () => ({})),
    },
    environments: {
      get: async () => ({ id: "e1", hostId: "h", path: over.environment?.path ?? null, branchName: "b", baseBranch: "main", remoteUrl: null }),
      mergePullRequest: over.merge ?? (async () => ({})),
    },
  }) as unknown as StepPorts["sdk"];

/** Плагины хоста: шаги, кроме обновления, их не трогают, поэтому любой вызов — это уже ошибка теста. */
const plugins: PluginsPort = {
  list: async () => ({ plugins: [] }),
  applyUpdate: async () => {
    throw new Error("applyUpdate не должен вызываться");
  },
  install: async () => {
    throw new Error("install не должен вызываться");
  },
  remove: async () => {
    throw new Error("remove не должен вызываться");
  },
};

const ports = (over: Parameters<typeof sdk>[0], cli?: CliPorts, store = kv()): StepPorts => ({
  sdk: sdk(over),
  kv: store,
  // Токен задан, чтобы шаг не ходил за ним в `gh` на машине, где идут тесты.
  settings: { get: async () => ({ githubToken: "token" }) },
  plugins,
  ownPluginId: "flow",
  ...(cli === undefined ? {} : { cli }),
});

describe("createSteps", () => {
  it("архив, отказанный bb, отвечает ok false с текстом отказа", async () => {
    const steps = createSteps(ports({ archive: async () => Promise.reject(new Error("thread is busy")) }));
    expect(await steps["bb.archive"]("t1")).toEqual({ ok: false, error: "thread is busy" });
  });

  it("архив без отказа отвечает ok true", async () => {
    expect(await createSteps(ports({}))["bb.archive"]("t1")).toEqual({ ok: true, detail: null });
  });

  it("исключение шага не вылетает наружу, а становится ok false", async () => {
    const outcome = await createSteps(ports({}))["git.fast-forward"]("t1");
    expect(outcome.ok).toBe(false);
    expect(outcome).toMatchObject({ error: expect.stringContaining("no environment") });
  });

  it("неудачный pull main отвечает ok false с причиной", async () => {
    const outcome = await createSteps(ports({ environment: { path: null } }))["git.pull-main"]("t1");
    expect(outcome).toMatchObject({ ok: false, error: expect.any(String) });
  });

  it("задачи, которые не перевелись, дают ok false со списком ключей", async () => {
    const cli: CliPorts = {
      run: async (args) => (args[1] === "current" ? ran(JSON.stringify({ tasks: [{ key: "BBPL-1" }, { key: "BBPL-2" }] })) : ran("", args[2] === "BBPL-2" ? 1 : 0)),
    };
    const outcome = await createSteps(ports({}, cli))["bb.tasks-done"]("t1");
    expect(outcome).toMatchObject({ ok: false, error: expect.stringContaining("BBPL-2") });
  });

  it("переведённые задачи называются в итоге шага", async () => {
    const cli: CliPorts = { run: async (args) => (args[1] === "current" ? ran(JSON.stringify({ tasks: [{ key: "BBPL-1" }] })) : ran("")) };
    expect(await createSteps(ports({}, cli))["bb.tasks-in-review"]("t1")).toEqual({ ok: true, detail: "BBPL-1" });
  });

  // Ветка в main должна ложиться коммитом слияния: сквош оставлял в main
  // коммит с одним родителем, и локальный main после него расходился с origin.
  it("PR вливается коммитом слияния, а не сквошем", async () => {
    const methods: string[] = [];
    const steps = createSteps(ports({ environment: { path: "/tmp/w" }, merge: async ({ method }) => void methods.push(method) }));
    expect(await steps["git.merge"]("t1")).toEqual({ ok: true, detail: null });
    expect(methods).toEqual(["merge"]);
  });

  // Пустой список — законный случай, но молчаливая галочка под ним прятала
  // поломку: шаг отмечался сделанным, а задача оставалась в работе.
  it("шаг, не нашедший ни одной задачи, говорит об этом строкой", async () => {
    const cli: CliPorts = { run: async () => ran(JSON.stringify({ tasks: [] })) };
    expect(await createSteps(ports({}, cli))["bb.tasks-done"]("t1")).toEqual({ ok: true, detail: "no linked tasks" });
  });

  it("у каждого id есть подписи на двух языках и распознавание id", () => {
    for (const id of STEP_IDS) {
      expect(STEP_LABELS[id].en.length).toBeGreaterThan(0);
      expect(STEP_LABELS[id].ru.length).toBeGreaterThan(0);
      expect(isStepId(id)).toBe(true);
    }
    expect(isStepId("git.push")).toBe(false);
  });
});

describe("шаги бампа и обновления плагинов", () => {
  it("каждый разряд бампа — свой шаг каталога", () => {
    const steps = createSteps(ports({}));
    for (const id of ["files.bump-major", "files.bump-minor", "files.bump-patch"] as const) {
      expect(typeof steps[id]).toBe("function");
      expect(STEP_LABELS[id].en.startsWith("Bump ")).toBe(true);
    }
  });

  it("бамп в треде без окружения — провал с причиной, а не исключение", async () => {
    const outcome = await createSteps(ports({}))["files.bump-major"]("t1");
    expect(outcome).toMatchObject({ ok: false, error: expect.stringContaining("no environment") });
  });

  it("бамп без PR называет причину и ничего не поднимает", async () => {
    const outcome = await createSteps(ports({ environment: { path: "/tmp/x" } }))["files.bump-minor"]("t1");
    expect(outcome).toMatchObject({ ok: false, error: expect.stringContaining("Versions not raised") });
  });

  it("обновление плагинов без PR называет причину и не трогает плагины", async () => {
    const outcome = await createSteps(ports({ environment: { path: "/tmp/x" } }))["bb.reinstall"]("t1");
    expect(outcome).toMatchObject({ ok: false, error: expect.stringContaining("Plugins not updated") });
  });

  it("шаг обновления, ответивший провалом, самообновление не откладывает", async () => {
    const store = kv();
    const outcome = await createSteps(ports({ environment: { path: "/tmp/x" } }, undefined, store))["bb.reinstall"]("t1");
    expect(outcome.ok).toBe(false);
    expect(await store.get(selfUpdatePendingKey("t1"))).toBeUndefined();
  });

  it("ключ отложенного самообновления считается по треду", () => {
    expect(selfUpdatePendingKey("thr_1")).toBe("self-update-pending:thr_1");
    expect(selfUpdatePendingKey("thr_2")).not.toBe(selfUpdatePendingKey("thr_1"));
  });
});
