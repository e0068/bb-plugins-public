// Перенос треда из чекаута проекта в новое дерево от origin/main — оболочка эффектов (решения — ../core/relocation.ts).
// Хук `message.dispatch` первого сообщения держит его в очереди, пока в фоне заводится тред в worktree с тем же
// сообщением и моделью; исходный тред после этого архивируется. Ждать создания внутри хука нельзя: bb проводит хуки по
// одному, и первое сообщение нового треда встало бы за этим же хуком. Перенос не вышел — сообщение уходит в чекаут как
// было: работа не теряется, а коммит в main не даёт страховка шагов (branchOff в automation-steps).
import type { BbPluginApi } from "@get-bb/plugin-sdk";

import { checkoutIntentOf, movesOutOfCheckout, originBase, relocatedInput } from "../core/relocation";
import type { WorkStage } from "../shared/contract";

/** Подпись сообщения в очереди треда, пока идёт перенос. */
export const RELOCATING_REASON = "Переношу тред в новое дерево от origin/main";

const introOf = (token: string) =>
  `Тред перенесён из чекаута проекта ${token} в своё дерево на ветке от origin/main — сообщение владельца ниже. Веди работу здесь.\n\n`;

type Sdk = Pick<BbPluginApi["sdk"], "threads" | "environments">;
type DispatchContext = Parameters<Parameters<BbPluginApi["experimental_hooks"]["on"]>[1]>[0];

/** Что хук знает о первом сообщении: тред, машина, сообщение, модель и сырое намерение окружения. */
export type FirstDispatch = {
  thread: { id: string; projectId: string; title: string | null };
  hostId: string | null;
  environmentIntent: unknown;
  blocks: DispatchContext["input"]["blocks"];
  execution: Pick<DispatchContext["requestedExecution"], "providerId" | "model" | "reasoningLevel" | "serviceTier">;
};

type Place = { hostId: string; defaultBranch: string | null };

/** `moving` — тред заводится, `moved` — заведён (его id), `stayed` — перенос не вышел, сообщение уходит как было. */
type State = { kind: "moving" } | { kind: "moved"; threadId: string } | { kind: "stayed" };

/** Решение хука о сообщении исходного треда; `null` — сообщение уходит как было. */
export type RelocationDecision = { action: "wait"; reason: string } | { action: "reject"; message: string } | null;

/**
 * Пока идёт перенос, сообщение ждёт. После переноса оно снимается отказом со ссылкой на новый тред: ждущее сообщение
 * архивного треда bb со временем помечает упавшим, а отказ убирает его и показывает текст владельцу.
 */
const decisionOf = (state: State): RelocationDecision => {
  switch (state.kind) {
    case "moving":
      return { action: "wait", reason: RELOCATING_REASON };
    case "moved":
      return { action: "reject", message: `Тред перенесён в @thread:${state.threadId}` };
    case "stayed":
      return null;
  }
};

export type Relocation = {
  /** Решение хука о первом сообщении: ждать переноса, снять после него или пропустить (`null`). */
  hold(dispatch: FirstDispatch): Promise<RelocationDecision>;
  /** Тред, заведённый переносом: он уже в своём дереве. */
  isRelocated(threadId: string): boolean;
};

export const createRelocation = (deps: {
  sdk: Sdk;
  stagesOf: (threadId: string) => readonly WorkStage[];
  /** Сообщение, ждущее переноса, спрашивает хук заново — после неудачи оно уходит в чекаут. */
  recheck: () => Promise<void>;
  /** Новому треду — пустой прогон его flow: полоска этапов с первой минуты, и шаг дерева проходит на старте. */
  started: (threadId: string) => Promise<void>;
  warn: (message: string) => void;
}): Relocation => {
  const states = new Map<string, State>();
  const relocated = new Set<string>();

  /** Чекаут проекта, в котором bb поднимет тред, — машина и ветка по умолчанию; иначе `null`. */
  const checkoutOf = async (dispatch: FirstDispatch): Promise<Place | null> => {
    const intent = checkoutIntentOf(dispatch.environmentIntent);
    if (intent.kind === "other") return null;
    if (intent.kind === "checkout") return dispatch.hostId === null ? null : { hostId: dispatch.hostId, defaultBranch: null };
    const env = await deps.sdk.environments.get({ environmentId: intent.environmentId });
    return env.isGitRepo && !env.isWorktree && !env.managed ? { hostId: env.hostId, defaultBranch: env.defaultBranch } : null;
  };

  const move = async (dispatch: FirstDispatch, place: Place): Promise<void> => {
    const { thread, execution } = dispatch;
    const created = await deps.sdk.threads.spawn({
      projectId: thread.projectId,
      ...(thread.title === null ? {} : { title: thread.title }),
      environment: { type: "host", hostId: place.hostId, workspace: { type: "managed-worktree", baseBranch: { kind: "named", name: originBase(place.defaultBranch) } } },
      providerId: execution.providerId,
      ...(execution.model === null ? {} : { model: execution.model }),
      ...(execution.reasoningLevel === null ? {} : { reasoningLevel: execution.reasoningLevel }),
      ...(execution.serviceTier === null ? {} : { serviceTier: execution.serviceTier }),
      input: relocatedInput({ intro: introOf, source: { threadId: thread.id, projectId: thread.projectId, label: thread.title ?? thread.id }, blocks: dispatch.blocks }),
    });
    relocated.add(created.id);
    states.set(thread.id, { kind: "moved", threadId: created.id });
    // Ждущее сообщение исходного треда снимается отказом со ссылкой на новый — до архива.
    await deps.recheck();
    await deps.started(created.id).catch((error: unknown) => deps.warn(`relocation: the new thread got no run (${String(error)})`));
    await deps.sdk.threads.open({ threadId: created.id, file: null }).catch((error: unknown) => deps.warn(`relocation: the new thread was not opened (${String(error)})`));
    await deps.sdk.threads.archive({ threadId: thread.id });
  };

  return {
    async hold(dispatch) {
      const known = states.get(dispatch.thread.id);
      if (known !== undefined) return decisionOf(known);
      if (!movesOutOfCheckout(deps.stagesOf(dispatch.thread.id))) return null;
      const place = await checkoutOf(dispatch);
      if (place === null) return null;
      states.set(dispatch.thread.id, { kind: "moving" });
      void move(dispatch, place).catch((error: unknown) => {
        // Тред мог и завестись — тогда исходный только не заархивирован, и сообщение в нём больше не нужно.
        if (states.get(dispatch.thread.id)?.kind === "moved") return deps.warn(`relocation: the source thread was not archived (${String(error)})`);
        states.set(dispatch.thread.id, { kind: "stayed" });
        deps.warn(`relocation: the thread stays in the project checkout (${error instanceof Error ? error.message : String(error)})`);
        void deps.recheck();
      });
      return decisionOf({ kind: "moving" });
    },
    isRelocated: (threadId) => relocated.has(threadId),
  };
};
