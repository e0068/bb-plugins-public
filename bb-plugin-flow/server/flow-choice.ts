// Flow треда в контейнере состояния Flow над его композером. У треда без прогона
// и после завершённого — строка выбора: выбор запоминается и ждёт сообщения
// владельца, которое начнёт ход, — тогда flow достаётся треду, и для настоящего
// flow заводится пустой прогон, чтобы строку сразу сменил бар. Завершённый
// прогон без выбора уступает «Автоматически». У идущего прогона — «Отменить
// flow»: тред идёт без flow, а прогон, отложенные шаги автоматизаций и ожидание
// владельца снимаются.
import type { BbPluginApi } from "@get-bb/plugin-sdk";

import { AGENT_NO_FLOW, AUTO_FLOW, NO_FLOW, flowById, flowOrNone, withExpandedStages } from "../core/flows";
import { flowChoiceRpcContract } from "../shared/contract";
import type { FlowSettingsStore } from "./flow-settings";
import type { ProgressStore } from "./progress";
import type { DecisionStore } from "./store";
import type { ThreadFlows } from "./thread-flows";

export type FlowChoice = {
  /** Владелец начал ход своим сообщением: выбор, сделанный над композером, достаётся треду. */
  ownerTurn(threadId: string): Promise<void>;
  /** Демонстрация увела работу треда в другой flow: прогон и прежняя работа снимаются, заводится пустой прогон выбранного. */
  switchTo(threadId: string, flowId: string): Promise<void>;
  /** Работу треда увели в новый тред: его прогон, шаги автоматизаций и ожидание снимаются, flow остаётся. */
  release(threadId: string): Promise<void>;
};

export const registerFlowChoice = (
  bb: Pick<BbPluginApi, "rpc">,
  deps: {
    flows: FlowSettingsStore;
    threads: ThreadFlows;
    progress: Pick<ProgressStore, "annotate" | "remove" | "run">;
    store: Pick<DecisionStore, "dropAwaiting" | "resetThreadWork">;
    /** Гасит отложенные автоповторы треда и останавливает его идущие шаги (./automation-runner.ts). */
    cancelRun: (threadId: string) => void;
    /** Прогон треда завершён: flow у треда больше нет, и следующий выбирается заново. Нет — прогон не завершается никогда. */
    finished?: (threadId: string) => Promise<boolean>;
  },
): FlowChoice => {
  /** Flow треда так, как его видит строка выбора: отказ агента — ещё «Автоматически», flow выберет агент; тред без привязки — flow по умолчанию. */
  const current = (threadId: string): string => {
    const flowId = deps.threads.flowOf(threadId);
    if (flowId === NO_FLOW) return NO_FLOW;
    return flowId === AUTO_FLOW || flowId === AGENT_NO_FLOW ? AUTO_FLOW : flowById(deps.flows.current(), flowId).id;
  };
  const finished = async (threadId: string) => (await deps.finished?.(threadId).catch(() => false)) ?? false;
  /** Что строка показывает выбранным без выбора владельца: после завершённого прогона — «Автоматически», с ним начнётся следующий. */
  const shown = async (threadId: string) => ((await finished(threadId)) ? AUTO_FLOW : current(threadId));
  const known = (flowId: string) => flowId === NO_FLOW || flowId === AUTO_FLOW || deps.flows.current().flows.some((flow) => flow.id === flowId);
  /** Снять прогон треда: выбор над композером, отложенные шаги автоматизаций, ожидание владельца и сам прогон. */
  const dropRun = async (threadId: string) => {
    await deps.threads.pick(threadId, null);
    deps.cancelRun(threadId);
    await deps.store.dropAwaiting(threadId);
    await deps.progress.remove(threadId);
  };

  bb.rpc.register(flowChoiceRpcContract, {
    threadFlowChoice: async ({ threadId }) => ({
      flows: withExpandedStages(deps.flows.current().flows).map(({ id, name, stages, icon }) => ({ id, name, stages: stages.length, ...(icon === undefined ? {} : { icon }) })),
      selected: deps.threads.pickedOf(threadId) ?? (await shown(threadId)),
    }),

    async pickThreadFlow({ threadId, flowId }) {
      if (!known(flowId)) return { kind: "failed" as const, reason: "unknown-flow" as const };
      // Выбор того, что у треда уже стоит, — отказ от прежнего выбора, а не новый.
      await deps.threads.pick(threadId, flowId === (await shown(threadId)) ? null : flowId);
      return { kind: "picked" as const, selected: flowId };
    },

    async cancelFlow({ threadId }) {
      // Прогон, который ведёт другой тред, отменяет он: отсюда тред его только видит.
      const found = await deps.progress.run(threadId);
      if (found !== null && found.carrier !== threadId) return { kind: "failed" as const, reason: "carried" as const };
      // Сперва flow: с этой минуты новый ход треда не получает этапов, а исполнитель автоматизаций не находит, что продолжать.
      await deps.threads.assign(threadId, NO_FLOW);
      await dropRun(threadId);
      return { kind: "cancelled" as const };
    },
  });

  return {
    async switchTo(threadId, flowId) {
      if (flowOrNone(deps.flows.current(), flowId) === null) throw new Error(`unknown flow "${flowId}"`);
      // Сперва flow, как у «Отменить flow»: исполнитель автоматизаций уже не находит, что продолжать в прежнем.
      await deps.threads.assign(threadId, flowId);
      await dropRun(threadId);
      await deps.store.resetThreadWork(threadId);
      await deps.progress.annotate(threadId, (progress) => progress);
    },
    release: dropRun,
    async ownerTurn(threadId) {
      // Выбор снимается в любом случае: прогон, начатый агентом после выбора, он не перебивает — строки выбора над баром уже нет.
      const taken = await deps.threads.takePicked(threadId);
      const running = (await deps.progress.run(threadId)) !== null;
      const done = running && (await finished(threadId));
      // Завершённый прогон без выбора уступает «Автоматически» — тому, что строка и показывала выбранным.
      const picked = taken ?? (done ? AUTO_FLOW : undefined);
      if (picked === undefined || (running && !done)) return;
      // Завершённый прогон уступает следующему: его итог уже заморожен под своим брифом.
      if (done) await deps.progress.remove(threadId);
      await deps.threads.assign(threadId, picked);
      // Пустой прогон — бар 0/N сразу после отправки; правка без продвижения: этапы ещё не начаты, и автоматизациям нечего делать.
      if (flowOrNone(deps.flows.current(), picked) !== null) await deps.progress.annotate(threadId, (progress) => progress);
    },
  };
};
