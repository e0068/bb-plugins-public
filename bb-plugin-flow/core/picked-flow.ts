// Слой 1 — чисто. Какое сообщение применяет flow, выбранный в контейнере состояния Flow: ход начинает владелец.
// Агент другого треда, системное сообщение, повтор упавшего хода и вклинивание в идущий ход выбор не применяют.

/** Кто пишет и как сообщение доходит до агента — в словах хука `message.dispatch`. */
export type DispatchAttempt = {
  attempt: "start-turn" | "join-turn";
  initiator: string;
  retry: boolean;
};

/** Применяет ли сообщение выбранный flow: ход начинает владелец, и это не повтор — вклинившееся в идущий ход сообщение инструкций хода не получает. */
export const appliesPickedFlow = ({ attempt, initiator, retry }: DispatchAttempt): boolean => attempt === "start-turn" && initiator === "user" && !retry;
