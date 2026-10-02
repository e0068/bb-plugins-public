import { describe, expect, it } from "vitest";

import { aTask, PROJECT_A, PROJECT_B } from "../test-support/analytics-tasks.js";
import { factsOf } from "./task-fields.js";
import { CONDITION_OPS, conditionsFromFilters, matchesConditions, type TileCondition } from "./tile-conditions.js";

const facts = factsOf({
  projectNames: new Map([
    [PROJECT_A, "Shader Lab"],
    [PROJECT_B, "bb-plugins"],
  ]),
  labelNames: new Map([
    ["L1", "ui"],
    ["L2", "backend"],
  ]),
});

const when = (field: TileCondition["field"], op: TileCondition["op"], value: string): TileCondition => ({ field, op, value });
const passes = (conditions: readonly TileCondition[], patch: Parameters<typeof aTask>[1]) => matchesConditions(aTask(1, patch), conditions, facts);

describe("matchesConditions", () => {
  it("offers exactly the four operators the owner asked for", () => {
    expect(CONDITION_OPS).toEqual(["eq", "ne", "gt", "lt"]);
  });

  it("lets every task through when there are no conditions", () => {
    expect(passes([], {})).toBe(true);
  });

  it("ignores a row whose value is still empty", () => {
    expect(passes([when("status", "eq", "  ")], { status: "done" })).toBe(true);
  });

  it("compares statuses by their order for > and <", () => {
    expect(passes([when("status", "gt", "todo")], { status: "in_review" })).toBe(true);
    expect(passes([when("status", "gt", "todo")], { status: "backlog" })).toBe(false);
    expect(passes([when("status", "lt", "done")], { status: "in_progress" })).toBe(true);
    expect(passes([when("status", "lt", "done")], { status: "done" })).toBe(false);
  });

  it("joins = rows of one field with or, and everything else with and", () => {
    const openish = [when("status", "eq", "todo"), when("status", "eq", "in_progress")];
    expect(passes(openish, { status: "in_progress" })).toBe(true);
    expect(passes(openish, { status: "done" })).toBe(false);
    expect(passes([...openish, when("cost", "gt", "5")], { status: "todo", cost: 3 })).toBe(false);
    expect(passes([when("status", "ne", "done"), when("status", "ne", "canceled")], { status: "canceled" })).toBe(false);
  });

  it("compares numbers as numbers, and an empty number matches only ≠", () => {
    expect(passes([when("cost", "gt", "9")], { cost: 10 })).toBe(true);
    expect(passes([when("cost", "lt", "9")], { cost: 10 })).toBe(false);
    expect(passes([when("cost", "eq", "10")], { cost: 10 })).toBe(true);
    expect(passes([when("cost", "gt", "0")], { cost: null })).toBe(false);
    expect(passes([when("cost", "ne", "4")], { cost: null })).toBe(true);
  });

  it("compares a date by the day the value names, or by the minute when it names one", () => {
    expect(passes([when("dueDate", "eq", "2026-10-02")], { dueDate: "2026-10-02T15:00" })).toBe(true);
    expect(passes([when("dueDate", "gt", "2026-10-02T12:00")], { dueDate: "2026-10-02T15:00" })).toBe(true);
    expect(passes([when("dueDate", "lt", "2026-10-02")], { dueDate: "2026-10-01" })).toBe(true);
    expect(passes([when("createdAt", "gt", "2026-09-30")], {})).toBe(true);
    expect(passes([when("dueDate", "gt", "2026-01-01")], { dueDate: null })).toBe(false);
  });

  it("reads text as contains and does-not-contain, case aside", () => {
    expect(passes([when("title", "eq", "mail")], { title: "Mail — inbox" })).toBe(true);
    expect(passes([when("title", "ne", "MAIL")], { title: "Mail — inbox" })).toBe(false);
    expect(passes([when("title", "ne", "drafts")], { title: "Mail — inbox" })).toBe(true);
  });

  it("matches labels by name: = any of them, ≠ none of them", () => {
    expect(passes([when("labels", "eq", "UI")], { labelIds: ["L1", "L2"] })).toBe(true);
    expect(passes([when("labels", "ne", "backend")], { labelIds: ["L1", "L2"] })).toBe(false);
    expect(passes([when("labels", "ne", "backend")], { labelIds: [] })).toBe(true);
  });

  it("matches a project by its name", () => {
    expect(passes([when("project", "eq", "bb-plugins")], { projectId: PROJECT_B })).toBe(true);
    expect(passes([when("project", "eq", "bb-plugins")], { projectId: PROJECT_A })).toBe(false);
  });

  it("orders other text alphabetically for > and <", () => {
    expect(passes([when("assignee", "gt", "b")], { assignee: "claude" })).toBe(true);
    expect(passes([when("assignee", "lt", "b")], { assignee: "claude" })).toBe(false);
  });
});

describe("conditionsFromFilters", () => {
  it("turns a board filter's picked values into = rows and drops the rest", () => {
    expect(
      conditionsFromFilters({
        statuses: ["todo", "in_progress"],
        priorities: ["high"],
        types: [],
        estimates: ["m"],
        labelNames: ["ui"],
        assignees: ["claude"],
        parents: ["01HZZZZZZZZZZZZZZZZZZZZT01"],
        texts: { title: "mail" },
      }),
    ).toEqual([
      when("status", "eq", "todo"),
      when("status", "eq", "in_progress"),
      when("priority", "eq", "high"),
      when("estimate", "eq", "m"),
      when("labels", "eq", "ui"),
      when("assignee", "eq", "claude"),
    ]);
  });
});
