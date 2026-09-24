// Отправки самого Flow в тред — ответ на бриф и побудка после автоматизаций.
// Хук следующего прогона их не придерживает: bb помечает автором владельца и
// сообщение из композера, и отправку плагина, поэтому Flow отмечает свои перед
// отправкой. Отметка живёт до ухода сообщения — хук переспрашивается на
// каждом проходе очереди, — а память ограничена, если событие ухода потерялось.

/** Сколько отметок держится: отправки Flow редки, старейшая вытесняется. */
export const OWN_SENDS_CAP = 100;

export type OwnSends = {
  mark(threadId: string, text: string): void;
  has(threadId: string, text: string): boolean;
  forget(threadId: string, text: string): void;
};

const keyOf = (threadId: string, text: string): string => `${threadId}\u0000${text}`;

export const createOwnSends = (): OwnSends => {
  // Set помнит порядок вставки: первый элемент — старейшая отметка.
  const marks = new Set<string>();
  return {
    mark(threadId, text) {
      marks.add(keyOf(threadId, text));
      if (marks.size > OWN_SENDS_CAP) marks.delete(marks.values().next().value!);
    },
    has: (threadId, text) => marks.has(keyOf(threadId, text)),
    forget(threadId, text) {
      marks.delete(keyOf(threadId, text));
    },
  };
};
