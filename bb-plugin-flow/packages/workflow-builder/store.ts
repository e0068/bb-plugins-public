// store.ts — the editor's state for one open workflow. A factory, not a module singleton: Claude Config
// keeps one for the life of its panel (edits survive leaving it), while Flow's file opener makes one per
// opened tab, so two workflows open side by side never share a tree. Components reach their store through
// EditorStoreContext (react/context.tsx).
//
// The snapshot object is replaced wholesale on every edit so useSyncExternalStore sees a new reference
// and re-renders; getSnapshot returns a stable reference between edits.
import { blankTree, type Engine, type Tree, type Unrecognized } from "./model";

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
  // Why the open file has no tree — set together with rawSource, null in tree-editing mode.
  reason: Unrecognized | null;
  // A new workflow the user started and hasn't saved. Together with identity
  // this tells the panel's three states apart: a file is open (identity set),
  // a new one is being written (draft, no identity), or nothing is open at
  // all (neither) — which is what the builder shows on a fresh start, and
  // what keeps the list from highlighting a row for a workflow that isn't
  // there.
  draft: boolean;
  previewEngine: Engine; // which engine the code tab renders (defaults to bb, this IDE's own)
  version: number;
}

export type EditorStore = ReturnType<typeof createEditorStore>;

export function createEditorStore() {
  let snapshot: EditorSnapshot = {
    tree: blankTree("workflow"),
    identity: null,
    rawSource: null,
    reason: null,
    draft: false,
    previewEngine: "bb",
    version: 0,
  };
  const listeners = new Set<() => void>();

  function emit(next: EditorSnapshot): void {
    snapshot = next;
    for (const l of listeners) l();
  }

  const store = {
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
      store.update((t) => {
        t.name = name;
      });
    },
    setDescription(description: string): void {
      store.update((t) => {
        t.description = description;
      });
    },
    // The code of a file the builder can't read as a tree, edited as text — only while such a file is open.
    setRawSource(rawSource: string): void {
      if (snapshot.rawSource === null) return;
      emit({ ...snapshot, rawSource, version: snapshot.version + 1 });
    },
    setPreviewEngine(previewEngine: Engine): void {
      emit({ ...snapshot, previewEngine, version: snapshot.version + 1 });
    },
    // Load an existing workflow (parsed tree + identity) or start fresh. Loading follows the file's store
    // so the preview matches the engine it will save back to.
    // Pass rawSource (non-null) for a file the builder can't read as a tree → read-only code mode, with
    // the reason it was not recognized.
    load(tree: Tree, identity: Identity | null, rawSource: string | null = null, reason: Unrecognized | null = null): void {
      const previewEngine: Engine = identity?.store === "global" ? "claude" : "bb";
      emit({ tree, identity, rawSource, reason: rawSource === null ? null : reason ?? "hand-written", draft: false, previewEngine, version: snapshot.version + 1 });
    },
    newWorkflow(): void {
      emit({ tree: blankTree("workflow"), identity: null, rawSource: null, reason: null, draft: true, previewEngine: "bb", version: snapshot.version + 1 });
    },
  };
  return store;
}
