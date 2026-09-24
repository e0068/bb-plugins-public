// @vitest-environment node
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import type { DecisionBrief } from "../shared/contract";
import { createProgress } from "./progress";

const AT = "2026-09-24T00:00:00.000Z";

const brief = (threadId: string): DecisionBrief =>
  ({ id: `dec_${threadId}`, threadId, kind: "brief", title: "Бриф", createdAt: AT, questions: [], setup: { stages: [{ id: "task", state: "todo", recommended: true }] } }) as unknown as DecisionBrief;

const store = () => {
  const { bb } = createFakePluginHost({ pluginId: "flow" });
  return createProgress(bb.storage.kv);
};

describe("треды прогона", () => {
  it("прогон, переданный дальше дважды, числит все три треда, через которые прошёл", async () => {
    const progress = store();
    await progress.recordBrief(brief("thr_a"), AT);
    await progress.handOver("thr_a", "thr_b", []);
    await progress.handOver("thr_b", "thr_c", []);
    expect((await progress.members("thr_c")).sort()).toEqual(["thr_a", "thr_b", "thr_c"]);
    expect((await progress.members("thr_a")).sort()).toEqual(["thr_a", "thr_b", "thr_c"]);
  });

  it("тред другого прогона в список не попадает", async () => {
    const progress = store();
    await progress.recordBrief(brief("thr_a"), AT);
    await progress.recordBrief(brief("thr_other"), AT);
    expect(await progress.members("thr_a")).toEqual(["thr_a"]);
  });

  it("тред без прогона — только он сам", async () => {
    expect(await store().members("thr_lonely")).toEqual(["thr_lonely"]);
  });
});
