import { describe, expect, it } from "vitest";

import { bumpOutcome, reinstallOutcome } from "./step-outcomes";

const bump = (over: Partial<Parameters<typeof bumpOutcome>[0]> = {}) => ({
  bumped: [],
  problems: [],
  unavailable: null,
  ...over,
});

const reinstall = (over: Partial<Parameters<typeof reinstallOutcome>[0]> = {}) => ({
  reinstalled: [],
  installed: [],
  repoints: [],
  problems: [],
  pendingSelfUpdate: null,
  unavailable: null,
  ...over,
});

describe("bumpOutcome", () => {
  it("raised versions are listed root by root", () => {
    expect(bumpOutcome(bump({ bumped: [{ root: "bb-plugin-flow", to: "0.3.0" }, { root: "packages/x", to: "1.0.0" }] }))).toEqual({
      ok: true,
      detail: "bb-plugin-flow → 0.3.0, packages/x → 1.0.0",
    });
  });

  it("nothing to raise is a success, not a failure: the branch is already ahead", () => {
    expect(bumpOutcome(bump())).toEqual({ ok: true, detail: "nothing to raise" });
  });

  it("an unreachable pull request fails the step with the reason", () => {
    expect(bumpOutcome(bump({ unavailable: "bb reports no pull request for this branch", problems: ["versions not settled: bb reports no pull request for this branch"] }))).toEqual({
      ok: false,
      error: "Versions not raised: bb reports no pull request for this branch",
    });
  });

  it("a root that could not be raised fails the step and names it", () => {
    expect(bumpOutcome(bump({ problems: ["bb-plugin-x: no readable version on the branch"] }))).toEqual({
      ok: false,
      error: "Versions not raised: bb-plugin-x: no readable version on the branch",
    });
  });
});

describe("reinstallOutcome", () => {
  it("updated and freshly installed plugins are listed", () => {
    expect(reinstallOutcome(reinstall({ reinstalled: ["tasks-plus"], installed: ["decisions"] }))).toEqual({
      ok: true,
      detail: "updated tasks-plus, installed decisions",
    });
  });

  it("a merge touching no plugin is a success with nothing to say", () => {
    expect(reinstallOutcome(reinstall())).toEqual({ ok: true, detail: "no plugin of this repository was touched" });
  });

  it("the plugin running the chain is named as deferred, not as done", () => {
    expect(reinstallOutcome(reinstall({ reinstalled: ["tasks-plus"], pendingSelfUpdate: "flow" }))).toEqual({
      ok: true,
      detail: "updated tasks-plus, flow updates itself after the run",
    });
  });

  it("a plugin held from another source fails the step and names the source", () => {
    expect(
      reinstallOutcome(
        reinstall({ repoints: [{ pluginId: "flow", from: "path:/Users/e0068/bb-plugin-flow" }] }),
      ),
    ).toEqual({
      ok: false,
      error:
        'Plugins not updated: "flow" is installed from path:/Users/e0068/bb-plugin-flow — update it by hand with bb plugin remove and bb plugin install',
    });
  });

  it("a refused update fails the step with the host's own words", () => {
    expect(reinstallOutcome(reinstall({ problems: ['"flow" from git:…@main: pinned'] }))).toEqual({
      ok: false,
      error: 'Plugins not updated: "flow" from git:…@main: pinned',
    });
  });

  it("an unreachable pull request fails the step with the reason", () => {
    expect(reinstallOutcome(reinstall({ unavailable: "bb reports no pull request for this branch" }))).toEqual({
      ok: false,
      error: "Plugins not updated: bb reports no pull request for this branch",
    });
  });
});

describe("bumpOutcome — пробелы, а не поломки", () => {
  it("PR ещё не открыт: успех, который говорит, когда поднимется версия", () => {
    expect(
      bumpOutcome(bump({ gap: "no-pull-request", unavailable: "bb reports no pull request for this branch", problems: ["versions not settled: bb reports no pull request for this branch"] })),
    ).toEqual({ ok: true, detail: "no pull request yet — versions are raised by the bump step before the merge" });
  });

  it("ветки нет на origin: тоже успех с названной причиной", () => {
    expect(bumpOutcome(bump({ gap: "branch-not-published", problems: ["could not compare bb/thr with main (HTTP 404)"] }))).toEqual({
      ok: true,
      detail: "the branch is not on origin yet — versions are raised by the bump step before the merge",
    });
  });
});
