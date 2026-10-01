import { useState, type SyntheticEvent } from "react";
import { Icon } from "@/components/ui/icon";
import type { Task } from "../../shared/contract.js";
import type { Descendant } from "../../shared/subtree.js";
import { StatusIcon } from "./icons.js";

/** How adding a sub-task ended: the board took it, or said why not. */
export type AddSubtaskOutcome = { readonly ok: true } | { readonly ok: false; readonly message: string };

/** The rows sit inside a draggable card: a press on them neither starts a
 *  drag nor opens the card itself. */
const stayInCard = (event: SyntheticEvent) => event.stopPropagation();

/**
 * Everything under a card, as a tree: each row opens its own task and shows
 * only its status and title — the key or slug would crowd the narrow card.
 * Under the rows stands Add sub-task, so a card with none yet can get its first.
 */
export function SubtaskList({
  descendants,
  onOpen,
  onAdd,
}: {
  descendants: readonly Descendant<Task>[];
  onOpen: (task: Task) => void;
  onAdd: (title: string) => Promise<AddSubtaskOutcome>;
}) {
  return (
    <div className="flex flex-col border-t border-border pt-1.5">
      {descendants.map(({ task, depth }) => (
        <button
          key={task.id}
          type="button"
          aria-label={`Open ${task.key}`}
          title={task.title}
          onPointerDown={stayInCard}
          onClick={(event) => {
            stayInCard(event);
            onOpen(task);
          }}
          className="-mx-1 flex min-w-0 items-center gap-1.5 rounded-sm px-1 py-0.5 text-left text-2xs hover:bg-state-hover"
          style={{ paddingLeft: `${0.25 + (depth - 1) * 0.75}rem` }}
        >
          <StatusIcon status={task.status} className="size-3" />
          <span className="min-w-0 truncate">{task.title}</span>
        </button>
      ))}
      <SubtaskAdder onAdd={onAdd} />
    </div>
  );
}

/**
 * The card's counterpart of Add sub-task on the task page: Enter adds the
 * title as a sub-task and empties the field for the next at once, so a title
 * typed while the one before is saved is not lost; Escape closes it. A refused
 * title comes back into the field, unless the next is already typed there,
 * with the board's reason under it until the title is edited.
 */
function SubtaskAdder({ onAdd }: { onAdd: (title: string) => Promise<AddSubtaskOutcome> }) {
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    setAdding(false);
    setTitle("");
    setError(null);
  };

  const submit = () => {
    const trimmed = title.trim();
    if (!trimmed) return;
    setTitle("");
    setError(null);
    void onAdd(trimmed).then((outcome) => {
      if (outcome.ok) return;
      setAdding(true);
      setTitle((current) => (current === "" ? trimmed : current));
      setError(outcome.message);
    });
  };

  return (
    <div className="flex flex-col" onPointerDown={stayInCard} onClick={stayInCard}>
      {adding ? (
        <div className="-mx-1 flex min-w-0 items-center gap-1.5 px-1 py-0.5">
          <StatusIcon status="todo" className="size-3 opacity-60" />
          <input
            autoFocus
            value={title}
            aria-label="Sub-task title"
            placeholder="Sub-task title…"
            className="min-w-0 flex-1 bg-transparent text-2xs outline-none select-text placeholder:text-muted-foreground"
            onChange={(event) => {
              setTitle(event.target.value);
              setError(null);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") submit();
              if (event.key === "Escape") close();
            }}
            onBlur={() => {
              if (!title.trim()) close();
            }}
          />
        </div>
      ) : null}
      {error !== null ? <p className="text-2xs text-destructive">{error}</p> : null}
      <button
        type="button"
        className="-mx-1 flex items-center gap-1.5 rounded-sm px-1 py-0.5 text-left text-2xs font-medium text-muted-foreground hover:text-foreground"
        onClick={() => setAdding(true)}
      >
        <Icon name="Plus" className="size-3" />
        Add sub-task
      </button>
    </div>
  );
}
