// @vitest-environment node
import { describe, expect, it } from "vitest";
import { isNotificationInput } from "@bb-plugins/notifications-contract/index";
import type { AutomationNotice } from "./automation-notice";
import { automationEntry, turnEndEntry } from "./center-notice";

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

describe("turnEndEntry", () => {
  it("тред держит бриф — «ждёт ответа» с названием брифа, один раз на бриф", () => {
    const entry = turnEndEntry({ threadId: "thr_1", threadTitle: "Тред", brief: { id: "dec_1", title: "Плагин" } });
    expect(entry).toEqual({ source: "flow", kind: "awaiting", title: "Ждёт ответа — бриф «Плагин»", threadId: "thr_1", threadTitle: "Тред", url: null, dedupeKey: "brief:dec_1" });
    expect(isNotificationInput(entry)).toBe(true);
  });

  it("брифа нет — «ход закончен», каждый раз своя запись", () => {
    const entry = turnEndEntry({ threadId: "thr_1", threadTitle: null, brief: null });
    expect(entry).toEqual({ source: "flow", kind: "turn-done", title: "Ход закончен", threadId: "thr_1", threadTitle: null, url: null, dedupeKey: null });
    expect(isNotificationInput(entry)).toBe(true);
  });
});

describe("automationEntry", () => {
  it("доигранный этап — «прошла», со ссылкой на PR, одна запись на событие", () => {
    const entry = automationEntry(NOTICE);
    expect(entry).toEqual({
      source: "flow",
      kind: "automation-done",
      title: "Автоматизация «Commit, FF to Main, PR, Preview» прошла",
      threadId: "thr_1",
      threadTitle: "Тред",
      url: "https://github.com/o/r/pull/623",
      dedupeKey: "automation:n1",
    });
    expect(isNotificationInput(entry)).toBe(true);
  });

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
