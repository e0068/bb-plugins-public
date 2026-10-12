// history.js — editor-LOCAL undo/redo over the markdown value (not app state).
// Typing coalesces into one undo point per burst; structural ops (table edits, inserts) record one point each.
// `get` returns the current markdown value; `set` restores a value (the editor re-renders + fires onChange).

export function createHistory(get, set) {
  const undo = [], redo = [];
  let burst = null;                                   // timer id while a typing burst is open
  const MAX = 300;

  function pushPre() {
    const v = get();
    if (undo.length && undo[undo.length - 1] === v) return;   // no-op change
    undo.push(v); redo.length = 0;
    if (undo.length > MAX) undo.shift();
  }

  return {
    recordInput() {                                   // called on beforeinput — one pre-state per burst
      if (burst) { clearTimeout(burst); burst = setTimeout(() => { burst = null; }, 500); return; }
      pushPre();
      burst = setTimeout(() => { burst = null; }, 500);
    },
    batch(fn) {                                       // structural op: record pre-state once, then run
      if (burst) { clearTimeout(burst); burst = null; }
      pushPre();
      return fn && fn();
    },
    undo() {
      if (!undo.length) return false;
      if (burst) { clearTimeout(burst); burst = null; }
      redo.push(get()); set(undo.pop()); return true;
    },
    redo() {
      if (!redo.length) return false;
      undo.push(get()); set(redo.pop()); return true;
    },
    get canUndo() { return undo.length > 0; },
    get canRedo() { return redo.length > 0; },
  };
}
