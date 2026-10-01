// @vitest-environment node
import { describe, expect, it } from "vitest";
import { EMPTY_FILTERS, type ListFilterState } from "./filter-state.js";
import { EMPTY_SEED, newTaskSeed } from "./new-task-seed.js";

const PROJECT = "01HZZZZZZZZZZZZZZZZZZZZZP1";
const PARENT = `${PROJECT}:flow`;

const filters = (patch: Partial<ListFilterState>): ListFilterState => ({ ...EMPTY_FILTERS, ...patch });

describe("newTaskSeed and the parent filter", () => {
  it("opens a draft with no parent in the list's project when nothing is filtered", () => {
    expect(newTaskSeed(PROJECT, filters({}))).toEqual({ ...EMPTY_SEED, projectId: PROJECT });
    expect(EMPTY_SEED.parentTaskId).toBeNull();
  });

  it("puts a draft made in a parent-filtered list under the first picked parent", () => {
    const seed = newTaskSeed(PROJECT, filters({ parents: [PARENT, `${PROJECT}:other`] }));
    expect(seed).toMatchObject({ parentTaskId: PARENT, assignee: null });
  });

  it("opens a draft in All tasks in the picked parent's own project, so the parent can hold it", () => {
    expect(newTaskSeed(null, filters({ parents: [PARENT] }))).toMatchObject({ projectId: PROJECT, parentTaskId: PARENT });
  });
});
