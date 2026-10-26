// Карточка чек-листа в ленте — под ответом Утверждения, которое владелец отправил с комментариями к виджетам. Пункт на комментарий:
// где оставлен и что сказано; агент отмечает выполненные инструментом, и карточка перечитывается тем же событием, что и бриф.
import { Icon } from "../components/ui/icon";
import { cn } from "../lib/utils";
import type { ChecklistItem } from "../shared/contract";
import { useMessages } from "./locale-context";

export function ChecklistCard({ items }: { items: readonly ChecklistItem[] }) {
  const t = useMessages();
  const done = items.filter((item) => item.done).length;
  const all = done === items.length;
  return (
    <div role="group" aria-label={t.outcome.checklist(done, items.length)} data-checklist className="my-3 flex flex-col gap-1.5 rounded-lg border border-border bg-card px-3 py-2.5 text-sm">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {all ? <Icon name="CircleCheck" className="size-3.5" /> : <Icon name="Spinner" className="size-3.5 animate-spin" />}
        <span>{t.outcome.checklist(done, items.length)}</span>
      </div>
      {items.map((item) => (
        <div key={item.id} data-checklist-item={item.id} data-done={item.done} className="flex items-start gap-2">
          <span aria-hidden="true" className={cn("mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border border-border", item.done && "bg-foreground text-background")}>
            {item.done && <Icon name="Check" className="size-3" />}
          </span>
          <span className={cn("min-w-0 break-words", item.done && "text-muted-foreground")}>
            <span className="text-muted-foreground">{item.where}:</span> {item.text}
          </span>
        </div>
      ))}
    </div>
  );
}
