/**
 * Counts one more membership of `id` — a window may mount a plugin's overlay
 * twice. The returned leave is idempotent and calls `onLastLeave` once the
 * last member of any id is gone.
 */
export function joinCounted(members: Map<string, number>, id: string, onLastLeave: () => void): () => void {
  members.set(id, (members.get(id) ?? 0) + 1);
  let joined = true;
  return () => {
    if (!joined) return;
    joined = false;
    const remaining = (members.get(id) ?? 1) - 1;
    if (remaining > 0) members.set(id, remaining);
    else members.delete(id);
    if (members.size === 0) onLastLeave();
  };
}
