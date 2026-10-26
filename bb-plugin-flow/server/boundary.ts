// Граница этапов — точка обслуживания треда. Агент отметил этап готовым и закончил ход; Flow дожидается простоя,
// сжимает тред, ставит модель следующего этапа и сам присылает «продолжай». Оболочка: время, ожидание и отправки
// приходят аргументами, правила — что сжимать и на какую модель — решает core/context.ts.
import type { BbPluginApi } from "@get-bb/plugin-sdk";

import { providerModelsOf } from "../core/flow-agent";
import { RELAY_WAIT_MS } from "./agent-relay";

/** Провайдер, чьим тредам Flow меняет модель по этапам: у других провайдеров каталог моделей и их имена другие. */
export const MODEL_PROVIDER = "claude-code";

/** Сколько Flow ждёт простоя треда: тот же предел, что у вызова flow_stage, ждущего автоматизацию. */
export const BOUNDARY_WAIT_MS = RELAY_WAIT_MS;

/** Сколько назначенный план живёт: автоматизация, которую он ждёт, идёт недолго, а план, переживший её, обслужил бы чужую реплику. */
export const PLAN_TTL_MS = 6 * RELAY_WAIT_MS;

/** Что сделать с тредом на границе: сжать, поставить модель (`null` — не трогать) и о каком этапе напомнить агенту. */
export interface ScheduledBoundary {
  readonly compact: boolean;
  readonly model: string | null;
  /** Этап, с которого агент продолжит, — подписью для реплики. */
  readonly nextStage: string;
  /** Id этапа: реплика уходит, только пока он открыт. */
  readonly stageId: string;
  /** Этап ещё не должен быть начат (граница после «готово»); у границы перед доработкой он уже начат. */
  readonly fresh: boolean;
}

/** Где этап в прогоне: не начат, идёт или закрыт. */
export type StageState = "todo" | "started" | "closed";

export interface Boundary {
  /** Запоминает план границы треда; второй вызов заменяет первый. */
  schedule(threadId: string, plan: ScheduledBoundary): void;
  /** Назначена ли треду граница, которую ещё не обслужили и не пережили. */
  scheduled(threadId: string): boolean;
  /**
   * Обслуживает тред перед будящей репликой Flow: снимает план, ждёт простоя, сжимает, ставит модель. Закрытый или начатый
   * этап плана не обслуживается. Сбой шага — в лог, дальше идёт реплика вызывающего.
   */
  service(threadId: string): Promise<void>;
  /**
   * Для агента без автоматизации впереди: обслуживает тред и присылает «продолжай этап». Реплика уходит один раз на план и только
   * пока этап открыт. Сбой отправки уходит наружу.
   */
  continueNow(threadId: string): Promise<void>;
  /** Реплика «продолжай» об этом этапе уже ушла последней: доработка с отметкой «начат» не заводит вторую границу. */
  carriedOn(threadId: string, stageId: string): boolean;
}

type Threads = Pick<BbPluginApi["sdk"]["threads"], "wait" | "compact" | "update">;

export const createBoundary = (deps: {
  threads: Threads;
  /** Реплика Flow в тред в очередь, помеченная своей отправкой (server.ts). */
  send: (threadId: string, text: string) => Promise<void>;
  /** Где этап в прогоне; нет — этап считается открытым. */
  stageState?: (threadId: string, stageId: string) => Promise<StageState>;
  warn: (message: string) => void;
  waitMs?: number;
  now?: () => number;
}): Boundary => {
  const plans = new Map<string, { plan: ScheduledBoundary; at: number }>();
  const running = new Set<string>();
  const carried = new Map<string, string>();
  const now = deps.now ?? Date.now;

  const take = (threadId: string): ScheduledBoundary | undefined => {
    const found = plans.get(threadId);
    plans.delete(threadId);
    return found !== undefined && now() - found.at <= PLAN_TTL_MS ? found.plan : undefined;
  };

  /** Этап плана ещё ждёт агента: не закрыт и, у границы после «готово», не начат. Состояние не прочиталось — ждёт. */
  const waiting = async (threadId: string, plan: ScheduledBoundary): Promise<boolean> => {
    const state = (await deps.stageState?.(threadId, plan.stageId).catch(() => "todo" as const)) ?? "todo";
    return state === "todo" || (state === "started" && !plan.fresh);
  };

  /** Шаг обслуживания: сбой пишется в лог и реплику не держит; `true` — шаг прошёл. */
  const attempt = async (what: string, step: () => Promise<unknown>): Promise<boolean> => {
    try {
      await step();
      return true;
    } catch (error) {
      deps.warn(`stage boundary: ${what} failed (${error instanceof Error ? error.message : String(error)})`);
      return false;
    }
  };

  const serve = async (threadId: string, plan: ScheduledBoundary): Promise<void> => {
    // Сжатие и смена модели под идущим ходом агента не описаны в SDK: тред не простоял — его не трогают.
    const idle = await attempt("waiting for the thread to go idle", () => deps.threads.wait({ threadId, status: "idle", timeoutMs: deps.waitMs ?? BOUNDARY_WAIT_MS }));
    if (!idle) return;
    if (plan.compact) await attempt("compaction", () => deps.threads.compact({ threadId }));
    if (plan.model !== null) await attempt("model update", () => deps.threads.update({ threadId, model: plan.model }));
  };

  return {
    schedule: (threadId, plan) => void plans.set(threadId, { plan, at: now() }),
    scheduled: (threadId) => {
      const found = plans.get(threadId);
      if (found !== undefined && now() - found.at > PLAN_TTL_MS) plans.delete(threadId);
      return plans.has(threadId);
    },
    carriedOn: (threadId, stageId) => carried.get(threadId) === stageId,
    async service(threadId) {
      const plan = take(threadId);
      if (plan !== undefined && (await waiting(threadId, plan))) await serve(threadId, plan);
    },
    async continueNow(threadId) {
      const plan = take(threadId);
      if (plan === undefined) return;
      // Один план на тред: пока первая реплика обслуживается, повторная отметка второй не добавляет.
      if (running.has(threadId)) return;
      running.add(threadId);
      try {
        if (!(await waiting(threadId, plan))) return;
        await serve(threadId, plan);
        // Пока тред простаивал, этап могли закрыть или начать сами: реплика была бы лишней.
        if (!(await waiting(threadId, plan))) return;
        carried.set(threadId, plan.stageId);
        await deps.send(threadId, `Flow: the stage boundary is serviced — carry on with stage ${plan.nextStage}.`);
      } finally {
        running.delete(threadId);
      }
    },
  };
};

type ModelSdk = { threads: Pick<BbPluginApi["sdk"]["threads"], "get" | "defaultExecutionOptions">; providers: Pick<BbPluginApi["sdk"]["providers"], "models"> };

/**
 * Модель треда и модели его провайдера из каталога bb. Тред не Claude Code — `null`: модель ему не меняется.
 * Сбой чтения уходит наружу: вызывающий считает его «модель не трогать».
 */
export const stageModelsOf = async (sdk: ModelSdk, threadId: string): Promise<{ current: string | null; models: ReadonlyArray<{ model: string }> } | null> => {
  const { providerId } = await sdk.threads.get({ threadId });
  if (providerId !== MODEL_PROVIDER) return null;
  const [options, catalog] = await Promise.all([sdk.threads.defaultExecutionOptions({ threadId }), sdk.providers.models({ providerId })]);
  return { current: options?.model ?? null, models: providerModelsOf(catalog, providerId) };
};
