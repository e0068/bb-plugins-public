// Слой 1 — чисто. Когда сообщение треда ждёт выбора flow: прогон треда
// завершён, и ход начинает владелец. Агент другого треда, системное сообщение,
// повтор упавшего хода и вклинивание в идущий ход проходят как раньше.

/** Кто пишет и как сообщение доходит до агента — в словах хука `message.dispatch`. */
export type DispatchAttempt = {
  finished: boolean;
  attempt: "start-turn" | "join-turn";
  initiator: string;
  retry: boolean;
};

export const holdsForNextFlow = ({ finished, attempt, initiator, retry }: DispatchAttempt): boolean =>
  finished && attempt === "start-turn" && initiator === "user" && !retry;
