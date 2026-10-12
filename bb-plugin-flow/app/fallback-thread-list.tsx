// Запасной список тредов в левой панели: простой перечень на случай, когда встроенный список bb не подключился или упал.
// Без закреплений и разделов — это страховка от новой версии bb, а не замена списка.
import { useMemo } from "react";
import { experimental_useSidebarThreads, useBbNavigate, type PluginSidebarThread, type PluginThreadListProps } from "@get-bb/plugin-sdk/app";

import { cn } from "../lib/utils";
import { LocaleProvider } from "./locale";
import { useMessages } from "./locale-context";

const ROW = "flex h-7 w-full min-w-0 items-center rounded-md px-2.5 text-left text-[13px] text-muted-foreground hover:bg-state-hover hover:text-foreground";
const ACTIVE_ROW = "bg-state-active font-medium text-foreground";

const rootThreads = (threads: readonly PluginSidebarThread[]): PluginSidebarThread[] =>
  threads.filter((thread) => thread.parentThreadId === null && !thread.isArchived).sort((a, b) => b.updatedAt - a.updatedAt);

function Threads({ activeThreadId, onNavigate }: Pick<PluginThreadListProps, "activeThreadId" | "onNavigate">) {
  const t = useMessages().threadsFallback;
  const navigate = useBbNavigate();
  const { status, threads } = experimental_useSidebarThreads();
  const rows = useMemo(() => rootThreads(threads), [threads]);
  return (
    <nav aria-label={t.list} className="h-full overflow-y-auto px-2 py-2">
      {status === "error" && <p className="px-2.5 text-[13px] text-muted-foreground">{t.error}</p>}
      {status === "ready" && rows.length === 0 && <p className="px-2.5 text-[13px] text-muted-foreground">{t.empty}</p>}
      {rows.map((thread) => (
        <button
          key={thread.id}
          type="button"
          aria-current={thread.id === activeThreadId ? "page" : undefined}
          className={cn(ROW, thread.id === activeThreadId && ACTIVE_ROW)}
          onClick={() => {
            navigate.toThread(thread.id);
            onNavigate();
          }}
        >
          <span className="truncate">{thread.title ?? thread.titleFallback ?? t.untitled}</span>
        </button>
      ))}
    </nav>
  );
}

export const FallbackThreadList = (props: Pick<PluginThreadListProps, "activeThreadId" | "onNavigate">) => (
  <LocaleProvider>
    <Threads {...props} />
  </LocaleProvider>
);
