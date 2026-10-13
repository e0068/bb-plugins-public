import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

/** The row under a table's rows that adds one: its own accessible name, as the topbar's New task button keeps
 *  "New task" to itself; a section's says New record and spins while the record is made. */
export function NewTaskRow({ label, text = "New task", busy = false, onOpen }: { label: string; text?: string; busy?: boolean; onOpen: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={busy}
      onClick={onOpen}
      className="flex h-[34px] w-full items-center border-b border-border-hairline text-left text-sm text-subtle-foreground hover:bg-state-hover hover:text-foreground"
    >
      {/* Stays at the leading edge while the table scrolls sideways. */}
      <span className="sticky left-0 flex items-center gap-1.5 px-3.5">
        <Icon name={busy ? "Loading" : "Plus"} className={cn("size-3.5", busy && "animate-spin")} />
        {text}
      </span>
    </button>
  );
}
