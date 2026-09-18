// @vitest-environment node
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { readClaudeTranscript, readPlanning, type PlanningSource } from "./planning";

const layout = async () => {
  const root = await mkdtemp(join(tmpdir(), "decisions-transcripts-"));
  await mkdir(join(root, "proj-a"), { recursive: true });
  await mkdir(join(root, "proj-b", "sess", "subagents", "wf"), { recursive: true });
  await writeFile(join(root, "proj-a", "other.jsonl"), "other-main\n");
  await writeFile(join(root, "proj-b", "sess.jsonl"), "main-1\nmain-2\n");
  await writeFile(join(root, "proj-b", "sess", "subagents", "wf", "agent-a.jsonl"), "agent-1\n");
  await writeFile(join(root, "proj-b", "sess", "subagents", "wf", "notes.txt"), "not-a-log\n");
  return root;
};

describe("лог сессии Claude Code на диске", () => {
  it("основной лог и логи субагентов сессии, без чужих сессий и не-jsonl файлов", async () => {
    const lines = await readClaudeTranscript(await layout())("sess");
    expect(lines?.filter((l) => l !== "")).toEqual(["main-1", "main-2", "agent-1"]);
  });

  it("неизвестная сессия и отсутствующий корень — лога нет", async () => {
    expect(await readClaudeTranscript(await layout())("nope")).toBeUndefined();
    expect(await readClaudeTranscript(join(tmpdir(), "decisions-no-such-root"))("sess")).toBeUndefined();
  });
});

describe("все сессии провайдера в треде", () => {
  it("расход складывается по каждой разной сессии из событий thread/identity", async () => {
    const usage = (id: string) => JSON.stringify({ type: "assistant", requestId: id, message: { id, model: "claude-opus-5", usage: { input_tokens: 1_000_000, output_tokens: 0 } } });
    const source: PlanningSource = {
      threads: {
        get: async () => ({ createdAt: 0 }) as never,
        events: { list: async () => [{ type: "thread/identity", data: { providerThreadId: "s1" } }, { type: "thread/identity", data: { providerThreadId: "s2" } }, { type: "thread/identity", data: { providerThreadId: "s1" } }] as never },
      },
    };
    const read = async (sessionId: string) => [usage(`m-${sessionId}`)];
    expect(await readPlanning(source, "thr_1", 60_000, read)).toEqual({ minutes: 1, cost: 10 });
  });
});
