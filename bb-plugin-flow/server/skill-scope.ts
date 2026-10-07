// Настройки Claude Code в дереве треда по его flow: .claude/settings.local.json прячет навыки и агентов вне открытых
// этапов и плагины, ничего не дающие flow (решение — ../core/skill-scope.ts). Пишется только worktree треда: в общей
// копии файл задел бы соседние сессии. Открытое в треде копится в kv и только растёт — Flow ничего не прячет посреди
// идущей сессии, кроме первого раза, когда тред получает flow. Сбой глотается: ход не должен падать из-за настроек.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { PluginKvStorage } from "@get-bb/plugin-sdk";
import { z } from "zod";

import {
  agentsNamedIn,
  BUILTIN_AGENTS,
  EMPTY_SCOPE,
  hiddenOf,
  limitsOf,
  mergeLocalSettings,
  NOTHING_HIDDEN,
  openStages,
  scopeOf,
  unite,
  withoutOwnerKeys,
  type ClaudePlugin,
  type Hidden,
  type Scope,
} from "../core/skill-scope";
import type { Flow, FlowProgress, StageCatalog, WorkStage } from "../shared/contract";

const LOCAL_SETTINGS = join(".claude", "settings.local.json");
const keyOf = (threadId: string): string => `skill-scope:${threadId}`;

const names = z.array(z.string());
const scopeSchema = z.object({ skills: names, agents: names });
/** Что тред уже открыл, что нужно его flow целиком и что Flow записал в файл прошлый раз. */
const stateSchema = z.object({ opened: scopeSchema, needed: scopeSchema, written: z.object({ skills: names, agents: names, plugins: names }) });
type State = z.output<typeof stateSchema>;

const copy = ({ skills, agents }: Scope): State["opened"] => ({ skills: [...skills], agents: [...agents] });
const copyHidden = ({ skills, agents, plugins }: Hidden): State["written"] => ({ skills: [...skills], agents: [...agents], plugins: [...plugins] });
const FRESH: State = { opened: copy(EMPTY_SCOPE), needed: copy(EMPTY_SCOPE), written: copyHidden(NOTHING_HIDDEN) };

export type SkillScopeDeps = {
  kv: PluginKvStorage;
  /** Корень worktree треда; тред без своего дерева — `null`. */
  worktree: (threadId: string) => Promise<string | null>;
  flow: (threadId: string) => Flow | null;
  /** Этапы flow треда, развёрнутые: этапы «Flow» уже заменены этапами вложенного flow. */
  stages: (threadId: string) => readonly WorkStage[];
  progress: (threadId: string) => Promise<FlowProgress | null>;
  catalog: () => Promise<StageCatalog>;
  plugins: () => Promise<readonly ClaudePlugin[]>;
  /** Тексты скриптов workflow по id исполнителя — по ним видно, каких агентов workflow зовёт. */
  workflowScripts: () => Promise<ReadonlyArray<{ id: string; text: string }>>;
  warn: (message: string) => void;
};

type Read = { kind: "absent" } | { kind: "ok"; json: Record<string, unknown> } | { kind: "broken" };

const readSettings = async (path: string): Promise<Read> => {
  const text = await readFile(path, "utf8").catch(() => null);
  if (text === null) return { kind: "absent" };
  try {
    const json: unknown = JSON.parse(text);
    return typeof json === "object" && json !== null && !Array.isArray(json) ? { kind: "ok", json: json as Record<string, unknown> } : { kind: "broken" };
  } catch {
    return { kind: "broken" };
  }
};

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

export const createSkillScope = (deps: SkillScopeDeps) => {
  const state = async (threadId: string): Promise<State> => {
    const parsed = stateSchema.safeParse(await deps.kv.get(keyOf(threadId)));
    return parsed.success ? parsed.data : FRESH;
  };

  /** Что прятать сейчас и с чем тред останется; выключенные переключатели прячут ничего, но открытое помнят. */
  const decide = async (threadId: string, flow: Flow, before: State): Promise<{ hidden: Hidden; next: State }> => {
    const stages = deps.stages(threadId);
    const [progress, catalog, plugins, scripts] = await Promise.all([deps.progress(threadId), deps.catalog(), deps.plugins(), deps.workflowScripts()]);
    const agentNames = [...BUILTIN_AGENTS, ...catalog.executors.filter((executor) => executor.kind === "agent").map((executor) => executor.id.slice("agent:".length))];
    const workflowAgents = (id: string) => agentsNamedIn(scripts.find((script) => script.id === id)?.text ?? "", agentNames);
    const opened = unite(before.opened, scopeOf(openStages(stages, progress), workflowAgents));
    const needed = unite(before.needed, unite(opened, scopeOf(stages, workflowAgents)));
    const hidden = hiddenOf({ catalog, plugins, limits: limitsOf(flow), opened, needed });
    return { hidden, next: { opened: copy(opened), needed: copy(needed), written: copyHidden(hidden) } };
  };

  const sync = async (threadId: string): Promise<void> => {
    const flow = deps.flow(threadId);
    const before = await state(threadId);
    const limited = flow !== null && (flow.limitSkills === true || flow.limitAgents === true);
    // Нечего ни прятать, ни снимать — файл не трогается и не создаётся.
    if (!limited && same(before.written, NOTHING_HIDDEN)) return;
    const root = await deps.worktree(threadId);
    if (root === null) return;
    const { hidden, next } = flow === null ? { hidden: NOTHING_HIDDEN, next: { ...before, written: FRESH.written } } : await decide(threadId, flow, before);
    const path = join(root, LOCAL_SETTINGS);
    const current = await readSettings(path);
    if (current.kind === "broken") return deps.warn(`skill scope: ${path} is not a JSON object, left as is`);
    const json = current.kind === "ok" ? current.json : {};
    const ours = withoutOwnerKeys(json, before.written, hidden);
    const merged = mergeLocalSettings(json, before.written, ours);
    if (!same(merged, json)) {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
    }
    await deps.kv.set(keyOf(threadId), { ...next, written: copyHidden(ours) });
  };

  // Сверки одного треда идут по очереди: перекрывшиеся читали бы одну прошлую запись и оставляли в файле чужие строки.
  const queues = new Map<string, Promise<void>>();
  const serial = (threadId: string, work: () => Promise<void>): Promise<void> => {
    const run = (queues.get(threadId) ?? Promise.resolve()).then(work);
    // Хвост очереди глотает ошибку: её получит вызывающий из `run`, а следующая сверка треда всё равно пойдёт.
    const tail = run.catch(() => undefined).finally(() => {
      if (queues.get(threadId) === tail) queues.delete(threadId);
    });
    queues.set(threadId, tail);
    return run;
  };

  return {
    sync: (threadId: string): Promise<void> =>
      serial(threadId, () => sync(threadId)).catch((error: unknown) => deps.warn(`skill scope: thread ${threadId} not synced (${error instanceof Error ? error.message : String(error)})`)),
  };
};

export type SkillScope = ReturnType<typeof createSkillScope>;
