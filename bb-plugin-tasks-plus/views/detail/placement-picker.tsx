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
 * One folder name out of those in use, or a new one typed into the search:
 * a task's assignee, or its epic inside the assignee's folder. Knows nothing
 * of the task itself, so the card and the new-task dialog share it. Values
 * are asked for on open — the folders change with every move, and a closed
 * menu needs none of them. The epic picker stays disabled without an
 * assignee: there is no folder for it to live in.
 */
export function PlacementPicker({
  projectId,
  field,
  value,
  assignee,
  onSelect,
  triggerClassName,
}: {
  projectId: string | null;
  field: "assignee" | "epic";
  value: string | null;
  /** The assignee the epics are listed for; ignored by the assignee picker. */
  assignee: string | null;
  onSelect: (next: string | null) => void;
  triggerClassName: string;
}) {
  const rpc = useTasksRpc();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [values, setValues] = useState<string[]>([]);
  const noun = field === "assignee" ? "Assignee" : "Epic";
  const disabled = projectId === null || (field === "epic" && assignee === null);

  const openChange = (next: boolean) => {
    setOpen(next);
    if (!next) {
      setQuery("");
      return;
    }
    if (projectId === null) return;
    void rpc.call("listPlacements", { projectId }).then(
      (placements) =>
        setValues(
          field === "assignee"
            ? placements.assignees
            : placements.epics.filter((epic) => epic.assignee === assignee).map((epic) => epic.name),
        ),
      () => setValues([]),
    );
  };
  const select = (next: string | null) => {
    setOpen(false);
    setQuery("");
    if (next !== value) onSelect(next);
  };

  const typed = query.trim();
  const canCreate = typed !== "" && !values.includes(typed);
  return (
    <Popover open={open} onOpenChange={openChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Edit ${field}`}
          disabled={disabled}
          className={cn(triggerClassName, "disabled:opacity-50")}
        >
          <Icon name={field === "assignee" ? "UserRound" : "Layers"} className="size-3.5" />
          {value ?? `No ${field}`}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-0" align="start">
        <Command>
          <CommandInput placeholder={`${noun}…`} value={query} onValueChange={setQuery} />
          <CommandList>
            <CommandGroup>
              <CommandItem value={`No ${field}`} onSelect={() => select(null)}>
                <span className="flex-1">No {field}</span>
                {value === null ? <Icon name="Check" className="size-3.5" /> : null}
              </CommandItem>
              {values.map((name) => (
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
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
