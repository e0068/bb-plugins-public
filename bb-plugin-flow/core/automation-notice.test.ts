// @vitest-environment node
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { mentionsIn, noticeCard, pullRequestIn, type AutomationNotice, type NoticeWords, type Segment } from "./automation-notice";

const WORDS: NoticeWords = {
  done: "done",
  failed: (step) => `step «${step}» failed`,
  retryAt: (iso) => `retry at ${iso}`,
  stepLabel: (step) => step.label,
};

const PR_URL = "https://github.com/e0068/bb-plugins/pull/541";

const base = {
  id: "n1",
  threadId: "thr_1",
  threadTitle: "Уведомления Flow",
  stageId: "publish",
  stageName: "Commit, FF to Main, PR",
  flowId: "flow-code",
  pr: null,
  steps: [],
} as const;

const done = (over: Partial<Extract<AutomationNotice, { kind: "done" }>> = {}): AutomationNotice => ({ ...base, kind: "done", ...over });
const failed = (over: Partial<Extract<AutomationNotice, { kind: "failed" }>> = {}): AutomationNotice => ({ ...base, kind: "failed", stepId: "git.merge", error: "not mergeable", retryAt: null, ...over });

const textOf = (segments: readonly Segment[]): string => segments.map((s) => s.text).join("");

describe("упоминания в строке", () => {
  it("ссылка на PR GitHub кликается и подписана номером", () => {
    expect(mentionsIn(`already open: ${PR_URL}`, false)).toEqual([
      { kind: "text", text: "already open: " },
      { kind: "url", url: PR_URL, text: "PR #541" },
    ]);
  });

  it("любая другая http(s)-ссылка кликается своим адресом", () => {
    expect(mentionsIn("see https://example.com/a.", false)).toEqual([
      { kind: "text", text: "see " },
      { kind: "url", url: "https://example.com/a", text: "https://example.com/a" },
      { kind: "text", text: "." },
    ]);
  });

  it("ключ задачи кликается только в строке задачного шага", () => {
    expect(mentionsIn("UTF-8 and BBPL-12", false)).toEqual([{ kind: "text", text: "UTF-8 and BBPL-12" }]);
    expect(mentionsIn("Tasks not moved to done: BBPL-12 (locked)", true)).toEqual([
      { kind: "text", text: "Tasks not moved to done: " },
      { kind: "task", address: "BBPL-12", route: "/plugins/tasks-plus/tasks/task/BBPL-12", text: "BBPL-12" },
      { kind: "text", text: " (locked)" },
    ]);
  });

  it("пустая строка не даёт сегментов", () => {
    expect(mentionsIn("", true)).toEqual([]);
  });

  it("склейка текстов сегментов равна исходной строке, если в ней нет PR-ссылки", () => {
    fc.assert(
      fc.property(fc.string(), fc.boolean(), (line, tasks) => {
        fc.pre(!/github\.com\/[^/\s]+\/[^/\s]+\/pull\/\d+/.test(line));
        expect(textOf(mentionsIn(line, tasks))).toBe(line);
      }),
    );
  });
});

describe("карточка доигранного этапа", () => {
  it("заголовок — этап ссылкой на flow и слово итога, первая строка — тред ссылкой", () => {
    const card = noticeCard(done(), WORDS);
    expect(card.tone).toBe("success");
    expect(card.title).toEqual([
      { kind: "flow", flowId: "flow-code", text: "Commit, FF to Main, PR" },
      { kind: "text", text: " — done" },
    ]);
    expect(card.lines[0]).toEqual([{ kind: "thread", threadId: "thr_1", text: "Уведомления Flow" }]);
  });

  it("этап без известного flow и тред без названия — текстом этапа и id треда", () => {
    const card = noticeCard(done({ flowId: null, threadTitle: null }), WORDS);
    expect(card.title[0]).toEqual({ kind: "text", text: "Commit, FF to Main, PR" });
    expect(card.lines[0]).toEqual([{ kind: "thread", threadId: "thr_1", text: "thr_1" }]);
  });

  it("строка шага — подпись и итог с упоминаниями; задачи задачного шага по одной ссылкой", () => {
    const card = noticeCard(
      done({
        steps: [
          { id: "git.commit", label: "Commit", detail: "Flow — notices" },
          { id: "git.create-pr", label: "Open a PR", detail: PR_URL },
          { id: "bb.tasks-in-review", label: "Task → in_review", detail: "BBPL-12, notices-slug" },
          { id: "git.pull-main", label: "Pull Main ← Origin", detail: null },
        ],
      }),
      WORDS,
    );
    expect(card.lines.slice(1)).toEqual([
      [{ kind: "text", text: "Commit — Flow — notices" }],
      [{ kind: "text", text: "Open a PR — " }, { kind: "url", url: PR_URL, text: "PR #541" }],
      [
        { kind: "text", text: "Task → in_review — " },
        { kind: "task", address: "BBPL-12", route: "/plugins/tasks-plus/tasks/task/BBPL-12", text: "BBPL-12" },
        { kind: "text", text: ", " },
        { kind: "task", address: "notices-slug", route: "/plugins/tasks-plus/tasks/task/notices-slug", text: "notices-slug" },
      ],
      [{ kind: "text", text: "Pull Main ← Origin" }],
    ]);
  });

  it("«no linked tasks» задачного шага остаётся текстом", () => {
    const card = noticeCard(done({ steps: [{ id: "bb.tasks-done", label: "Task → done", detail: "no linked tasks" }] }), WORDS);
    expect(card.lines[1]).toEqual([{ kind: "text", text: "Task → done — no linked tasks" }]);
  });

  it("с PR — кнопка GitHub и «к треду», без PR — только «к треду»", () => {
    expect(noticeCard(done({ pr: { number: 541, url: PR_URL } }), WORDS).actions).toEqual([
      { kind: "url", url: PR_URL },
      { kind: "thread", threadId: "thr_1" },
    ]);
    expect(noticeCard(done(), WORDS).actions).toEqual([{ kind: "thread", threadId: "thr_1" }]);
  });
});

describe("карточка упавшего шага", () => {
  it("заголовок называет шаг, строка — ошибку, кнопки — повтор, пропуск и тред", () => {
    const card = noticeCard(failed({ steps: [{ id: "git.merge", label: "Merge the PR", detail: null }] }), WORDS);
    expect(card.tone).toBe("error");
    expect(textOf(card.title)).toBe("Commit, FF to Main, PR — step «Merge the PR» failed");
    expect(card.lines).toEqual([[{ kind: "thread", threadId: "thr_1", text: "Уведомления Flow" }], [{ kind: "text", text: "not mergeable" }]]);
    expect(card.actions).toEqual([{ kind: "retry" }, { kind: "skip" }, { kind: "thread", threadId: "thr_1" }]);
  });

  it("шаг, которого нет в строках, называется своим id; назначенный автоповтор — отдельной строкой", () => {
    const card = noticeCard(failed({ stepId: "script:x", retryAt: "2026-09-27T10:00:00.000Z" }), WORDS);
    expect(textOf(card.title)).toBe("Commit, FF to Main, PR — step «script:x» failed");
    expect(card.lines.at(-1)).toEqual([{ kind: "text", text: "retry at 2026-09-27T10:00:00.000Z" }]);
  });

  it("ключи задач в ошибке задачного шага кликаются, PR в ошибке — тоже", () => {
    const card = noticeCard(failed({ stepId: "bb.tasks-done", error: "Tasks not moved to done: BBPL-3 (gone)", pr: { number: 541, url: PR_URL } }), WORDS);
    expect(card.lines[1]?.find((s) => s.kind === "task")).toEqual({ kind: "task", address: "BBPL-3", route: "/plugins/tasks-plus/tasks/task/BBPL-3", text: "BBPL-3" });
    expect(card.actions[0]).toEqual({ kind: "url", url: PR_URL });
  });
});

describe("PR в строках прогона", () => {
  it("первая ссылка на PR GitHub в итогах шагов — номер и адрес", () => {
    expect(pullRequestIn(["nothing to commit", `already open: ${PR_URL}`, "https://github.com/o/r/pull/9"])).toEqual({ number: 541, url: PR_URL });
  });

  it("строк без ссылки на PR — нет PR", () => {
    expect(pullRequestIn(["https://github.com/o/r/issues/3", "no linked tasks"])).toBeNull();
  });
});
