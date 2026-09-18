// Оболочка планирования: время создания треда и сессия провайдера — из SDK bb,
// строки логов сессии — из ~/.claude/projects, как их читает Token Usage.
// Любой сбой брифа не касается: планирования нет или есть только минуты.
import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";

import { planningMinutes, transcriptCost, windowCost } from "../core/planning";
import type { Planning } from "../shared/contract";

export type PlanningSource = { threads: Pick<BbPluginApi["sdk"]["threads"], "get"> & { events: Pick<BbPluginApi["sdk"]["threads"]["events"], "list"> } };

/** Строки логов сессии провайдера — основной и субагентов; `undefined`, если лога нет. */
export type TranscriptReader = (sessionId: string) => Promise<readonly string[] | undefined>;

const threadRow = z.union([z.object({ createdAt: z.number() }), z.object({ thread: z.object({ createdAt: z.number() }) })]);
const identityRow = z.object({ data: z.object({ providerThreadId: z.string().min(1) }) });

/** Все разные сессии провайдера треда: провайдер мог начать новую сессию посреди треда. */
const sessionsOf = (rows: readonly unknown[]): string[] => [
  ...new Set(rows.flatMap((row) => {
    const parsed = identityRow.safeParse(row);
    return parsed.success ? [parsed.data.data.providerThreadId] : [];
  })),
];

export const readPlanning = async (source: PlanningSource, threadId: string, now: number, readTranscript: TranscriptReader): Promise<Planning | undefined> => {
  try {
    const thread = threadRow.parse(await source.threads.get({ threadId }));
    const minutes = planningMinutes("thread" in thread ? thread.thread.createdAt : thread.createdAt, now);
    const sessions = sessionsOf(await source.threads.events.list({ threadId, types: ["thread/identity"] }));
    const logs = await Promise.all(sessions.map((id) => readTranscript(id).catch(() => undefined)));
    const lines = logs.flatMap((l) => l ?? []);
    const cost = lines.length === 0 ? undefined : transcriptCost(lines);
    return { minutes, ...(cost === undefined ? {} : { cost }) };
  } catch {
    return undefined;
  }
};

/** Доллары логов всех сессий треда в окне времени; сбой или нет лога — `undefined`. */
export const readWindowCost = async (source: PlanningSource, threadId: string, from: number, to: number, readTranscript: TranscriptReader): Promise<number | undefined> => {
  try {
    const sessions = sessionsOf(await source.threads.events.list({ threadId, types: ["thread/identity"] }));
    const logs = await Promise.all(sessions.map((id) => readTranscript(id).catch(() => undefined)));
    return windowCost(logs.flatMap((l) => l ?? []), from, to);
  } catch {
    return undefined;
  }
};

const jsonlUnder = async (dir: string): Promise<string[]> => {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true }).catch(() => []);
  return entries.filter((e) => e.isFile() && e.name.endsWith(".jsonl")).map((e) => join(e.parentPath, e.name));
};

/** Лог Claude Code: `<проект>/<сессия>.jsonl` и `<проект>/<сессия>/subagents/**.jsonl`. */
export const readClaudeTranscript =
  (root: string = join(homedir(), ".claude", "projects")): TranscriptReader =>
  async (sessionId) => {
    const projects = await readdir(root, { withFileTypes: true }).catch(() => []);
    for (const project of projects.filter((p) => p.isDirectory())) {
      const main = join(root, project.name, `${sessionId}.jsonl`);
      const text = await readFile(main, "utf8").catch(() => undefined);
      if (text === undefined) continue;
      const agents = await jsonlUnder(join(root, project.name, sessionId, "subagents"));
      const rest = await Promise.all(agents.sort().map((f) => readFile(f, "utf8").catch(() => "")));
      return [text, ...rest].flatMap((t) => t.split("\n"));
    }
    return undefined;
  };
