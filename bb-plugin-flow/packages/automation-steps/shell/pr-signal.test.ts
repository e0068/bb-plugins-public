import { describe, expect, it } from "vitest";

import type { AwaitMark } from "../core/pr-await";
import type { PrSignal } from "../core/open-pr-refinement";
import type { PrPresence } from "../core/visibility";
import type { OpenPrAnswer } from "../wiring/open-pr-lookup";
import { refinePrSignal, type PrSignalPorts } from "./pr-helpers";

const T0 = 1_790_000_000_000;
const PR = { number: 41, url: "https://github.com/e0068/bb-plugins/pull/41" };
const MINUTE = 60_000;

const hostSignal = (presence: PrPresence): PrSignal => ({
  presence,
  url: presence === "absent" ? null : "https://github.com/e0068/bb-plugins/pull/1",
  number: presence === "absent" ? null : 1,
  state: presence === "open" ? "open" : presence === "settled" ? "merged" : null,
  checksState: presence === "absent" ? null : "passing",
  mergeability: presence === "absent" ? null : "mergeable",
});

/** Мир опроса: сигнал bb, отметка в конфиге ветки, ответ GitHub и счётчик вопросов к нему. */
function world(start: { presence: PrPresence; mark: AwaitMark | null; live: OpenPrAnswer }) {
  const state = { ...start, now: T0, asks: 0 };
  const ports: PrSignalPorts = {
    key: "env-1",
    host: async () => hostSignal(state.presence),
    readMark: async () => state.mark,
    writeMark: async (mark) => void (state.mark = mark),
    askLive: async () => {
      state.asks += 1;
      await Promise.resolve();
      return state.live;
    },
    now: () => state.now,
  };
  return { state, poll: () => refinePrSignal(ports) };
}

const publish = (over: Partial<AwaitMark> = {}): AwaitMark => ({ kind: "publish", since: T0, askedAt: null, found: null, ...over });

describe("refinePrSignal", () => {
  it("без отметки GitHub не спрашивается ни на одном опросе, ответ — сигнал bb", async () => {
    for (const presence of ["settled", "absent", "unknown", "open"] as const) {
      const w = world({ presence, mark: null, live: { asked: true, pr: PR } });
      for (let tick = 0; tick < 180; tick += 1) {
        w.state.now = T0 + tick * 20_000;
        expect(await w.poll()).toEqual(hostSignal(presence));
      }
      expect(w.state.asks).toBe(0);
    }
  });

  it("нажата публикация, bb PR ещё не видит → GitHub спрашивается не чаще раза в минуту", async () => {
    const w = world({ presence: "settled", mark: publish(), live: { asked: true, pr: PR } });
    for (let tick = 0; tick < 30; tick += 1) {
      w.state.now = T0 + tick * 20_000;
      expect((await w.poll()).presence).toBe("open");
    }
    expect(w.state.asks).toBe(10);
  });

  it("между вопросами найденный PR переиспользуется", async () => {
    const w = world({ presence: "settled", mark: publish(), live: { asked: true, pr: PR } });
    await w.poll();
    w.state.now = T0 + 20_000;
    expect(await w.poll()).toMatchObject({ presence: "open", number: 41, url: PR.url });
    expect(w.state.asks).toBe(1);
  });

  it("одновременные опросы из нескольких окон дают один вопрос", async () => {
    const w = world({ presence: "settled", mark: publish(), live: { asked: true, pr: PR } });
    await Promise.all(Array.from({ length: 5 }, () => w.poll()));
    expect(w.state.asks).toBe(1);
  });

  it("bb увидел PR → отметка снята, дальше ни одного вопроса", async () => {
    const w = world({ presence: "open", mark: publish({ found: PR, askedAt: T0 - MINUTE }), live: { asked: true, pr: PR } });
    expect(await w.poll()).toEqual(hostSignal("open"));
    expect(w.state.mark).toBeNull();
    w.state.presence = "settled";
    for (let tick = 1; tick < 10; tick += 1) {
      w.state.now = T0 + tick * MINUTE;
      await w.poll();
    }
    expect(w.state.asks).toBe(0);
  });

  it("попытка мёрджа, PR больше не открыт → отметка снята после одного вопроса", async () => {
    const w = world({ presence: "settled", mark: { kind: "merge", since: T0, askedAt: null, found: PR }, live: { asked: true, pr: null } });
    expect(await w.poll()).toEqual(hostSignal("settled"));
    expect(w.state.mark).toBeNull();
    for (let tick = 1; tick < 10; tick += 1) {
      w.state.now = T0 + tick * MINUTE;
      await w.poll();
    }
    expect(w.state.asks).toBe(1);
  });

  it("GitHub недоступен → сигнал bb, следующий вопрос не раньше чем через минуту", async () => {
    const w = world({ presence: "settled", mark: publish(), live: { asked: false } });
    expect(await w.poll()).toEqual(hostSignal("settled"));
    w.state.now = T0 + 20_000;
    await w.poll();
    expect(w.state.asks).toBe(1);
  });
});
