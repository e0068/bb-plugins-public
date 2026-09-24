// @vitest-environment node
// Хранилище прогресса: сколько чтений kv стоит опрос, какие ключи остаются после треда
// и что видит тред, отдавший работу, когда носитель начал следующий прогон.
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import type { FlowProgress } from "../shared/contract";
import { createProgress } from "./progress";

const at = "2026-09-23T15:00:00.000Z";
const started: FlowProgress = { stages: { review: { startedAt: at, finishedAt: at }, demo: { startedAt: at } }, waiting: [], lastBriefId: "dec_src" };
const finished: FlowProgress = { stages: { review: { startedAt: at, finishedAt: at }, demo: { startedAt: at, finishedAt: at } }, waiting: [], lastBriefId: "dec_new" };
const next: FlowProgress = { stages: { task: { startedAt: at } }, waiting: [] };
const rerun = [{ id: "demo", run: true, executor: "self" }];

/** Хранилище над kv, который считает чтения; `seeded` — записи, лежащие до правки, `handedTo` — ответы брифов с тредом передачи. */
const setup = async (options: { handedTo?: Record<string, string>; seeded?: Record<string, FlowProgress> } = {}) => {
  const { bb } = createFakePluginHost({ pluginId: "flow" });
  const kv = bb.storage.kv;
  await Promise.all(Object.entries(options.seeded ?? {}).map(([threadId, record]) => kv.set(`flow-progress:${threadId}`, record)));
  let reads = 0;
  const counted = new Proxy(kv, {
    get: (target, key, receiver) => (key === "get" ? (k: string) => ((reads += 1), target.get(k)) : Reflect.get(target, key, receiver)),
  });
  const progress = createProgress(counted, { handedTo: async (briefId) => options.handedTo?.[briefId] });
  /** Чтения kv за одну операцию. */
  const readsOf = async (work: () => Promise<unknown>) => {
    const before = reads;
    await work();
    return reads - before;
  };
  const keys = async () => [...(await kv.list("flow-thread:")), ...(await kv.list("flow-progress:"))].sort();
  return { progress, readsOf, keys };
};

describe("чтения хранилища на опросе", () => {
  it("прогон треда вместе с носителем — одно чтение", async () => {
    const { progress, readsOf } = await setup();
    await progress.update("thr_1", () => started);
    await progress.run("thr_1");
    expect(await readsOf(() => progress.run("thr_1"))).toBe(1);
  });

  it("прогон треда, отдавшего работу, — тоже одно чтение", async () => {
    const { progress, readsOf } = await setup();
    await progress.update("thr_src", () => started);
    await progress.handOver("thr_src", "thr_new", rerun);
    await progress.run("thr_src");
    expect(await readsOf(() => progress.run("thr_src"))).toBe(1);
    expect((await progress.run("thr_src"))?.carrier).toBe("thr_new");
  });

  it("список носителей — одно чтение на прогон", async () => {
    const { progress, readsOf } = await setup();
    await progress.update("thr_a", () => started);
    await progress.update("thr_b", () => started);
    await progress.threads();
    expect(await readsOf(() => progress.threads())).toBe(2);
  });

  it("тред без прогона — не больше одного чтения", async () => {
    const { progress, readsOf } = await setup();
    await progress.run("thr_empty");
    expect(await readsOf(() => progress.run("thr_empty"))).toBeLessThanOrEqual(1);
    expect(await progress.run("thr_empty")).toBeNull();
  });
});

describe("ключи после треда", () => {
  it("удалённый тред со своим прогоном не оставляет ключей", async () => {
    const { progress, keys } = await setup();
    await progress.update("thr_1", () => started);
    await progress.forget("thr_1");
    expect(await keys()).toEqual([]);
  });

  it("удалённый тред, отдавший работу, снимает свой указатель, а прогон носителя остаётся", async () => {
    const { progress, keys } = await setup({ seeded: { thr_src: started } });
    await progress.handOver("thr_src", "thr_new", rerun);
    await progress.forget("thr_src");
    expect(await keys()).not.toContain("flow-thread:thr_src");
    expect(await progress.get("thr_new")).not.toBeNull();
  });

  it("передача работы ключей треда, отдавшего её, не снимает", async () => {
    const { progress, keys } = await setup();
    await progress.update("thr_src", () => started);
    await progress.handOver("thr_src", "thr_new", rerun);
    expect(await keys()).toEqual(expect.arrayContaining(["flow-thread:thr_src", "flow-thread:thr_new"]));
    expect(await progress.get("thr_src")).not.toBeNull();
  });
});

describe("следующий прогон носителя", () => {
  it("тред, отдавший работу, баннера не показывает", async () => {
    const { progress } = await setup();
    await progress.update("thr_src", () => started);
    await progress.handOver("thr_src", "thr_new", rerun);
    await progress.remove("thr_new");
    await progress.update("thr_new", () => next);
    expect(await progress.get("thr_src")).toBeNull();
  });

  it("тред, переданный до правки, новый прогон соседа не подхватывает", async () => {
    const { progress } = await setup({ handedTo: { dec_src: "thr_new" }, seeded: { thr_src: started, thr_new: finished } });
    await progress.remove("thr_new");
    await progress.update("thr_new", () => next);
    expect(await progress.get("thr_src")).toBeNull();
    expect(await progress.get("thr_new")).toMatchObject(next);
  });

  it("цепочка A→B→C, переданная до правки: после нового прогона C баннера нет ни у B, ни у A", async () => {
    const middle: FlowProgress = { ...finished, lastBriefId: "dec_mid" };
    const { progress } = await setup({ handedTo: { dec_src: "thr_mid", dec_mid: "thr_new" }, seeded: { thr_src: started, thr_mid: middle, thr_new: finished } });
    await progress.remove("thr_new");
    await progress.update("thr_new", () => next);
    expect(await progress.get("thr_mid")).toBeNull();
    expect(await progress.get("thr_src")).toBeNull();
  });

  it("тред, переданный до правки и уже найденный, после нового прогона соседа тоже без баннера", async () => {
    const { progress } = await setup({ handedTo: { dec_src: "thr_new" }, seeded: { thr_src: started, thr_new: finished } });
    expect(await progress.get("thr_src")).toEqual(finished);
    await progress.remove("thr_new");
    await progress.update("thr_new", () => next);
    expect(await progress.get("thr_src")).toBeNull();
  });
});
