// @vitest-environment node
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it, vi } from "vitest";

import { COMPACT_PRESELECT_LABELS, type CompactPreselect } from "../core/context";
import { registerApi } from "./api";
import { compactPreselectedOf } from "./context";
import { createStore } from "./store";

const usage = (usedTokens: number) => ({
  type: "thread/contextWindowUsage/updated",
  data: { providerThreadId: "s1", contextWindowUsage: { usedTokens, modelContextWindow: 1_000_000, estimated: true } },
});

const sourceOf = (usedTokens: number | null) => ({ threads: { events: { list: vi.fn(async () => (usedTokens === null ? [] : [usage(usedTokens)])) } } });

const settingsOf = (preselect: CompactPreselect | undefined) => async () => ({
  contextWarnTokens: 250_000,
  contextAlertTokens: 400_000,
  ...(preselect === undefined ? {} : { compactPreselect: COMPACT_PRESELECT_LABELS[preselect] }),
});

describe("предвыбор компактации по заполненности окна треда", () => {
  it.each<[CompactPreselect | undefined, number, boolean]>([
    ["never", 900_000, false],
    ["warn", 249_999, false],
    ["warn", 250_000, true],
    ["warn", 400_000, true],
    ["alert", 399_999, false],
    ["alert", 400_000, true],
  ])("настройка %s, занято %i — предвыбор %s", async (preselect, used, expected) => {
    expect(await compactPreselectedOf(sourceOf(used) as never, settingsOf(preselect), "thr_1")).toBe(expected);
  });

  it("заполненность неизвестна — компактация не предвыбирается", async () => {
    expect(await compactPreselectedOf(sourceOf(null) as never, settingsOf("warn"), "thr_1")).toBe(false);
  });

  it("при «не выбирать» журнал треда не читается", async () => {
    const source = sourceOf(900_000);
    await compactPreselectedOf(source as never, settingsOf("never"), "thr_1");
    expect(source.threads.events.list).not.toHaveBeenCalled();
  });

  it("настройки не прочитались — компактация не предвыбирается", async () => {
    const failing = async () => {
      throw new Error("settings down");
    };
    expect(await compactPreselectedOf(sourceOf(900_000) as never, failing, "thr_1")).toBe(false);
  });
});

describe("место брифа несёт предвыбор компактации", () => {
  const setup = (compactPreselected?: (threadId: string) => Promise<boolean>) => {
    const { bb, harness } = createFakePluginHost({
      pluginId: "flow",
      sdk: { threads: { get: async () => ({ projectId: "proj_1", environmentId: "env_1" }) } },
    });
    registerApi(bb, createStore(bb.storage.kv), { now: () => "2026-10-05T10:00:00.000Z", ...(compactPreselected === undefined ? {} : { compactPreselected }) });
    return harness;
  };

  it("контекст в выбранной зоне — бриф открывается на «в этом треде» с компактацией", async () => {
    const harness = setup(async (threadId) => threadId === "thr_src");
    expect(await harness.callRpc("getDispatchPlace", { threadId: "thr_src" })).toEqual({ place: "here", compact: true });
  });

  it("контекст ниже зоны — компактации в ответе нет", async () => {
    const harness = setup(async () => false);
    expect(await harness.callRpc("getDispatchPlace", { threadId: "thr_src" })).toEqual({ place: "here" });
  });

  it("сбой предвыбора не ломает место брифа", async () => {
    const harness = setup(async () => {
      throw new Error("events down");
    });
    expect(await harness.callRpc("getDispatchPlace", { threadId: "thr_src" })).toEqual({ place: "here" });
  });
});
