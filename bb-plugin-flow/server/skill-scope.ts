// Настройки Claude Code в дереве треда по его flow: .claude/settings.local.json прячет навыки и агентов вне открытых
// этапов и плагины, ничего не дающие flow (решение — ../core/skill-scope.ts). Пишется только worktree треда: в общей
// копии файл задел бы соседние сессии. Открытое в треде копится в kv и только растёт — Flow ничего не прячет посреди
// идущей сессии. Первая сессия треда стартует уже с ограничением: сверка в хуке первого сообщения идёт, пока дерева
// ещё нет, и откладывает решение, а `prestart` кладёт его синхронно перед стартом сессии (./session-config.ts).
// Тред с «Автоматически» до выбора flow прячет то, что прячет хоть один flow. Сбой глотается: ход не должен падать из-за настроек.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
  type Limits,
  type Scope,
} from "../core/skill-scope";
import type { Flow, FlowProgress, StageCatalog, WorkStage } from "../shared/contract";

const LOCAL_SETTINGS = join(".claude", "settings.local.json");
const keyOf = (threadId: string): string => `skill-scope:${threadId}`;

const names = z.array(z.string());
// workflows и bundled появились позже: запись тредов, сделанная до них, читается без них.
const scopeSchema = z.object({ skills: names, agents: names, workflows: names.default([]) });
/**
 * Что тред уже открыл, что нужно его flow целиком, что Flow записал в файл прошлый раз и ограничивал ли тред до выбора
 * flow агентом — тогда выбор меняет навыки сессии, и тред начинает работу заново (./fresh-session.ts).
 */
const stateSchema = z.object({
  opened: scopeSchema,
  needed: scopeSchema,
  written: z.object({ skills: names, agents: names, plugins: names, bundled: z.boolean().default(false) }),
  limitedBeforeChoice: z.boolean().default(false),
});
type State = z.output<typeof stateSchema>;

const copy = ({ skills, agents, workflows = [] }: Scope): State["opened"] => ({ skills: [...skills], agents: [...agents], workflows: [...workflows] });
const copyHidden = ({ skills, agents, plugins, bundled = false }: Hidden): State["written"] => ({ skills: [...skills], agents: [...agents], plugins: [...plugins], bundled });
const FRESH: State = { opened: copy(EMPTY_SCOPE), needed: copy(EMPTY_SCOPE), written: copyHidden(NOTHING_HIDDEN), limitedBeforeChoice: false };

export type SkillScopeDeps = {
  kv: PluginKvStorage;
  /** Корень worktree треда; тред без своего дерева — `null`. */
  worktree: (threadId: string) => Promise<string | null>;
  /** Дерева у треда ещё нет, но будет: окружение не создано. Решение тогда откладывается до старта сессии. Не задано — нет. */
  pending?: (threadId: string) => Promise<boolean>;
  flow: (threadId: string) => Flow | null;
  /** Тред, которому flow ещё выберет агент, — что прятать до выбора; остальные треды — `null`. Не задано — таких нет. */
  choosing?: (threadId: string) => Limits | null;
  /** Этапы flow треда, развёрнутые: этапы «Flow» уже заменены этапами вложенного flow. */
  stages: (threadId: string) => readonly WorkStage[];
  progress: (threadId: string) => Promise<FlowProgress | null>;
  catalog: () => Promise<StageCatalog>;
  plugins: () => Promise<readonly ClaudePlugin[]>;
  /** Навыки аккаунта claude.ai — `anthropic-skills:<имя>`; в каталоге bb их нет. Не задано — их нет. */
  accountSkills?: () => Promise<readonly string[]>;
  /** Тексты скриптов workflow по id исполнителя — по ним видно, каких агентов workflow зовёт. */
  workflowScripts: () => Promise<ReadonlyArray<{ id: string; text: string }>>;
  warn: (message: string) => void;
};

type Read = { kind: "absent" } | { kind: "ok"; json: Record<string, unknown> } | { kind: "broken" };

const parseSettings = (text: string | null): Read => {
  if (text === null) return { kind: "absent" };
  try {
    const json: unknown = JSON.parse(text);
    return typeof json === "object" && json !== null && !Array.isArray(json) ? { kind: "ok", json: json as Record<string, unknown> } : { kind: "broken" };
  } catch {
    return { kind: "broken" };
  }
};

const readSettings = async (path: string): Promise<Read> => parseSettings(await readFile(path, "utf8").catch(() => null));

const readSettingsNow = (path: string): Read => {
  try {
    return parseSettings(readFileSync(path, "utf8"));
  } catch {
    return parseSettings(null);
  }
};

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** Что Flow записал бы в файл: `merged` — новый JSON или `null`, если файл и так такой; `ours` — записанное Flow. */
type Planned = { kind: "broken" } | { kind: "ok"; merged: Record<string, unknown> | null; ours: Hidden };

const planWrite = (current: Read, written: Hidden, hidden: Hidden): Planned => {
  if (current.kind === "broken") return { kind: "broken" };
  const json = current.kind === "ok" ? current.json : {};
  const ours = withoutOwnerKeys(json, written, hidden);
  const merged = mergeLocalSettings(json, written, ours);
  return { kind: "ok", merged: same(merged, json) ? null : merged, ours };
};

const settingsText = (json: Record<string, unknown>): string => `${JSON.stringify(json, null, 2)}\n`;

/** Чем тред ограничен сейчас: этапами своего flow или выбором, который агент ещё сделает (`choosing`). */
type Target = { limits: Limits; stages: readonly WorkStage[]; choosing: boolean };
/** Решение сверки, которой некуда было писать: дерева треда ещё нет. */
type Deferred = { before: State; hidden: Hidden; next: State };

export const createSkillScope = (deps: SkillScopeDeps) => {
  const state = async (threadId: string): Promise<State> => {
    const parsed = stateSchema.safeParse(await deps.kv.get(keyOf(threadId)));
    return parsed.success ? parsed.data : FRESH;
  };

  /** Что прятать сейчас и с чем тред останется; выключенные переключатели прячут ничего, но открытое помнят. */
  const targetOf = (threadId: string): Target | null => {
    const flow = deps.flow(threadId);
    if (flow !== null) return { limits: limitsOf(flow), stages: deps.stages(threadId), choosing: false };
    const choosing = deps.choosing?.(threadId) ?? null;
    return choosing === null ? null : { limits: choosing, stages: [], choosing: true };
  };

  const decide = async (threadId: string, { limits, stages, choosing }: Target, before: State): Promise<{ hidden: Hidden; next: State }> => {
    const [progress, catalog, plugins, scripts, accountSkills] = await Promise.all([
      deps.progress(threadId),
      deps.catalog(),
      deps.plugins(),
      deps.workflowScripts(),
      deps.accountSkills?.() ?? [],
    ]);
    const agentNames = [...BUILTIN_AGENTS, ...catalog.executors.filter((executor) => executor.kind === "agent").map((executor) => executor.id.slice("agent:".length))];
    const workflowAgents = (id: string) => agentsNamedIn(scripts.find((script) => script.id === id)?.text ?? "", agentNames);
    const opened = unite(before.opened, scopeOf(openStages(stages, progress), workflowAgents));
    const needed = unite(before.needed, unite(opened, scopeOf(stages, workflowAgents)));
    const hidden = hiddenOf({ catalog, plugins, limits, opened, needed, accountSkills });
    const limitedBeforeChoice = before.limitedBeforeChoice || (choosing && !same(copyHidden(hidden), copyHidden(NOTHING_HIDDEN)));
    return { hidden, next: { opened: copy(opened), needed: copy(needed), written: copyHidden(hidden), limitedBeforeChoice } };
  };

  const deferred = new Map<string, Deferred>();

  const sync = async (threadId: string): Promise<void> => {
    const target = targetOf(threadId);
    const before = await state(threadId);
    const limited = target !== null && (target.limits.skills || target.limits.agents);
    // Нечего ни прятать, ни снимать — файл не трогается и не создаётся.
    if (!limited && same(before.written, NOTHING_HIDDEN)) return void deferred.delete(threadId);
    const root = await deps.worktree(threadId);
    // Тред, которому дерево не светит, — личная копия, — решения не считает: писать его некуда.
    const waiting = root === null && ((await deps.pending?.(threadId)) ?? false);
    if (root === null && !waiting) return void deferred.delete(threadId);
    const decided = target === null ? { hidden: NOTHING_HIDDEN, next: { ...before, written: FRESH.written } } : await decide(threadId, target, before);
    if (root === null) return void deferred.set(threadId, { before, ...decided });
    deferred.delete(threadId);
    const path = join(root, LOCAL_SETTINGS);
    const planned = planWrite(await readSettings(path), before.written, decided.hidden);
    if (planned.kind === "broken") return deps.warn(`skill scope: ${path} is not a JSON object, left as is`);
    if (planned.merged !== null) {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, settingsText(planned.merged), "utf8");
    }
    await deps.kv.set(keyOf(threadId), { ...decided.next, written: copyHidden(planned.ours) });
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

  /** Кончаются сверки треда, уже стоящие в очереди. */
  const settled = (threadId: string): Promise<void> => queues.get(threadId) ?? Promise.resolve();

  const failed = (threadId: string) => (error: unknown) => deps.warn(`skill scope: thread ${threadId} not synced (${error instanceof Error ? error.message : String(error)})`);

  /**
   * Перед стартом сессии: отложенное решение треда ложится в файл синхронно — Claude Code читает его на старте.
   * Решение пишется один раз; дерева нет (`root` — `null`) — забывается. Возвращает, ограничила ли запись сессию.
   */
  const prestart = (threadId: string, root: string | null): boolean => {
    const decided = deferred.get(threadId);
    deferred.delete(threadId);
    if (decided === undefined || root === null) return false;
    const path = join(root, LOCAL_SETTINGS);
    const planned = planWrite(readSettingsNow(path), decided.before.written, decided.hidden);
    if (planned.kind === "broken") {
      deps.warn(`skill scope: ${path} is not a JSON object, left as is`);
      return false;
    }
    if (planned.merged !== null) {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, settingsText(planned.merged), "utf8");
    }
    const written = copyHidden(planned.ours);
    // Файл пишется сразу, мимо очереди: Claude Code читает его на старте, а очередь может ждать идущую сверку. Запись в kv
    // встаёт в очередь, и следующая сверка прочтёт уже её. Сверка, шедшая в эту минуту, прочла прежнее состояние и может
    // записать в kv открытое без этой записи — следующая сверка его досчитает: открытое только растёт.
    void serial(threadId, () => deps.kv.set(keyOf(threadId), { ...decided.next, written })).catch(failed(threadId));
    return !same(written, copyHidden(NOTHING_HIDDEN));
  };

  return {
    sync: (threadId: string): Promise<void> => serial(threadId, () => sync(threadId)).catch(failed(threadId)),
    prestart,
    settled,
    /** Flow ограничивал тред до выбора flow агентом: выбор меняет навыки сессии. Читается после стоящих сверок. */
    limitedBeforeChoice: async (threadId: string): Promise<boolean> => {
      await settled(threadId);
      return (await state(threadId)).limitedBeforeChoice;
    },
  };
};

export type SkillScope = ReturnType<typeof createSkillScope>;
