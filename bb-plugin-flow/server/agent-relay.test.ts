// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import { createAgentRelay } from "./agent-relay";

const T = "thr_1";

const relayWith = (state: { busy: boolean; alive: boolean }) => {
  const sent: string[] = [];
  const relay = createAgentRelay({ busy: () => state.busy, alive: async () => state.alive, send: async (_threadId, text) => void sent.push(text), onError: () => undefined, pollMs: 5 });
  return { relay, sent };
};

const tick = () => new Promise((resolve) => setTimeout(resolve, 10));

describe("реплика Flow ждущему вызову flow_stage", () => {
  it("реплика, пришедшая во время ожидания, достаётся вызову, а не треду", async () => {
    const { relay, sent } = relayWith({ busy: true, alive: true });
    const waited = relay.hold(T).wait({ ms: 10_000 });
    await relay.deliver(T, "carry on");
    expect(await waited).toEqual({ kind: "reply", text: "carry on" });
    expect(sent).toEqual([]);
  });

  it("реплика, пришедшая раньше ожидания, не теряется", async () => {
    const { relay, sent } = relayWith({ busy: true, alive: true });
    const hold = relay.hold(T);
    await relay.deliver(T, "carry on");
    expect(await hold.wait({ ms: 10_000 })).toEqual({ kind: "reply", text: "carry on" });
    expect(sent).toEqual([]);
  });

  it("Flow закончил работу над тредом без реплики — вызов узнаёт это, не дожидаясь срока", async () => {
    const state = { busy: true, alive: true };
    const { relay } = relayWith(state);
    const waited = relay.hold(T).wait({ ms: 10_000 });
    state.busy = false;
    expect(await waited).toEqual({ kind: "quiet" });
  });

  it("срок вышел — вызов уходит, а реплика после этого идёт в тред", async () => {
    const { relay, sent } = relayWith({ busy: true, alive: true });
    expect(await relay.hold(T).wait({ ms: 20 })).toEqual({ kind: "timeout" });
    await relay.deliver(T, "carry on");
    expect(sent).toEqual(["carry on"]);
  });

  it("ход агента уже кончился — ответ вызова никто не прочтёт, реплика идёт в тред", async () => {
    const { relay, sent } = relayWith({ busy: true, alive: false });
    void relay.hold(T).wait({ ms: 10_000 });
    await relay.deliver(T, "carry on");
    expect(sent).toEqual(["carry on"]);
  });

  it("отменённый вызов отвечает сразу, а реплика идёт в тред — и пришедшая до отмены тоже", async () => {
    const { relay, sent } = relayWith({ busy: true, alive: true });
    const abort = new AbortController();
    const hold = relay.hold(T);
    await relay.deliver(T, "before abort");
    abort.abort();
    expect(await hold.wait({ ms: 10_000, signal: abort.signal })).toEqual({ kind: "aborted" });
    await tick();
    expect(sent).toEqual(["before abort"]);
    await relay.deliver(T, "after abort");
    expect(sent).toEqual(["before abort", "after abort"]);
  });

  it("ожидание, снятое без ответа, отдаёт пришедшую реплику в тред, и только один раз", async () => {
    const { relay, sent } = relayWith({ busy: true, alive: true });
    const hold = relay.hold(T);
    await relay.deliver(T, "carry on");
    hold.release();
    hold.release();
    await tick();
    expect(sent).toEqual(["carry on"]);
  });

  it("реплика, отданная ответом, при снятии ожидания в тред не идёт", async () => {
    const { relay, sent } = relayWith({ busy: true, alive: true });
    const hold = relay.hold(T);
    await relay.deliver(T, "carry on");
    await hold.wait({ ms: 10_000 });
    hold.release();
    await tick();
    expect(sent).toEqual([]);
  });

  it("два вызова в одном треде: реплика достаётся ждущему, а снятое ожидание соседа её не теряет", async () => {
    const { relay, sent } = relayWith({ busy: true, alive: true });
    const waiting = relay.hold(T);
    const idle = relay.hold(T);
    const waited = waiting.wait({ ms: 10_000 });
    await relay.deliver(T, "carry on");
    idle.release();
    expect(await waited).toEqual({ kind: "reply", text: "carry on" });
    await tick();
    expect(sent).toEqual([]);
  });

  it("реплика снятого ожидания переходит к соседу, который ещё ждёт", async () => {
    const { relay, sent } = relayWith({ busy: true, alive: true });
    const first = relay.hold(T);
    await relay.deliver(T, "carry on");
    const second = relay.hold(T);
    const waited = second.wait({ ms: 10_000 });
    first.release();
    expect(await waited).toEqual({ kind: "reply", text: "carry on" });
    expect(sent).toEqual([]);
  });

  it("выгрузка отдаёт застрявшие реплики в тред и отпускает ждущие вызовы", async () => {
    const { relay, sent } = relayWith({ busy: true, alive: true });
    const waited = relay.hold(T).wait({ ms: 10_000 });
    const other = relay.hold("thr_2");
    await relay.deliver("thr_2", "go");
    relay.dispose();
    expect(await waited).toEqual({ kind: "aborted" });
    await tick();
    expect(sent).toEqual(["go"]);
    expect(await other.wait({ ms: 10_000 })).toEqual({ kind: "aborted" });
  });

  it("реплика чужому треду ждущий вызов не задевает", async () => {
    const { relay, sent } = relayWith({ busy: true, alive: true });
    const waited = relay.hold(T).wait({ ms: 30 });
    await relay.deliver("thr_2", "go");
    expect(sent).toEqual(["go"]);
    expect(await waited).toEqual({ kind: "timeout" });
  });
});

describe("поздняя реплика с перепроверкой", () => {
  it("ход агента идёт — реплика ждёт его конца и до этого в тред не уходит", async () => {
    const state = { busy: false, alive: true };
    const { relay, sent } = relayWith(state);
    await relay.deliver(T, "next stage", async () => true);
    await tick();
    expect(sent).toEqual([]);
    state.alive = false;
    await vi.waitFor(() => expect(sent).toEqual(["next stage"]));
  });

  it("к концу хода реплика уже не нужна — в тред не уходит никогда", async () => {
    const state = { busy: false, alive: true };
    const { relay, sent } = relayWith(state);
    const due = vi.fn(async () => false);
    await relay.deliver(T, "next stage", due);
    state.alive = false;
    await vi.waitFor(() => expect(due).toHaveBeenCalledTimes(1));
    await tick();
    await tick();
    expect(sent).toEqual([]);
    expect(due).toHaveBeenCalledTimes(1);
  });

  it("нужна к концу хода — уходит ровно один раз", async () => {
    const state = { busy: false, alive: true };
    const { relay, sent } = relayWith(state);
    await relay.deliver(T, "next stage", async () => true);
    state.alive = false;
    await vi.waitFor(() => expect(sent).toEqual(["next stage"]));
    await tick();
    await tick();
    expect(sent).toEqual(["next stage"]);
  });

  it("хода уже нет — перепроверка сразу, нужна — реплика уходит, не нужна — нет", async () => {
    const { relay, sent } = relayWith({ busy: false, alive: false });
    await relay.deliver(T, "needed", async () => true);
    await relay.deliver(T, "stale", async () => false);
    expect(sent).toEqual(["needed"]);
  });

  it("ждущий вызов flow_stage получает реплику сразу, перепроверка не нужна", async () => {
    const { relay, sent } = relayWith({ busy: true, alive: true });
    const due = vi.fn(async () => false);
    const waited = relay.hold(T).wait({ ms: 10_000 });
    await relay.deliver(T, "carry on", due);
    expect(await waited).toEqual({ kind: "reply", text: "carry on" });
    expect(due).not.toHaveBeenCalled();
    expect(sent).toEqual([]);
  });

  it("поставленное, но не ждавшее ожидание передаёт реплику дальше с перепроверкой", async () => {
    const state = { busy: false, alive: true };
    const { relay, sent } = relayWith(state);
    const due = vi.fn(async () => false);
    const hold = relay.hold(T);
    await relay.deliver(T, "next stage", due);
    hold.release();
    await tick();
    expect(sent).toEqual([]);
    state.alive = false;
    await vi.waitFor(() => expect(due).toHaveBeenCalledTimes(1));
    expect(sent).toEqual([]);
  });

  it("без перепроверки поведение прежнее — в тред сразу, даже когда ход идёт", async () => {
    const { relay, sent } = relayWith({ busy: false, alive: true });
    await relay.deliver(T, "now");
    expect(sent).toEqual(["now"]);
  });

  it("выгрузка не теряет отложенную реплику: перепроверка и отправка, если она нужна", async () => {
    const { relay, sent } = relayWith({ busy: false, alive: true });
    await relay.deliver(T, "kept", async () => true);
    await relay.deliver(T, "stale", async () => false);
    relay.dispose();
    await tick();
    expect(sent).toEqual(["kept"]);
  });

  it("после выгрузки опрос хода остановлен — реплика не уходит второй раз", async () => {
    const state = { busy: false, alive: true };
    const { relay, sent } = relayWith(state);
    await relay.deliver(T, "kept", async () => true);
    relay.dispose();
    state.alive = false;
    await tick();
    await tick();
    expect(sent).toEqual(["kept"]);
  });

  it("сбой перепроверки или отправки идёт в onError, а не наружу", async () => {
    const errors: unknown[] = [];
    const state = { alive: true };
    const relay = createAgentRelay({ busy: () => false, alive: async () => state.alive, send: async () => { throw new Error("send"); }, onError: (e) => void errors.push(e), pollMs: 5 });
    await relay.deliver(T, "a", async () => true);
    await relay.deliver(T, "b", async () => { throw new Error("due"); });
    state.alive = false;
    await vi.waitFor(() => expect(errors).toHaveLength(2));
  });
});
