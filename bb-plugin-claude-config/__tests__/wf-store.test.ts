import { beforeEach, describe, expect, it } from "vitest";
import { editorStore } from "../src/workflow/store";
import { blankTree } from "../src/workflow/workflow-model";

// What the builder column shows is decided by two fields together: `identity`
// (a file on disk) and `draft` (a new workflow the user started). Neither
// alone tells "nothing is open" from "an unsaved new one" — and the list next
// to it highlights a row from the same answer.

const file = { store: "project" as const, path: "/repo/.bb/workflows/a.js", name: "a" };

beforeEach(() => {
  editorStore.newWorkflow();
  editorStore.load(blankTree("x"), null);
});

describe("editorStore drafts", () => {
  it("loading nothing at all is neither a file nor a draft", () => {
    editorStore.load(blankTree("workflow"), null);
    const snapshot = editorStore.getSnapshot();
    expect(snapshot.identity).toBeNull();
    expect(snapshot.draft).toBe(false);
  });

  it("starting a new workflow is a draft with no file behind it", () => {
    editorStore.newWorkflow();
    const snapshot = editorStore.getSnapshot();
    expect(snapshot.identity).toBeNull();
    expect(snapshot.draft).toBe(true);
  });

  it("opening a file ends the draft", () => {
    editorStore.newWorkflow();
    editorStore.load(blankTree("a"), file);
    const snapshot = editorStore.getSnapshot();
    expect(snapshot.identity).toEqual(file);
    expect(snapshot.draft).toBe(false);
  });

  it("editing a draft keeps it a draft", () => {
    editorStore.newWorkflow();
    editorStore.setDescription("does things");
    const snapshot = editorStore.getSnapshot();
    expect(snapshot.draft).toBe(true);
    expect(snapshot.tree.description).toBe("does things");
  });

  it("editing an open file doesn't turn it into a draft", () => {
    editorStore.load(blankTree("a"), file);
    editorStore.setDescription("does things");
    expect(editorStore.getSnapshot().draft).toBe(false);
  });

  it("every change makes a new snapshot object, so subscribers re-render", () => {
    const before = editorStore.getSnapshot();
    editorStore.newWorkflow();
    expect(editorStore.getSnapshot()).not.toBe(before);
  });
});
