// Layer: shell. The strip above all tasks narrowed to one thread: which
// thread, and the way back to every task.
import { experimental_useSidebarThreads } from "@get-bb/plugin-sdk/app";
import { Button } from "@/components/ui/button";

export function ThreadNarrowing({ threadId, onShowAll }: { threadId: string; onShowAll: () => void }) {
  const thread = experimental_useSidebarThreads().threads.find((entry) => entry.id === threadId);
  const title = thread?.title ?? thread?.titleFallback ?? null;
  return (
    <div className="flex items-center gap-2 border-b border-border-hairline px-4 py-2 text-sm text-muted-foreground">
      <span className="min-w-0 truncate">{title === null ? "Only tasks of this thread" : `Only tasks of “${title}”`}</span>
      <Button variant="ghost" size="sm" onClick={onShowAll}>
        Show all tasks
      </Button>
    </div>
  );
}
