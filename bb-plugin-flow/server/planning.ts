// Оболочка планирования: время создания треда и сессия провайдера — из SDK bb,
// строки логов сессии — из ~/.claude/projects, как их читает Token Usage.
// Любой сбой брифа не касается: планирования нет или есть только минуты.
import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";

import { activeMinutes, planningMinutes, transcriptCost, windowCost } from "../core/planning";
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

/**
 * Активные минуты каждого окна: логи всех сессий треда читаются один раз на
 * вызов, поэтому добор сразу по нескольким этапам не перечитывает лог на этап.
 * Сессия без лога даёт ноль; сбой чтения событий треда уходит наружу — «лога
 * нет» и «прочитать не удалось» для вызывающего разные вещи.
 */
export const readWindowMinutes = async (
  source: PlanningSource,
  threadId: string,
  windows: ReadonlyArray<{ from: number; to: number }>,
  readTranscript: TranscriptReader,
): Promise<readonly number[]> => {
  const sessions = sessionsOf(await source.threads.events.list({ threadId, types: ["thread/identity"] }));
  const logs = await Promise.all(sessions.map((id) => readTranscript(id).catch(() => undefined)));
  const lines = logs.flatMap((l) => l ?? []);
  return windows.map((window) => activeMinutes(lines, window.from, window.to));
};

/** Дочерние треды по родителю и боковые чаты — форки — по исходному треду, в архиве и нет. */
export type ThreadTree = {
  threads: { list: (args: { parentThreadId?: string; sourceThreadId?: string; includeHidden: true; archived?: boolean }) => Promise<ReadonlyArray<{ id: string }>> };
};

/**
 * Треды вместе со всеми потомками, каждый по разу. Работу прогона ведут и дочерние
 * треды — прогоны DEV2, разведка, — и боковые чаты: скрытый форк треда, где тоже
 * запускают прогоны, а их логи прогоном не отмечены. Архивированный потомок в счёте:
 * архив не отменяет потраченного.
 */
export const withDescendants = async (source: ThreadTree, roots: readonly string[]): Promise<string[]> => {
  const walk = async (seen: readonly string[], frontier: readonly string[]): Promise<string[]> => {
    if (frontier.length === 0) return [...seen];
    const children = await Promise.all(
      frontier.flatMap((id) =>
        [false, true].flatMap((archived) => [
          source.threads.list({ parentThreadId: id, includeHidden: true, archived }),
          source.threads.list({ sourceThreadId: id, includeHidden: true, archived }),
        ]),
      ),
    );
    const fresh = [...new Set(children.flat().map((child) => child.id))].filter((id) => !seen.includes(id));
    return walk([...seen, ...fresh], fresh);
  };
  const unique = [...new Set(roots)];
  return walk(unique, unique);
};

/**
 * Источник, у которого события треда — события всех связанных с ним тредов: окно
 * этапа читает сессии всего прогона, а не одного треда, который закрыл этап.
 */
export const acrossThreads = (source: PlanningSource, related: (threadId: string) => Promise<readonly string[]>): PlanningSource => ({
  threads: {
    get: source.threads.get,
    events: {
      list: (async (args: Parameters<PlanningSource["threads"]["events"]["list"]>[0]) => {
        const lists = await Promise.all((await related(args.threadId)).map((threadId) => source.threads.events.list({ ...args, threadId })));
        return lists.flat();
      }) as PlanningSource["threads"]["events"]["list"],
    },
  },
});

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
