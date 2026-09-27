// @vitest-environment node
import { describe, expect, it } from "vitest";

import type { AutomationNotice } from "../core/automation-notice";
import type { FlowProgress, WorkStage } from "../shared/contract";
import { createNoticePublisher, type NoticePorts } from "./automation-notices";

const THREAD = "thr_n";
const PR_URL = "https://github.com/e0068/bb-plugins/pull/541";

const flowStage = (id: string, name: string, steps: string[]): WorkStage => ({ id, kind: "skill", skill: "", name, executors: [], automation: { source: "flow", steps } }) as WorkStage;

const run = (steps: Array<{ id: string; label: string; detail?: string }>) => ({ steps, at: steps.length, error: null });

const record = (stages: FlowProgress["stages"]): FlowProgress => ({ stages, waiting: [] });

const ports = (over: Partial<NoticePorts> & { progressRecord?: FlowProgress | null } = {}) => {
  const published: AutomationNotice[] = [];
  const lookedUp: string[] = [];
  const base: NoticePorts = {
    progress: { get: async () => over.progressRecord ?? null },
    thread: async () => ({ title: "Уведомления Flow", environmentId: "env_1" }),
    pullRequest: async (environmentId) => {
      lookedUp.push(environmentId);
      return null;
    },
    flow: () => ({ id: "flow-code" }),
    publish: (notice) => void published.push(notice),
    newId: () => "n1",
  };
  const { progressRecord: _record, ...rest } = over;
  return { published, lookedUp, publish: createNoticePublisher({ ...base, ...rest }) };
};

describe("публикация уведомления об автоматизации", () => {
  it("доигранный этап публикуется один раз с названием треда, flow и строками шагов этапа", async () => {
    const publish = flowStage("publish", "Commit, FF to Main, PR", ["git.commit", "git.create-pr"]);
    const { published, publish: send } = ports({
      progressRecord: record({ publish: { run: run([{ id: "git.commit", label: "Commit", detail: "Flow — notices" }, { id: "git.create-pr", label: "Open a PR", detail: PR_URL }]) } }),
    });
    await send({ kind: "done", threadId: THREAD, stage: publish });
    expect(published).toEqual([
      {
        kind: "done",
        id: "n1",
        threadId: THREAD,
        threadTitle: "Уведомления Flow",
        stageId: "publish",
        stageName: "Commit, FF to Main, PR",
        flowId: "flow-code",
        pr: { number: 541, url: PR_URL },
        steps: [
          { id: "git.commit", label: "Commit", detail: "Flow — notices" },
          { id: "git.create-pr", label: "Open a PR", detail: PR_URL },
        ],
      },
    ]);
  });

  it("PR этапа мёрджа берётся из строки «Открыть PR» прошлого этапа, без похода к хосту", async () => {
    const land = flowStage("land", "Merge", ["git.merge"]);
    const { published, lookedUp, publish: send } = ports({
      progressRecord: record({ publish: { run: run([{ id: "git.create-pr", label: "Open a PR", detail: PR_URL }]) }, land: { run: run([{ id: "git.merge", label: "Merge the PR" }]) } }),
    });
    await send({ kind: "done", threadId: THREAD, stage: land });
    expect(published[0]?.pr).toEqual({ number: 541, url: PR_URL });
    expect(lookedUp).toEqual([]);
  });

  it("нет ссылки в прогоне — PR спрашивается у окружения треда", async () => {
    const land = flowStage("land", "Merge", ["git.merge"]);
    const { published, lookedUp, publish: send } = ports({
      progressRecord: record({ land: { run: run([{ id: "git.merge", label: "Merge the PR" }]) } }),
      pullRequest: async (environmentId) => {
        lookedUp.push(environmentId);
        return { number: 7, url: "https://github.com/o/r/pull/7" };
      },
    });
    await send({ kind: "done", threadId: THREAD, stage: land });
    expect(lookedUp).toEqual(["env_1"]);
    expect(published[0]?.pr).toEqual({ number: 7, url: "https://github.com/o/r/pull/7" });
  });

  it("этап без шагов PR идёт без PR, даже если прогон его открывал", async () => {
    const tidy = flowStage("tidy", "Archive", ["bb.archive"]);
    const { published, publish: send } = ports({
      progressRecord: record({ publish: { run: run([{ id: "git.create-pr", label: "Open a PR", detail: PR_URL }]) }, tidy: { run: run([{ id: "bb.archive", label: "Archive the thread" }]) } }),
    });
    await send({ kind: "done", threadId: THREAD, stage: tidy });
    expect(published[0]?.pr).toBeNull();
  });

  it("упавший шаг публикуется с шагом, ошибкой и сроком автоповтора; тред без названия и flow — null", async () => {
    const land = flowStage("land", "Merge", ["git.merge"]);
    const { published, publish: send } = ports({
      progressRecord: record({ land: { run: { ...run([{ id: "git.merge", label: "Merge the PR" }]), at: 0, error: "busy" } } }),
      thread: async () => ({ title: null, environmentId: null }),
      flow: () => null,
    });
    await send({ kind: "failed", threadId: THREAD, stage: land, stepId: "git.merge", error: "busy", retryAt: "2026-09-27T10:05:00.000Z" });
    expect(published[0]).toMatchObject({ kind: "failed", threadTitle: null, flowId: null, stepId: "git.merge", error: "busy", retryAt: "2026-09-27T10:05:00.000Z", pr: null });
  });

  it("тред не прочитался — уведомление всё равно уходит, с id треда вместо названия", async () => {
    const tidy = flowStage("tidy", "Archive", ["bb.archive"]);
    const { published, publish: send } = ports({
      thread: async () => {
        throw new Error("thread is gone");
      },
    });
    await send({ kind: "done", threadId: THREAD, stage: tidy });
    expect(published[0]).toMatchObject({ threadTitle: null, steps: [] });
  });
});

describe("PR уведомления берётся только из строк шагов PR", () => {
  it("ссылка на чужой PR в выводе скрипта не выигрывает у ссылки шага «Открыть PR»", async () => {
    const land = flowStage("land", "Merge", ["git.merge"]);
    const { published, publish: send } = ports({
      progressRecord: record({
        check: { run: run([{ id: "script:s1", label: "check.sh", detail: "see https://github.com/other/repo/pull/1" }]) },
        publish: { run: run([{ id: "git.create-pr", label: "Open a PR", detail: PR_URL }]) },
        land: { run: run([{ id: "git.merge", label: "Merge the PR" }]) },
      }),
    });
    await send({ kind: "done", threadId: THREAD, stage: land });
    expect(published[0]?.pr).toEqual({ number: 541, url: PR_URL });
  });
});
