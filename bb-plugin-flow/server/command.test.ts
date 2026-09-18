// @vitest-environment node
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { COMMAND_ID_PREFIX, commandDirectiveLine } from "../core/directive";
import { shareCommandParamsSchema } from "../shared/contract";
import { COMMAND_TOOL_NAME, registerCommands } from "./command";

const textOf = (result: unknown): string =>
  typeof result === "string" ? result : ((result as { content: Array<{ text?: string }> }).content ?? []).map((p) => p.text ?? "").join("\n");

const setup = (sessions: Array<{ id: string; status: string; updatedAt: number }> = [{ id: "term_live", status: "running", updatedAt: 2 }]) => {
  const { bb, harness } = createFakePluginHost({
    pluginId: "decisions",
    sdk: {
      terminals: {
        list: async () => ({ sessions }),
        create: async () => ({ id: "term_new" }),
        input: async () => ({}),
      },
    },
  });
  let counter = 0;
  registerCommands(bb, { newId: () => `C${++counter}`, now: () => "2026-09-15T12:00:00.000Z" });
  return { harness };
};

describe("схема команды", () => {
  it("пустая и слишком длинная команда отбиваются", () => {
    expect(shareCommandParamsSchema.safeParse({ command: "ls -la" }).success).toBe(true);
    expect(shareCommandParamsSchema.safeParse({ command: "   " }).success).toBe(false);
    expect(shareCommandParamsSchema.safeParse({ command: "x".repeat(20_001) }).success).toBe(false);
  });
});

describe("инструмент share_command", () => {
  it("кладёт команду с тредом из контекста и возвращает строку директивы", async () => {
    const { harness } = setup();
    const result = await harness.callAgentTool(COMMAND_TOOL_NAME, { command: "cd a && bb plugin build", threadId: "thr_forged" }, { threadId: "thr_real" });
    const id = `${COMMAND_ID_PREFIX}C1`;
    expect(textOf(result)).toContain(commandDirectiveLine(id));
    expect(await harness.callRpc("getCommand", { id })).toEqual({
      kind: "found",
      command: { id, threadId: "thr_real", command: "cd a && bb plugin build", createdAt: "2026-09-15T12:00:00.000Z" },
    });
  });

  it("правило «команду отдавай инструментом, а не блоком кода» — в инструкциях инструмента, по-английски", () => {
    const { harness } = setup();
    const tool = harness.registrations.agentTools.find((t) => t.name === COMMAND_TOOL_NAME);
    expect(tool?.instructions).toContain(COMMAND_TOOL_NAME);
    expect(tool?.instructions).toContain("not as a bash code block");
    expect(tool?.instructions).not.toMatch(/[А-Яа-яЁё]/);
  });
});

describe("RPC команды", () => {
  it("runCommand шлёт команду с возвратом каретки в живой терминал треда из записи", async () => {
    const { harness } = setup();
    await harness.callAgentTool(COMMAND_TOOL_NAME, { command: "ls" }, { threadId: "thr_real" });
    expect(await harness.callRpc("runCommand", { id: `${COMMAND_ID_PREFIX}C1` })).toEqual({ kind: "sent", created: false });
    expect(harness.sdk.callsTo("terminals.list")[0]![0]).toEqual({ scope: { kind: "thread", threadId: "thr_real" } });
    expect(harness.sdk.callsTo("terminals.input")[0]![0]).toEqual({ terminalId: "term_live", dataBase64: Buffer.from("ls\r").toString("base64") });
  });

  it("без живого терминала создаёт новый; неизвестный id — not_found", async () => {
    const { harness } = setup([{ id: "term_dead", status: "exited", updatedAt: 1 }]);
    await harness.callAgentTool(COMMAND_TOOL_NAME, { command: "pwd" }, { threadId: "thr_real" });
    expect(await harness.callRpc("runCommand", { id: `${COMMAND_ID_PREFIX}C1` })).toEqual({ kind: "sent", created: true });
    expect(await harness.callRpc("runCommand", { id: `${COMMAND_ID_PREFIX}nope` })).toEqual({ kind: "not_found" });
    expect(await harness.callRpc("getCommand", { id: `${COMMAND_ID_PREFIX}nope` })).toEqual({ kind: "not_found" });
  });
});
