// @vitest-environment node
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import type { FlowProgress } from "../shared/contract";
import { createProgress } from "./progress";

const at = "2026-09-23T15:00:00.000Z";
const started: FlowProgress = { stages: { review: { startedAt: at, finishedAt: at }, demo: { startedAt: at } }, waiting: [], lastBriefId: "dec_src" };
const finished: FlowProgress = { stages: { review: { startedAt: at, finishedAt: at }, demo: { startedAt: at, finishedAt: at } }, waiting: [], lastBriefId: "dec_new" };
const run = [{ id: "demo", run: true, executor: "self" }];

/** Хранилище на пустом kv; `handedTo` — ответы брифов с тредом передачи, `seeded` — записи, лежащие до правки. */
const setup = async (options: { handedTo?: Record<string, string>; seeded?: Record<string, FlowProgress> } = {}) => {
  const { bb } = createFakePluginHost({ pluginId: "flow" });
  await Promise.all(Object.entries(options.seeded ?? {}).map(([threadId, record]) => bb.storage.kv.set(`flow-progress:${threadId}`, record)));
  const changed: string[] = [];
  const progress = createProgress(bb.storage.kv, { onChange: (threadId) => changed.push(threadId), handedTo: async (briefId) => options.handedTo?.[briefId] });
  return { progress, changed };
};

describe("прогон под одним адресом", () => {
  it("тред без передачи читает и пишет свою запись, как раньше", async () => {
    const { progress, changed } = await setup();
    await progress.update("thr_a", () => started);
    expect(await progress.get("thr_a")).toMatchObject(started);
    expect(await progress.carrier("thr_a")).toBe("thr_a");
    expect(changed).toEqual(["thr_a"]);
  });

  it("после передачи оба треда видят одну и ту же запись, а ведёт её новый", async () => {
    const { progress } = await setup();
    await progress.update("thr_src", () => started);
    await progress.handOver("thr_src", "thr_new", run);
    expect(await progress.get("thr_src")).toEqual(await progress.get("thr_new"));
    expect(await progress.carrier("thr_src")).toBe("thr_new");
    expect(await progress.carrier("thr_new")).toBe("thr_new");
  });

  it("правка из нового треда видна в исходном", async () => {
    const { progress } = await setup();
    await progress.update("thr_src", () => started);
    await progress.handOver("thr_src", "thr_new", run);
    await progress.update("thr_new", (p) => ({ ...p, stages: { ...p.stages, demo: { startedAt: at, finishedAt: at } } }));
    expect((await progress.get("thr_src"))?.stages.demo?.finishedAt).toBe(at);
  });

  it("исполнитель автоматизаций будится в треде-носителе, откуда бы ни пришла правка", async () => {
    const { progress, changed } = await setup();
    await progress.update("thr_src", () => started);
    await progress.handOver("thr_src", "thr_new", run);
    changed.length = 0;
    await progress.update("thr_src", (p) => p);
    expect(changed).toEqual(["thr_new"]);
  });

  it("бриф из треда, отдавшего работу, прогон носителя не трогает", async () => {
    const { progress } = await setup();
    await progress.update("thr_src", () => started);
    await progress.handOver("thr_src", "thr_new", run);
    const before = await progress.get("thr_new");
    const brief = { id: "dec_late", threadId: "thr_src", kind: "brief", title: "Поздний бриф", createdAt: at, questions: [], outcome: { stage: "demo", final: false, done: [], pending: [], results: [{ label: "PR", target: "https://example.com" }] } };
    await progress.recordBrief(brief as never, at);
    expect(await progress.get("thr_new")).toEqual(before);
  });

  it("передача по цепочке A→B→C приводит A к носителю C", async () => {
    const { progress } = await setup();
    await progress.update("thr_a", () => started);
    await progress.handOver("thr_a", "thr_b", run);
    await progress.handOver("thr_b", "thr_c", run);
    expect(await progress.carrier("thr_a")).toBe("thr_c");
    expect(await progress.get("thr_a")).toEqual(await progress.get("thr_c"));
  });

  it("список прогонов называет каждый прогон один раз, его носителем", async () => {
    const { progress } = await setup();
    await progress.update("thr_src", () => started);
    await progress.handOver("thr_src", "thr_new", run);
    await progress.update("thr_plain", () => started);
    expect((await progress.threads()).sort()).toEqual(["thr_new", "thr_plain"]);
  });
});

describe("тред, переданный до правки", () => {
  const legacy = { handedTo: { dec_src: "thr_new" }, seeded: { thr_src: started, thr_new: finished } };

  it("находит прогон треда передачи по ответу на свой последний бриф — без правки старых записей", async () => {
    const { progress } = await setup(legacy);
    expect(await progress.get("thr_src")).toEqual(finished);
    expect(await progress.carrier("thr_src")).toBe("thr_new");
  });

  it("его старая копия в список прогонов не попадает", async () => {
    const { progress } = await setup(legacy);
    expect(await progress.threads()).toEqual(["thr_new"]);
  });

  it("кольцо передач не зацикливает поиск: тред остаётся при своей записи", async () => {
    const { progress } = await setup({ handedTo: { dec_src: "thr_new", dec_new: "thr_src" }, seeded: { thr_src: started, thr_new: finished } });
    expect(await progress.get("thr_src")).not.toBeNull();
  });

  it("тред без записи прогона не получает", async () => {
    const { progress } = await setup(legacy);
    expect(await progress.get("thr_other")).toBeNull();
    expect(await progress.carrier("thr_other")).toBe("thr_other");
  });
});

describe("удалённый тред", () => {
  it("тред, отдавший работу, уходит, не забирая прогон у носителя", async () => {
    const { progress } = await setup();
    await progress.update("thr_src", () => started);
    await progress.handOver("thr_src", "thr_new", run);
    await progress.remove("thr_src");
    expect(await progress.get("thr_new")).not.toBeNull();
  });

  it("тред, отдавший работу, начинает следующий прогон со своей записью, не трогая прогон носителя", async () => {
    const { progress } = await setup();
    await progress.update("thr_src", () => started);
    await progress.handOver("thr_src", "thr_new", run);
    await progress.remove("thr_src");
    expect(await progress.get("thr_src")).toBeNull();
    await progress.update("thr_src", () => finished);
    expect(await progress.get("thr_src")).toMatchObject(finished);
    expect(await progress.carrier("thr_src")).toBe("thr_src");
    expect(await progress.get("thr_new")).toMatchObject({ stages: { demo: { executor: "self" } } });
  });

  it("тред со старой записью, отдавший работу, сколько бы прогонов ни начал заново, прогон носителя не стирает", async () => {
    const { progress } = await setup({ seeded: { thr_src: started } });
    await progress.handOver("thr_src", "thr_new", run);
    await progress.remove("thr_src");
    await progress.update("thr_src", () => finished);
    await progress.remove("thr_src");
    expect(await progress.get("thr_new")).not.toBeNull();
  });

  it("тред со старой записью, отдавший работу, после второго нового прогона к прогону носителя снова не прирастает", async () => {
    const { progress } = await setup({ seeded: { thr_src: started } });
    await progress.handOver("thr_src", "thr_new", run);
    await progress.remove("thr_src");
    await progress.update("thr_src", () => finished);
    await progress.remove("thr_src");
    expect(await progress.get("thr_src")).toBeNull();
  });

  it("носитель уходит вместе с прогоном", async () => {
    const { progress } = await setup();
    await progress.update("thr_src", () => started);
    await progress.handOver("thr_src", "thr_new", run);
    await progress.remove("thr_new");
    expect(await progress.get("thr_new")).toBeNull();
    expect(await progress.threads()).toEqual([]);
  });
});
