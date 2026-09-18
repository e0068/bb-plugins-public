// Команда для владельца — директивой, как вопрос брифом. Агент зовёт
// `share_command`, команда ложится в kv, в сообщении остаётся строка
// `::command{id="…"}`; виджет читает команду и просит выполнить её в
// терминале треда, из которого агент её отдал.
import type { BbPluginApi } from "@get-bb/plugin-sdk";

import { applyToTerminal } from "../packages/thread-terminal/index";
import { COMMAND_ID_PREFIX, commandDirectiveLine } from "../core/directive";
import { commandRecordSchema, commandsRpcContract, outcomeRpcContract, shareCommandParamsSchema, type CommandRecord, type DecisionBrief } from "../shared/contract";

export const COMMAND_TOOL_NAME = "share_command";

export const COMMAND_INSTRUCTIONS = `Hand the owner a command they should run in their terminal with the ${COMMAND_TOOL_NAME} tool, not as a bash code block in your reply: one command — one call. The owner sees a block with "Wrap lines", "Copy" and "Run in terminal" buttons. After the call, paste the directive line from the result into your reply as a standalone line, without quotes or backticks.`;

const keyOf = (id: string): string => `command:${id}`;

export const registerCommands = (bb: Pick<BbPluginApi, "agents" | "rpc" | "storage" | "sdk">, deps: { newId: () => string; now: () => string; readBrief?: (id: string) => Promise<DecisionBrief | null> }): void => {
  const kv = bb.storage.kv;
  const read = async (id: string): Promise<CommandRecord | null> => {
    const parsed = commandRecordSchema.safeParse(await kv.get(keyOf(id)));
    return parsed.success ? parsed.data : null;
  };

  bb.agents.registerTool({
    name: COMMAND_TOOL_NAME,
    description: "Hand the owner a shell command as a block in the thread with wrap, copy and run-in-terminal buttons.",
    instructions: COMMAND_INSTRUCTIONS,
    presentation: { label: { pending: "Preparing a command", completed: "Command in the thread" } },
    parameters: shareCommandParamsSchema,
    async execute(params, ctx) {
      const record: CommandRecord = { id: `${COMMAND_ID_PREFIX}${deps.newId()}`, threadId: ctx.threadId, command: params.command, createdAt: deps.now() };
      await kv.set(keyOf(record.id), record);
      return `${commandDirectiveLine(record.id)}\n\nPaste the line above into your reply as a standalone line — the owner sees the command with buttons in its place.`;
    },
  });

  bb.rpc.register(commandsRpcContract, {
    async getCommand({ id }) {
      const command = await read(id);
      return command === null ? { kind: "not_found" as const } : { kind: "found" as const, command };
    },
    async runCommand({ id }) {
      const command = await read(id);
      if (command === null) return { kind: "not_found" as const };
      const { created } = await applyToTerminal(bb.sdk, { threadId: command.threadId, command: command.command });
      return { kind: "sent" as const, created };
    },
  });

  bb.rpc.register(outcomeRpcContract, {
    async runOutcomeCommand({ briefId, index }) {
      const brief = (await deps.readBrief?.(briefId)) ?? null;
      const result = brief?.outcome?.results[index];
      if (brief === null || result === undefined || !("command" in result)) return { kind: "not_found" as const };
      const { created } = await applyToTerminal(bb.sdk, { threadId: brief.threadId, command: result.command });
      return { kind: "sent" as const, created };
    },
  });
};
