import { describe, expect, it } from "vitest";
import { UNKNOWN_THREAD_LIVE_STATE, withBackgroundWork, type ThreadLiveState } from "./live-state.js";

const state = (liveStatus: ThreadLiveState["liveStatus"], archivedAt: string | null = null): ThreadLiveState => ({ liveStatus, archivedAt });

describe("тред, ждущий свою фоновую работу", () => {
  it("стоящий тред с фоновой работой читается работающим", () => {
    expect(withBackgroundWork(state("idle"), true)).toEqual(state("working"));
  });

  it("ещё не замеченный тред с фоновой работой тоже работает", () => {
    expect(withBackgroundWork(undefined, true)).toEqual({ ...UNKNOWN_THREAD_LIVE_STATE, liveStatus: "working" });
  });

  it("без фоновой работы состояние не меняется", () => {
    expect(withBackgroundWork(state("idle"), false)).toEqual(state("idle"));
    expect(withBackgroundWork(undefined, false)).toBeUndefined();
  });

  it("архивность сохраняется", () => {
    expect(withBackgroundWork(state("idle", "2026-10-12T00:00:00.000Z"), true)).toEqual(state("working", "2026-10-12T00:00:00.000Z"));
  });

  it("упавший, завершённый и уже работающий тред фоновая работа не трогает", () => {
    for (const liveStatus of ["failed", "completed", "starting", "working"] as const) {
      expect(withBackgroundWork(state(liveStatus), true)).toEqual(state(liveStatus));
    }
  });
});
