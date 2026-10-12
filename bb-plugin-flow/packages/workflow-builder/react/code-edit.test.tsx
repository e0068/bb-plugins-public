// @vitest-environment jsdom
// A file the builder can't read as a tree: read-only code by default (Claude Config), editable code when the consumer asks
// for it (Flow) — the edit lands in the store, where the consumer's Save takes it.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { blankTree } from "../model";
import { createEditorStore } from "../store";
import { EditorStoreContext } from "./context";
import { WorkflowEditor } from "./workflow-editor";

afterEach(cleanup);

const file = { store: "global" as const, path: "/home/u/.claude/workflows/lead-waves.js", name: "lead-waves" };

const show = (editableCode: boolean) => {
  const store = createEditorStore();
  store.load(blankTree("lead-waves"), file, "const MAX_ROUNDS = 5", "edited");
  render(
    <EditorStoreContext.Provider value={store}>
      <WorkflowEditor agents={[]} providerCatalog={[]} previewEngine="claude" columns="all" selectedPath={null} onSelect={() => {}} storageKey="t" editableCode={editableCode} />
    </EditorStoreContext.Provider>,
  );
  return store;
};

describe("code of an unrecognized workflow", () => {
  it("is read-only unless the consumer makes it editable", () => {
    show(false);
    expect(screen.getByLabelText("workflow source").tagName).toBe("PRE");
  });

  it("edited by hand lands in the store with a new version", () => {
    const store = show(true);
    const before = store.getSnapshot().version;
    fireEvent.change(screen.getByLabelText("workflow source"), { target: { value: "const MAX_ROUNDS = 7" } });
    expect(store.getSnapshot().rawSource).toBe("const MAX_ROUNDS = 7");
    expect(store.getSnapshot().version).toBeGreaterThan(before);
    expect(screen.getByText(/Edited by hand after saving/)).toBeTruthy();
  });
});
