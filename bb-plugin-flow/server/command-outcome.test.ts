// @vitest-environment node
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import type { DecisionBrief } from "../shared/contract";
import { registerCommands } from "./command";

const brief: DecisionBrief = {
  id: "dec_run",
  threadId: "thr_brief",
  title: "Демонстрация",
  createdAt: "2026-09-17T10:00:00.000Z",
  kind: "brief",
  launched: true,
  questions: [],
  outcome: {
    stage: "demo",
    final: true,
    done: ["Сделано"],
    pending: [],
    results: [{ label: "страница", target: "http://localhost:5173/" }, { label: "Приложение", command: "open -a Calculator" }],
  },
};

const setup = () => {
  const { bb, harness } = createFakePluginHost({
    pluginId: "flow",
    sdk: { terminals: { list: async () => ({ sessions: [{ id: "term_live", status: "running", updatedAt: 2 }] }), create: async () => ({ id: "term_new" }), input: async () => ({}) } },
  });
  registerCommands(bb, { newId: () => "C1", now: () => "2026-09-17T10:00:00.000Z", readBrief: async (id) => (id === brief.id ? brief : null) });
  return { harness };
};

describe("запуск результата Демонстрации", () => {
  it("команда результата уходит в терминал треда брифа", async () => {
    const { harness } = setup();
    expect(await harness.callRpc("runOutcomeCommand", { briefId: brief.id, index: 1 })).toEqual({ kind: "sent", created: false });
    expect(harness.sdk.callsTo("terminals.list")[0]![0]).toEqual({ scope: { kind: "thread", threadId: "thr_brief" } });
    expect(harness.sdk.callsTo("terminals.input")[0]![0]).toEqual({ terminalId: "term_live", dataBase64: Buffer.from("open -a Calculator\r").toString("base64") });
  });

  it("результат-ссылка, чужой индекс и неизвестный бриф — not_found, в терминал ничего не уходит", async () => {
    const { harness } = setup();
    expect(await harness.callRpc("runOutcomeCommand", { briefId: brief.id, index: 0 })).toEqual({ kind: "not_found" });
    expect(await harness.callRpc("runOutcomeCommand", { briefId: brief.id, index: 5 })).toEqual({ kind: "not_found" });
    expect(await harness.callRpc("runOutcomeCommand", { briefId: "dec_nope", index: 1 })).toEqual({ kind: "not_found" });
    expect(harness.sdk.callsTo("terminals.input")).toHaveLength(0);
  });
});
