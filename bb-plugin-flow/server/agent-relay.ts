// Реплика Flow агенту, которую ждёт идущий вызов flow_stage. Агент отметил этап перед автоматизацией — вызов не
// отвечает, пока Flow её не доиграет, и реплика, которую Flow послал бы в тред, уходит в ответ инструмента: агент
// продолжает в том же ходе, без нового хода и без сообщения в ленте. Реплику, которую вызов не отдал агенту, посредник
// сам шлёт в тред: ни отмена вызова, ни снятое ожидание, ни выгрузка плагина её не теряют.
import type { WaitOutcome } from "../core/mark-report";

export interface RelayHold {
  /** Ждёт реплику до срока `ms`, конца работы Flow над тредом или отмены вызова; после ответа реплики идут в тред. */
  wait(options: { ms: number; signal?: AbortSignal }): Promise<WaitOutcome>;
  /** Снимает ожидание; реплика, которую вызов не отдал агенту, идёт соседнему ожиданию или в тред. */
  release(): void;
}

export interface AgentRelay {
  /** Ставит тред в ожидание реплики до отметки этапа: реплика, пришедшая раньше `wait`, не теряется. */
  hold(threadId: string): RelayHold;
  /** Реплика Flow треду: ждущему вызову, пока ход агента идёт, иначе — сообщением в тред. */
  deliver(threadId: string, text: string): Promise<void>;
  /** Выгрузка плагина: ждущие вызовы отвечают «отменено», неотданные реплики уходят в тред. */
  dispose(): void;
}

/** Как часто ожидание смотрит, идёт ли ещё работа Flow над тредом. */
const POLL_MS = 250;

type Slot = {
  threadId: string;
  /** Реплика, принятая для агента; `null` — ещё не пришла. */
  reply: string | null;
  /** Реплика ушла агенту ответом или передана дальше — второй раз её не шлют. */
  handled: boolean;
  closed: boolean;
  /** Проверка ждущего вызова; `null` — вызов ещё не ждёт или уже ответил. */
  check: (() => void) | null;
};

export const createAgentRelay = (deps: {
  /** Идёт ли сейчас работа Flow над тредом: цепочка автоматизаций, повтор или пропуск шага. */
  busy: (threadId: string) => boolean;
  /** Идёт ли ход агента треда: кончился — ответ вызова уже никто не прочтёт. */
  alive: (threadId: string) => Promise<boolean>;
  /** Сообщение в тред — путь реплики, когда её никто не ждёт. */
  send: (threadId: string, text: string) => Promise<void>;
  /** Сбой отправки реплики, переданной дальше из снятого ожидания. */
  onError: (error: unknown) => void;
  pollMs?: number;
}): AgentRelay => {
  const slots = new Map<string, Set<Slot>>();
  let disposed = false;

  /** Принимает реплику в ожидание треда — сначала в ждущее, потом в поставленное; `false` — принять некому. */
  const take = async (threadId: string, text: string): Promise<boolean> => {
    const free = () => [...(slots.get(threadId) ?? [])].filter((slot) => !slot.closed && slot.reply === null);
    if (disposed || free().length === 0 || !(await deps.alive(threadId).catch(() => false))) return false;
    // Пока шла проверка хода, ожидания могли закрыться: выбор — после неё.
    const target = free().find((slot) => slot.check !== null) ?? free()[0];
    if (target === undefined) return false;
    target.reply = text;
    target.check?.();
    return true;
  };

  const deliver = async (threadId: string, text: string): Promise<void> => {
    if (!(await take(threadId, text))) await deps.send(threadId, text);
  };

  /** Закрывает ожидание и передаёт дальше реплику, которую оно не отдало агенту. */
  const settle = (slot: Slot) => {
    if (slot.closed) return;
    slot.closed = true;
    slots.get(slot.threadId)?.delete(slot);
    if (slot.reply === null || slot.handled) return;
    slot.handled = true;
    void deliver(slot.threadId, slot.reply).catch(deps.onError);
  };

  return {
    hold: (threadId) => {
      const slot: Slot = { threadId, reply: null, handled: false, closed: disposed, check: null };
      if (!disposed) slots.set(threadId, (slots.get(threadId) ?? new Set()).add(slot));
      return {
        wait: ({ ms, signal }) =>
          new Promise<WaitOutcome>((resolve) => {
            const finish = (outcome: WaitOutcome) => {
              clearTimeout(timer);
              clearInterval(poll);
              signal?.removeEventListener("abort", onAbort);
              slot.check = null;
              if (outcome.kind === "reply") slot.handled = true;
              settle(slot);
              resolve(outcome);
            };
            // Отмена — раньше реплики: ответ отменённого вызова агент не прочтёт, и реплика уходит дальше.
            const check = () => {
              if (disposed || slot.closed || signal?.aborted === true) return finish({ kind: "aborted" });
              if (slot.reply !== null) return finish({ kind: "reply", text: slot.reply });
              if (!deps.busy(threadId)) finish({ kind: "quiet" });
            };
            const onAbort = () => check();
            signal?.addEventListener("abort", onAbort);
            const timer = setTimeout(() => (slot.reply === null ? finish({ kind: "timeout" }) : check()), ms);
            // Опрос нужен только концу работы Flow без реплики: реплика и отмена приходят событием.
            const poll = setInterval(check, deps.pollMs ?? POLL_MS);
            slot.check = check;
            check();
          }),
        release: () => settle(slot),
      };
    },
    deliver,
    dispose: () => {
      disposed = true;
      for (const slot of [...slots.values()].flatMap((set) => [...set])) {
        if (slot.check !== null) slot.check();
        else settle(slot);
      }
    },
  };
};
