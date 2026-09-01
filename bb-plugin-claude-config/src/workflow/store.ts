// store.ts — the editor's shared state, module-level so the navPanel body (outline editor) and the
// code-preview column render from ONE tree without threading React context across two host-mounted
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

export interface EditorSnapshot {
  tree: Tree;
  identity: Identity | null; // the open file, or null for an unsaved new workflow
  // The raw file text when the open workflow has NO composer tree (hand-written .js). In this mode the
  // outline editor can't faithfully represent the file, so the panel shows this source read-only and
  // refuses to save — saving would compile a placeholder tree over the author's real code. null in the
  // normal tree-editing mode.
  rawSource: string | null;
  previewEngine: Engine; // which engine the code tab renders (defaults to bb, this IDE's own)
  version: number;
}

let snapshot: EditorSnapshot = {
  tree: blankTree("workflow"),
  identity: null,
  rawSource: null,
  previewEngine: "bb",
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
  // Load an existing workflow (parsed tree + identity) or start fresh. Loading follows the file's store
  // so the preview matches the engine it will save back to.
  // Pass rawSource (non-null) for a hand-written file with no composer tree → read-only code mode.
  load(tree: Tree, identity: Identity | null, rawSource: string | null = null): void {
    const previewEngine: Engine = identity?.store === "global" ? "claude" : "bb";
    emit({ tree, identity, rawSource, previewEngine, version: snapshot.version + 1 });
  },
  newWorkflow(): void {
    emit({ tree: blankTree("workflow"), identity: null, rawSource: null, previewEngine: "bb", version: snapshot.version + 1 });
  },
};
