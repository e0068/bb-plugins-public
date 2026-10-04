// @vitest-environment node
import { describe, expect, it } from "vitest";
import { isNotificationInput } from "@bb-plugins/notifications-contract/index";
import type { AutomationNotice } from "./automation-notice";
import { ru } from "../lib/messages/ru";
import { automationEntry, NOTICE_ACTION_PATH, turnEndEntry } from "./center-notice";

const NOTICE: AutomationNotice = {
  id: "n1",
  kind: "done",
  threadId: "thr_1",
  threadTitle: "Тред",
  stageId: "flow-automation",
  stageName: "Commit, FF to Main, PR, Preview",
  flowId: "f1",
  pr: { number: 623, url: "https://github.com/o/r/pull/623" },
  steps: [{ id: "git.create-pr", label: "Открыть PR", detail: null }],
};

describe("automationEntry", () => {
  it("упавший этап — «упала на шаге» с подписью шага, без PR — без ссылки", () => {
    const entry = automationEntry({ ...NOTICE, kind: "failed", stepId: "git.create-pr", error: "boom", pr: null });
    expect(entry.kind).toBe("automation-failed");
    expect(entry.title).toBe("Автоматизация «Commit, FF to Main, PR, Preview» упала на шаге «Открыть PR»");
    expect(entry.url).toBeNull();
  });

  it("шаг без подписи называется своим id", () => {
    expect(automationEntry({ ...NOTICE, kind: "failed", stepId: "git.merge", error: "boom" }).title).toBe("Автоматизация «Commit, FF to Main, PR, Preview» упала на шаге «git.merge»");
  });
});

describe("запись конца хода для центра", () => {
  it("тред держит бриф — «ждёт ответа» с названием брифа, один раз на бриф, без тоста по умолчанию", () => {
    const entry = turnEndEntry({ threadId: "thr_1", threadTitle: "Тред", brief: { id: "dec_1", title: "Плагин" } });
    expect(entry).toMatchObject({ source: "flow", sourceName: "Flow", kind: "awaiting", kindLabel: "Ждёт ответа", title: "Ждёт ответа — бриф «Плагин»", threadId: "thr_1", threadTitle: "Тред", url: null, dedupeKey: "brief:dec_1", toastByDefault: false });
    expect(isNotificationInput(entry)).toBe(true);
  });

  it("брифа нет — «ход закончен», каждый раз своя запись, без тоста по умолчанию", () => {
    const entry = turnEndEntry({ threadId: "thr_1", threadTitle: null, brief: null });
    expect(entry).toMatchObject({ source: "flow", sourceName: "Flow", kind: "turn-done", kindLabel: "Ход закончен", title: "Ход закончен", threadTitle: null, dedupeKey: null, toastByDefault: false });
    expect(isNotificationInput(entry)).toBe(true);
  });
});

describe("запись итога автоматизации с карточкой тоста", () => {
  const PR = "https://github.com/o/r/pull/623";
  const done: AutomationNotice = {
    ...NOTICE,
    steps: [
      { id: "git.create-pr", label: "Open a PR", detail: PR },
      { id: "bb.tasks-done", label: "Task → done", detail: "BBPL-12, my-task" },
    ],
  };

  it("доигранный этап — запись «прошла» со ссылкой на PR, тоном успеха и тостом по умолчанию", () => {
    const entry = automationEntry(done);
    expect(entry).toMatchObject({
      source: "flow",
      sourceName: "Flow",
      kind: "automation-done",
      kindLabel: "Автоматизация прошла",
      title: "Автоматизация «Commit, FF to Main, PR, Preview» прошла",
      threadId: "thr_1",
      url: PR,
      dedupeKey: "automation:n1",
      tone: "success",
      toastByDefault: true,
    });
    expect(isNotificationInput(entry)).toBe(true);
  });

  it("карточка: этап — ссылка на страницу flow, тред, шаги по-русски, PR и задачи — ссылки", () => {
    const card = automationEntry(done).toast!;
    expect(card.key).toBe("thr_1:flow-automation");
    expect(card.title).toEqual([
      { kind: "route", route: "/plugins/flow/flows/f1", text: "Commit, FF to Main, PR, Preview" },
      { kind: "text", text: " — готово" },
    ]);
    expect(card.lines[0]).toEqual([{ kind: "thread", threadId: "thr_1", text: "Тред" }]);
    expect(card.lines[1]).toEqual([{ kind: "text", text: `${ru.steps["git.create-pr"]} — ` }, { kind: "url", url: PR, text: "PR #623" }]);
    expect(card.lines[2]).toEqual([
      { kind: "text", text: `${ru.steps["bb.tasks-done"]} — ` },
      { kind: "route", route: "/plugins/tasks-plus/tasks/task/BBPL-12", text: "BBPL-12" },
      { kind: "text", text: ", " },
      { kind: "route", route: "/plugins/tasks-plus/tasks/task/my-task", text: "my-task" },
    ]);
    expect(card.actions).toEqual([
      { label: "View on GitHub", icon: "github", target: { kind: "url", url: PR } },
      { label: "К треду", icon: "thread", target: { kind: "thread", threadId: "thr_1" } },
    ]);
  });

  it("упавший этап — тон ошибки, «Повторить» и «Пропустить» зовут вход Flow с тредом и этапом", () => {
    const entry = automationEntry({ ...NOTICE, kind: "failed", stepId: "git.create-pr", error: "boom", pr: null, flowId: null });
    expect(entry).toMatchObject({ kind: "automation-failed", kindLabel: "Автоматизация упала", tone: "error", toastByDefault: true });
    const card = entry.toast!;
    expect(card.title).toEqual([{ kind: "text", text: `Commit, FF to Main, PR, Preview — шаг «${ru.steps["git.create-pr"]}» упал` }]);
    expect(card.lines[1]).toEqual([{ kind: "text", text: "boom" }]);
    const payload = { threadId: "thr_1", stage: "flow-automation", stageName: "Commit, FF to Main, PR, Preview" };
    expect(card.actions).toEqual([
      { label: "Повторить", icon: "retry", target: { kind: "callback", path: NOTICE_ACTION_PATH, payload: { action: "retry", ...payload } } },
      { label: "Пропустить", icon: "skip", target: { kind: "callback", path: NOTICE_ACTION_PATH, payload: { action: "skip", ...payload } } },
      { label: "К треду", icon: "thread", target: { kind: "thread", threadId: "thr_1" } },
    ]);
    expect(isNotificationInput(entry)).toBe(true);
  });
});
