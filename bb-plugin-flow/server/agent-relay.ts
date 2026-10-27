// Реплика Flow агенту, которую ждёт идущий вызов flow_stage. Агент отметил этап перед автоматизацией — вызов не
// отвечает, пока Flow её не доиграет, и реплика, которую Flow послал бы в тред, уходит в ответ инструмента: агент
// продолжает в том же ходе, без нового хода и без сообщения в ленте. Реплику, которую вызов не отдал агенту, посредник
// сам шлёт в тред: ни отмена вызова, ни снятое ожидание, ни выгрузка плагина её не теряют.
// Реплика с перепроверкой, которую ждущий вызов не взял, при идущем ходе агента не встаёт в его очередь: она ждёт конца
// хода и уходит, только если к тому времени ещё нужна — за ход агент мог сделать то, ради чего Flow его будил.
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
  /**
   * Реплика Flow треду: ждущему вызову, пока ход агента идёт, иначе — сообщением в тред.
   * С `due` реплика, которую вызов не взял, ждёт конца идущего хода и уходит, только если `due()` ещё отвечает «нужна»;
   * ход не идёт — перепроверка и отправка сразу. Отложенная реплика не держит вызывающего.
   */
  deliver(threadId: string, text: string, due?: () => Promise<boolean>): Promise<void>;
  /** Выгрузка плагина: ждущие вызовы отвечают «отменено», неотданные и отложенные реплики (если ещё нужны) уходят в тред. */
  dispose(): void;
}

/** Сколько вызов инструмента ждёт реплику Flow: дольше — ход агента держит вызов, а Flow напишет в тред сам. */
export const RELAY_WAIT_MS = 10 * 60_000;

/** Как часто ожидание смотрит, идёт ли ещё работа Flow над тредом. */
const POLL_MS = 250;

/** Как часто отложенная реплика смотрит, кончился ли ход агента: это запрос к хосту, а не к памяти, — реже. */
const TURN_POLL_MS = 2_000;

type Slot = {
  threadId: string;
  /** Реплика, принятая для агента; `null` — ещё не пришла. */
  reply: string | null;
  /** Перепроверка реплики: ожидание, не отдавшее её агенту, передаёт дальше вместе с ней. */
  due?: () => Promise<boolean>;
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
  const take = async (threadId: string, text: string, due?: () => Promise<boolean>): Promise<boolean> => {
    const free = () => [...(slots.get(threadId) ?? [])].filter((slot) => !slot.closed && slot.reply === null);
    if (disposed || free().length === 0 || !(await deps.alive(threadId).catch(() => false))) return false;
    // Пока шла проверка хода, ожидания могли закрыться: выбор — после неё.
    const target = free().find((slot) => slot.check !== null) ?? free()[0];
    if (target === undefined) return false;
    target.reply = text;
    target.due = due;
    target.check?.();
    return true;
  };

  /** Отложенные реплики: каждая — сброс «перепроверить и отправить»; он же снимает опрос хода. */
  const deferred = new Set<() => Promise<void>>();

  const sendIfDue = async (threadId: string, text: string, due: () => Promise<boolean>): Promise<void> => {
    if (await due()) await deps.send(threadId, text);
  };

  /** Ждёт конца хода агента и тогда перепроверяет реплику; сбой перепроверки или отправки — в `onError`. */
  const defer = (threadId: string, text: string, due: () => Promise<boolean>): void => {
    let finished = false;
    let checking = false;
    const flush = async (): Promise<void> => {
      if (finished) return;
      finished = true;
      clearInterval(poll);
      deferred.delete(flush);
      await sendIfDue(threadId, text, due).catch(deps.onError);
    };
    const poll = setInterval(() => {
      if (checking) return;
      checking = true;
      void deps
        .alive(threadId)
        .catch(() => false)
        .then((running) => (running ? undefined : flush()))
        .finally(() => (checking = false));
    }, deps.pollMs ?? TURN_POLL_MS);
    deferred.add(flush);
  };

  const deliver = async (threadId: string, text: string, due?: () => Promise<boolean>): Promise<void> => {
    if (await take(threadId, text, due)) return;
    if (due === undefined) return deps.send(threadId, text);
    if (!disposed && (await deps.alive(threadId).catch(() => false))) return defer(threadId, text, due);
    await sendIfDue(threadId, text, due);
  };

  /** Закрывает ожидание и передаёт дальше реплику, которую оно не отдало агенту. */
  const settle = (slot: Slot) => {
    if (slot.closed) return;
    slot.closed = true;
    slots.get(slot.threadId)?.delete(slot);
    if (slot.reply === null || slot.handled) return;
    slot.handled = true;
    void deliver(slot.threadId, slot.reply, slot.due).catch(deps.onError);
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
      for (const flush of [...deferred]) void flush();
      for (const slot of [...slots.values()].flatMap((set) => [...set])) {
        if (slot.check !== null) slot.check();
        else settle(slot);
      }
    },
  };
};
