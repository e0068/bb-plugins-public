// The editor store a builder renders from. Each consumer creates its own (createEditorStore) and puts it
// here, so two builders on one page — two tabs of Flow's file opener — never edit the same tree.
import { createContext, useContext, useSyncExternalStore } from "react";
import type { EditorSnapshot, EditorStore } from "../store";

export const EditorStoreContext = createContext<EditorStore | null>(null);

export function useEditorStore(): EditorStore {
  const store = useContext(EditorStoreContext);
  if (store === null) throw new Error("useEditorStore: render inside <EditorStoreContext.Provider value={createEditorStore()}>");
  return store;
}

export function useEditorSnapshot(): EditorSnapshot {
  const store = useEditorStore();
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}
