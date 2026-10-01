import { useState } from "react";
import { useTasksRpc } from "../../client/data.js";
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

/**
 * One assignee out of the folders in use on the board, or a new one typed
 * into the search. Knows nothing of the task itself, so the card and the
 * new-task dialog share it. Values are asked for on open — the folders change
 * with every move, and a closed menu needs none of them.
 */
export function AssigneePicker({
  projectId,
  value,
  onSelect,
  triggerClassName,
}: {
  projectId: string | null;
  value: string | null;
  onSelect: (next: string | null) => void;
  triggerClassName: string;
}) {
  const rpc = useTasksRpc();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [assignees, setAssignees] = useState<string[]>([]);

  const openChange = (next: boolean) => {
    setOpen(next);
    setQuery("");
    if (!next || projectId === null) return;
    void rpc.call("listPlacements", { projectId }).then(
      (folders) => setAssignees(folders.assignees),
      () => setAssignees([]),
    );
  };
  const select = (next: string | null) => {
    setOpen(false);
    setQuery("");
    if (next !== value) onSelect(next);
  };
  const typed = query.trim();
  const canCreate = typed !== "" && !assignees.includes(typed);

  return (
    <Popover open={open} onOpenChange={openChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Edit assignee"
          disabled={projectId === null}
          className={cn(triggerClassName, "disabled:opacity-50")}
        >
          <Icon name="UserRound" className="size-3.5" />
          {value ?? "No assignee"}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-0" align="start">
        <Command>
          <CommandInput placeholder="Assignee…" value={query} onValueChange={setQuery} />
          <CommandList>
            <CommandGroup>
              <CommandItem value="No assignee" onSelect={() => select(null)}>
                <span className="flex-1">No assignee</span>
                {value === null ? <Icon name="Check" className="size-3.5" /> : null}
              </CommandItem>
              {assignees.map((name) => (
                <CommandItem key={name} value={name} onSelect={() => select(name)}>
                  <span className="flex-1">{name}</span>
                  {name === value ? <Icon name="Check" className="size-3.5" /> : null}
                </CommandItem>
              ))}
              {canCreate ? (
                <CommandItem value={`Create ${typed}`} onSelect={() => select(typed)}>
                  <Icon name="Plus" className="size-3.5" />
                  Create “{typed}”
                </CommandItem>
              ) : null}
            </CommandGroup>
            {typed === "" ? (
              // Creating is only reachable by typing, so an empty board has to say so.
              <p className="px-3 py-2 text-xs text-muted-foreground">Type a name to create a new assignee</p>
            ) : null}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
