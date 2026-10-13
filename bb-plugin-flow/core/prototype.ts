// Прототип в окне виджета — чистые функции без React и сервера. Страница прототипа шлёт виджету свои развилки, выбор
// владельца и подпись места для комментария; виджет держит память: развилки, выбор, комментарии и что из этого уже ушло
// агенту. Ответ на утверждение несёт только неотправленное: повторно агенту ничего не уходит.
import { z } from "zod";

import type { Locale } from "../lib/i18n";
import { messages } from "../lib/messages";
import { PROTOTYPE_LIMITS, PROTOTYPE_SOURCE } from "../lib/prototype-protocol";
import type { PrototypeComment, PrototypeEdit, PrototypeFork, PrototypeState } from "../shared/contract";

const label = z.string().trim().min(1).max(PROTOTYPE_LIMITS.label);
const fork = z.object({ id: label, label, options: z.array(z.object({ value: label, label })).min(1).max(PROTOTYPE_LIMITS.options) });
const source = z.literal(PROTOTYPE_SOURCE);

const frameSchema = z.discriminatedUnion("type", [
  z.object({ source, type: z.literal("ready"), forks: z.array(fork).max(PROTOTYPE_LIMITS.forks) }),
  z.object({ source, type: z.literal("choice"), fork: label, value: label }),
  z.object({ source, type: z.literal("picked"), label }),
]);

/** Сообщение страницы прототипа виджету. */
export type FrameMessage = z.output<typeof frameSchema>;

/** Сообщение окна, разобранное по протоколу; чужое или битое — `null`. */
export const frameMessage = (data: unknown): FrameMessage | null => {
  const parsed = frameSchema.safeParse(data);
  return parsed.success ? parsed.data : null;
};

/** Сообщения виджета странице: вернуть сохранённый выбор, переключить развилку, ждать клика по месту для комментария. */
export const restoreMessage = (choices: PrototypeState["choices"]) => ({ source: PROTOTYPE_SOURCE, type: "restore", choices, embedded: true }) as const;
export const setMessage = (forkId: string, value: string) => ({ source: PROTOTYPE_SOURCE, type: "set", fork: forkId, value }) as const;
export const PICK_MESSAGE = { source: PROTOTYPE_SOURCE, type: "pick" } as const;

/** Адрес, по которому виджет помнит прототип: без якоря — `#…` не меняет страницу. */
export const prototypeAddress = (url: string): string => url.split("#")[0]!;

export const EMPTY_PROTOTYPE: PrototypeState = { forks: [], choices: {}, sentChoices: {}, comments: [] };

const known = (forks: readonly PrototypeFork[], forkId: string, value: string): boolean =>
  forks.some((f) => f.id === forkId && f.options.some((o) => o.value === value));

/** Развилки, которые прислала страница; выбор, которого среди них больше нет, отбрасывается. */
export const withForks = (state: PrototypeState, forks: readonly PrototypeFork[]): PrototypeState => ({
  ...state,
  forks: [...forks],
  choices: Object.fromEntries(Object.entries(state.choices).filter(([forkId, value]) => known(forks, forkId, value))),
});

/** Выбор владельца — только известной развилки и её варианта. */
export const withChoice = (state: PrototypeState, forkId: string, value: string): PrototypeState =>
  known(state.forks, forkId, value) ? { ...state, choices: { ...state.choices, [forkId]: value } } : state;

export const withComment = (state: PrototypeState, comment: Omit<PrototypeComment, "sent">): PrototypeState =>
  state.comments.length >= PROTOTYPE_LIMITS.comments ? state : { ...state, comments: [...state.comments, comment] };

/** Удаляется только неотправленный комментарий: отправленный агент уже прочёл. */
export const withoutComment = (state: PrototypeState, id: string): PrototypeState => ({
  ...state,
  comments: state.comments.filter((c) => c.id !== id || c.sent === true),
});

/** Что ещё не ушло агенту: выбор, изменившийся с прошлой отправки, и комментарии без отметки. */
export const unsent = (state: PrototypeState) => ({
  choices: Object.entries(state.choices)
    .filter(([forkId, value]) => state.sentChoices[forkId] !== value)
    .map(([forkId, value]) => ({ fork: forkId, value })),
  comments: state.comments.filter((c) => c.sent !== true),
});

/** Всё ушло агенту: выбор запомнен отправленным, комментарии отмечены. */
export const markSent = (state: PrototypeState): PrototypeState => ({
  ...state,
  sentChoices: { ...state.choices },
  comments: state.comments.map((c) => ({ ...c, sent: true as const })),
});

/** Правка виджета поверх памяти: отметки отправки — сервера, отправленный комментарий правкой не стирается. */
export const mergeEdit = (stored: PrototypeState, edit: PrototypeEdit): PrototypeState => {
  const sent = stored.comments.filter((c) => c.sent === true);
  const sentIds = new Set(sent.map((c) => c.id));
  return { forks: edit.forks, choices: edit.choices, sentChoices: stored.sentChoices, comments: [...sent, ...edit.comments.filter((c) => !sentIds.has(c.id))] };
};

/** То, что виджет пишет на сервер: память без отметок отправки. */
export const editOf = (state: PrototypeState): PrototypeEdit => ({
  forks: state.forks,
  choices: state.choices,
  comments: state.comments.filter((c) => c.sent !== true).map(({ id, text, at }) => ({ id, text, ...(at === undefined ? {} : { at }) })),
});

const choiceLine = (state: PrototypeState) => ({ fork: forkId, value }: { fork: string; value: string }): string => {
  const f = state.forks.find((x) => x.id === forkId);
  return `- ${f?.label ?? forkId} — ${f?.options.find((o) => o.value === value)?.label ?? value}`;
};

/** Строки ответа на утверждение: «Выбор в прототипе» и «Комментарии к прототипу» по неотправленному; нечего — пусто. */
export const prototypeLines = (states: readonly PrototypeState[], locale?: Locale): string[] => {
  const m = messages(locale).answer;
  const choices = states.flatMap((state) => unsent(state).choices.map(choiceLine(state)));
  const comments = states.flatMap((state) => unsent(state).comments.map((c) => `- ${c.at === undefined ? "" : `${c.at} — `}${c.text}`));
  return [...(choices.length === 0 ? [] : [m.prototypeChoices, ...choices]), ...(comments.length === 0 ? [] : [m.prototypeComments, ...comments])];
};
