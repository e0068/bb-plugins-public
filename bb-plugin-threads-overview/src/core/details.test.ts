import { describe, expect, it } from "vitest";
import { describeFooter, type FooterInput } from "./details";

const base: FooterInput = {
  projectName: "Альфа",
  branchName: "bb/feature",
  inWorktree: true,
  hostName: "MacBook",
  execution: { model: "claude-opus-5", reasoningLevel: "high", permissionMode: "auto" },
  git: { commitsAhead: 0, uncommitted: false },
  pullRequest: null,
};

const footer = (over: Partial<FooterInput> = {}) => describeFooter({ ...base, ...over });

describe("where the thread runs", () => {
  it("names the project, the branch of its worktree and the machine", () => {
    expect(footer().place).toEqual(["Альфа", "bb/feature", "MacBook"]);
  });

  it("shows no branch for a thread outside a worktree", () => {
    expect(footer({ inWorktree: false }).place).toEqual(["Альфа", "MacBook"]);
  });

  it("shows no branch when the worktree has none yet, and no machine when it is unknown", () => {
    expect(footer({ branchName: null, hostName: null }).place).toEqual(["Альфа"]);
  });
});

describe("how the agent runs", () => {
  it("names the model, its effort and the permission mode", () => {
    expect(footer().execution).toEqual(["claude-opus-5", "усилие высокое", "режим авто"]);
  });

  it.each([
    ["none", "нет"],
    ["low", "низкое"],
    ["medium", "среднее"],
    ["xhigh", "очень высокое"],
    ["max", "максимальное"],
  ])("says effort %s as «%s»", (reasoningLevel, label) => {
    const execution = { ...base.execution!, reasoningLevel };
    expect(footer({ execution }).execution[1]).toBe(`усилие ${label}`);
  });

  it.each([
    ["readonly", "только чтение"],
    ["accept-edits", "правки без подтверждения"],
    ["workspace-write", "запись в рабочей папке"],
    ["full", "полный доступ"],
  ])("says mode %s as «%s»", (permissionMode, label) => {
    const execution = { ...base.execution!, permissionMode };
    expect(footer({ execution }).execution[2]).toBe(`режим ${label}`);
  });

  it("keeps a value the host adds later as it is instead of dropping it", () => {
    const execution = { model: "m", reasoningLevel: "galaxy", permissionMode: "yolo" };
    expect(footer({ execution }).execution).toEqual(["m", "усилие galaxy", "режим yolo"]);
  });

  it("says nothing about the agent while its options are unknown", () => {
    expect(footer({ execution: null }).execution).toEqual([]);
  });
});

describe("what happened to the work", () => {
  it("says there are no commits on a clean branch without a pull request", () => {
    expect(footer().work).toEqual(["коммитов нет"]);
  });

  it("counts the branch's commits and flags uncommitted edits", () => {
    expect(footer({ git: { commitsAhead: 3, uncommitted: true } }).work).toEqual([
      "коммитов: 3",
      "есть незакоммиченные правки",
    ]);
  });

  it.each([
    ["open", "открыт"],
    ["draft", "черновик"],
    ["merged", "смёржен"],
    ["closed", "закрыт"],
  ] as const)("names a %s pull request with its number", (state, label) => {
    const work = footer({ pullRequest: { number: 42, state } }).work;
    expect(work.at(-1)).toBe(`PR #42 ${label}`);
  });

  it("still names the pull request when the workspace status is unavailable", () => {
    expect(footer({ git: null, pullRequest: { number: 7, state: "merged" } }).work).toEqual([
      "PR #7 смёржен",
    ]);
  });

  it("says nothing about the work outside git", () => {
    expect(footer({ git: null }).work).toEqual([]);
  });
});
