// Уведомление об итоге этапа-автоматизации: что знает о нём сервер и во что
// оно превращается на карточке тоста, которую показывает Центр уведомлений.
// Всё, что в тосте упомянуто, — тред, PR, задача, flow, — становится ссылкой;
// какие куски кликаются, решается здесь, а центр только рисует сегменты.
import { taskRoute } from "./run-tasks";

/** Строка шага этапа: id шага, подпись снимка прогона и итог шага, если он был. */
export type NoticeStep = { id: string; label: string; detail: string | null };

type NoticeBase = {
  /** Уникален на событие: по нему несколько слушателей показывают один тост. */
  id: string;
  threadId: string;
  threadTitle: string | null;
  stageId: string;
  stageName: string;
  /** Flow треда — название этапа ведёт на его страницу; `null` — flow не найден. */
  flowId: string | null;
  pr: { number: number; url: string } | null;
  steps: readonly NoticeStep[];
};

/** `done` — этап доигран; `failed` — шаг `stepId` упал, автоповторов впереди нет, этап ждёт владельца. */
export type AutomationNotice = (NoticeBase & { kind: "done" }) | (NoticeBase & { kind: "failed"; stepId: string; error: string });

export type Segment =
  | { kind: "text"; text: string }
  | { kind: "thread"; threadId: string; text: string }
  | { kind: "task"; address: string; route: string; text: string }
  | { kind: "url"; url: string; text: string }
  | { kind: "flow"; flowId: string; text: string };

export type NoticeAction = { kind: "url"; url: string } | { kind: "thread"; threadId: string } | { kind: "retry" } | { kind: "skip" };

export type NoticeCard = { tone: "success" | "error"; title: Segment[]; lines: Segment[][]; actions: NoticeAction[] };

/** Слова карточки на языке владельца. */
export type NoticeWords = {
  done: string;
  failed: (step: string) => string;
  stepLabel: (step: NoticeStep) => string;
};

/** Шаги, чьи строки называют задачи: ключ или слаг в их итоге и ошибке — ссылка на карточку. */
const TASK_STEPS: ReadonlySet<string> = new Set(["bb.tasks-in-review", "bb.tasks-done", "bb.tasks-issue-keys"]);

const isTaskStep = (stepId: string): boolean => TASK_STEPS.has(stepId);

// Ссылка кончается не на знаке препинания: точка после адреса — конец фразы, а не часть адреса.
const URL_SOURCE = String.raw`https?:\/\/[^\s<>"'\x60]*[^\s<>"'\x60.,;:!?)\]]`;
const TASK_KEY_SOURCE = String.raw`\b[A-Z][A-Z0-9]*-\d+\b`;
const PR_URL = /^https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/pull\/(\d+)$/;

const text = (value: string): Segment => ({ kind: "text", text: value });
const task = (address: string): Segment => ({ kind: "task", address, route: taskRoute(address), text: address });

const urlSegment = (url: string): Segment => {
  const pr = PR_URL.exec(url);
  return { kind: "url", url, text: pr === null ? url : `PR #${pr[1]}` };
};

/** Соседние куски текста — один кусок: строка без упоминаний остаётся одним сегментом. */
const joined = (segments: readonly Segment[]): Segment[] =>
  segments.reduce<Segment[]>((acc, segment) => {
    const last = acc.at(-1);
    if (segment.kind === "text" && segment.text === "") return acc;
    return last?.kind === "text" && segment.kind === "text" ? [...acc.slice(0, -1), text(last.text + segment.text)] : [...acc, segment];
  }, []);

/** Упоминания в строке: ссылки всегда, ключи задач вида `ABC-12` — когда строка задачного шага. */
export const mentionsIn = (line: string, tasks: boolean): Segment[] => {
  const pattern = new RegExp(tasks ? `(${URL_SOURCE})|(${TASK_KEY_SOURCE})` : `(${URL_SOURCE})`, "g");
  const matches = [...line.matchAll(pattern)];
  const ends = [0, ...matches.map((m) => (m.index ?? 0) + m[0].length)];
  return joined([
    ...matches.flatMap((m, i) => [text(line.slice(ends[i], m.index)), m[1] !== undefined ? urlSegment(m[1]) : task(m[0])]),
    text(line.slice(ends.at(-1))),
  ]);
};

/** Первый PR GitHub, названный ссылкой в строках: шаг «Открыть PR» кладёт её в свой итог. */
export const pullRequestIn = (lines: readonly string[]): { number: number; url: string } | null => {
  const found = lines.flatMap((line) => mentionsIn(line, false)).flatMap((s) => (s.kind === "url" ? [PR_URL.exec(s.url)] : [])).find((m) => m !== null);
  return found === undefined || found === null ? null : { number: Number(found[1]), url: found[0] };
};

/** Перечень задач, переведённых шагом: ключи и слаги через запятую — каждый ссылкой; иная строка — упоминания. */
const taskListOrMentions = (detail: string): Segment[] => {
  const items = detail.split(", ");
  return items.every((item) => /^[\w-]+$/.test(item)) ? items.flatMap((item, i) => (i === 0 ? [task(item)] : [text(", "), task(item)])) : mentionsIn(detail, true);
};

const detailSegments = (step: NoticeStep, detail: string): Segment[] => (isTaskStep(step.id) ? taskListOrMentions(detail) : mentionsIn(detail, false));

const stepLine = (step: NoticeStep, words: NoticeWords): Segment[] =>
  joined([text(words.stepLabel(step)), ...(step.detail === null || step.detail === "" ? [] : [text(" — "), ...detailSegments(step, step.detail)])]);

const stageSegment = (notice: AutomationNotice): Segment =>
  notice.flowId === null ? text(notice.stageName) : { kind: "flow", flowId: notice.flowId, text: notice.stageName };

const threadLine = (notice: AutomationNotice): Segment[] => [{ kind: "thread", threadId: notice.threadId, text: notice.threadTitle ?? notice.threadId }];

const prAction = (notice: AutomationNotice): NoticeAction[] => (notice.pr === null ? [] : [{ kind: "url", url: notice.pr.url }]);

const failedStepLabel = (notice: Extract<AutomationNotice, { kind: "failed" }>, words: NoticeWords): string => {
  const step = notice.steps.find((s) => s.id === notice.stepId);
  return step === undefined ? notice.stepId : words.stepLabel(step);
};

/** Карточка тоста: заголовок, строки и кнопки; всё упомянутое — сегментом-ссылкой. */
export const noticeCard = (notice: AutomationNotice, words: NoticeWords): NoticeCard => {
  const thread: NoticeAction = { kind: "thread", threadId: notice.threadId };
  switch (notice.kind) {
    case "done":
      return {
        tone: "success",
        title: [stageSegment(notice), text(` — ${words.done}`)],
        lines: [threadLine(notice), ...notice.steps.map((step) => stepLine(step, words))],
        actions: [...prAction(notice), thread],
      };
    case "failed":
      return {
        tone: "error",
        title: [stageSegment(notice), text(` — ${words.failed(failedStepLabel(notice, words))}`)],
        lines: [threadLine(notice), mentionsIn(notice.error, isTaskStep(notice.stepId))],
        actions: [...prAction(notice), { kind: "retry" }, { kind: "skip" }, thread],
      };
  }
};
