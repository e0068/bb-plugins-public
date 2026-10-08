// @vitest-environment node
// Новая сессия после выбора flow: тред, который сам выбрал flow с ограничением навыков, на конце первого хода
// получает сверку настроек, чистый контекст и своё первое сообщение заново — с пометкой, видной только агенту.
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { createFreshSession, type MessageBlocks } from "./fresh-session";

const FIRST = [{ type: "text", text: "Сделай плагин", mentions: [] }, { type: "image", url: "https://x/y.png" }];

const setup = (options: { chooses?: boolean; needed?: boolean; clearFails?: boolean } = {}) => {
  const { bb } = createFakePluginHost({ pluginId: "flow" });
  const calls: string[] = [];
  const sent: MessageBlocks[] = [];
  const fresh = createFreshSession({
    kv: bb.storage.kv,
    agentChooses: () => options.chooses ?? true,
    needed: async () => options.needed ?? true,
    sync: async () => void calls.push("sync"),
    clear: async () => {
      calls.push("clear");
      if (options.clearFails) throw new Error("busy");
    },
    send: async (_threadId, blocks) => {
      calls.push("send");
      sent.push(blocks);
    },
    note: () => "flow chosen",
    warn: () => undefined,
  });
  return { fresh, calls, sent };
};

describe("новая сессия после выбора flow", () => {
  it("выбор в первом ходе: на конце хода сверка, очистка и первое сообщение заново за пометкой агенту", async () => {
    const { fresh, calls, sent } = setup();
    await fresh.remember("thr", FIRST);
    expect(await fresh.request("thr")).toBe(true);
    await fresh.idle("thr");
    expect(calls).toEqual(["sync", "clear", "send"]);
    expect(sent).toEqual([[{ type: "text", text: "flow chosen", mentions: [], visibility: "agent-only" }, ...FIRST]]);
  });

  it("перезапуск один: следующий конец хода ничего не повторяет", async () => {
    const { fresh, calls } = setup();
    await fresh.remember("thr", FIRST);
    await fresh.request("thr");
    await fresh.idle("thr");
    await fresh.idle("thr");
    expect(calls.filter((call) => call === "send")).toHaveLength(1);
  });

  it("первый ход без выбора flow забывает сообщение: поздний выбор не повторяет давнюю задачу", async () => {
    const { fresh, calls } = setup();
    await fresh.remember("thr", FIRST);
    await fresh.idle("thr");
    expect(await fresh.request("thr")).toBe(false);
    expect(calls).toEqual([]);
  });

  it("flow без ограничения навыков или тред не в Claude Code — работа идёт в той же сессии", async () => {
    const { fresh, calls } = setup({ needed: false });
    await fresh.remember("thr", FIRST);
    expect(await fresh.request("thr")).toBe(false);
    await fresh.idle("thr");
    expect(calls).toEqual([]);
  });

  it("тред, которому flow выбрал владелец, не помнит первого сообщения", async () => {
    const { fresh } = setup({ chooses: false });
    await fresh.remember("thr", FIRST);
    expect(await fresh.request("thr")).toBe(false);
  });

  it("очистка не вышла — сообщение всё равно уходит, тред не стоит", async () => {
    const { fresh, calls } = setup({ clearFails: true });
    await fresh.remember("thr", FIRST);
    await fresh.request("thr");
    await fresh.idle("thr");
    expect(calls).toEqual(["sync", "clear", "send"]);
  });
});
