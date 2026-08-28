// store.ts — the editor's shared state, module-level so the navPanel body (tree editor) and the
// code-preview fixed tab render from ONE tree without threading React context across two host-mounted
// components. A single panel instance per window edits at a time; concurrent windows would share this
// singleton (a known v1 limitation — the constructor is a single-editor surface).
//
// The snapshot object is replaced wholesale on every edit so useSyncExternalStore sees a new reference
// and re-renders; getSnapshot returns a stable reference between edits.
import { blankTree, type Engine, type Tree } from "./workflow-model";

export type StoreKind = "project" | "global";

// A store maps 1:1 to a target engine: project → bb, global → Claude Code.
export function engineForStore(store: StoreKind): Engine {
  return store === "project" ? "bb" : "claude";
}

export interface Identity {
  store: StoreKind;
  path: string;
  name: string;
}

// Miller-column drill path. [] = only the workflow column; [p] = phase p open; [p, s, …] = step s inside
// phase p open, descending through nested containers. The last index may point at an agent (terminal,
// its detail column) or a container (its steps become the next column).
export type Selection = number[];

export interface EditorSnapshot {
  tree: Tree;
  identity: Identity | null; // the open file, or null for an unsaved new workflow
  // The raw file text when the open workflow has NO composer tree (hand-written .js). In this mode the
  // tree editor can't faithfully represent the file, so the panel shows this source read-only and
  // refuses to save — saving would compile a placeholder tree over the author's real code. null in the
  // normal tree-editing mode.
  rawSource: string | null;
  previewEngine: Engine; // which engine the code tab renders (defaults to bb, this IDE's own)
  selection: Selection;
  version: number;
}

let snapshot: EditorSnapshot = {
  tree: blankTree("workflow"),
  identity: null,
  rawSource: null,
  previewEngine: "bb",
  selection: [],
  version: 0,
};
const listeners = new Set<() => void>();

function emit(next: EditorSnapshot): void {
  snapshot = next;
  for (const l of listeners) l();
}

export const editorStore = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  getSnapshot(): EditorSnapshot {
    return snapshot;
  },
  // Replace the tree via a mutator run against a deep clone (keeps edits immutable at the snapshot level).
  update(mutator: (draft: Tree) => void): void {
    const draft = structuredClone(snapshot.tree);
    mutator(draft);
    emit({ ...snapshot, tree: draft, version: snapshot.version + 1 });
  },
  setName(name: string): void {
    editorStore.update((t) => {
      t.name = name;
    });
  },
  setDescription(description: string): void {
    editorStore.update((t) => {
      t.description = description;
    });
  },
  setPreviewEngine(previewEngine: Engine): void {
    emit({ ...snapshot, previewEngine, version: snapshot.version + 1 });
  },
  // Set the Miller-column drill path.
  select(selection: Selection): void {
    emit({ ...snapshot, selection, version: snapshot.version + 1 });
  },
  // Load an existing workflow (parsed tree + identity) or start fresh. Loading follows the file's store
  // so the preview matches the engine it will save back to. Selection resets to the workflow column.
  // Pass rawSource (non-null) for a hand-written file with no composer tree → read-only code mode.
  load(tree: Tree, identity: Identity | null, rawSource: string | null = null): void {
    const previewEngine: Engine = identity?.store === "global" ? "claude" : "bb";
    emit({ tree, identity, rawSource, previewEngine, selection: [], version: snapshot.version + 1 });
  },
  newWorkflow(): void {
    emit({ tree: blankTree("workflow"), identity: null, rawSource: null, previewEngine: "bb", selection: [], version: snapshot.version + 1 });
  },
};
