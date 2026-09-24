// @vitest-environment node
// Первое чтение указателя, которое вернулось позже записи того же указателя, свежий указатель не затирает.
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import type { FlowProgress } from "../shared/contract";
import { createProgress } from "./progress";

const at = "2026-09-23T15:00:00.000Z";
const started: FlowProgress = { stages: { review: { startedAt: at, finishedAt: at }, demo: { startedAt: at } }, waiting: [] };

describe("кэш указателей под параллельными правками", () => {
  it("опрос баннера нового треда во время передачи не заводит ему второй прогон", async () => {
    const { bb } = createFakePluginHost({ pluginId: "flow" });
    const kv = bb.storage.kv;
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    // Чтение указателя нового треда снимает значение сразу, а отдаёт его, только когда передача уже записана.
    const slow = new Proxy(kv, {
      get: (target, key, receiver) =>
        key === "get"
          ? async (k: string) => {
              const value = await target.get(k);
              if (k === "flow-thread:thr_new") await gate;
              return value;
            }
          : Reflect.get(target, key, receiver),
    });
    const progress = createProgress(slow);
    await progress.update("thr_src", () => started);
    const polled = progress.get("thr_new");
    await new Promise((resolve) => setTimeout(resolve, 0));
    const handed = progress.handOver("thr_src", "thr_new", [{ id: "demo", run: true, executor: "self" }]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    release();
    await Promise.all([polled, handed]);
    await progress.update("thr_new", (p) => p);
    expect(await kv.list("flow-progress:")).toHaveLength(1);
    expect(await progress.get("thr_src")).toEqual(await progress.get("thr_new"));
  });
});
