import { useState, type ReactNode } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
// Type-only: the frontend bundle stays clear of the contracts' runtime.
import type { FoldersRpcContract } from "../../folders/contract.js";
import { FIELD_TYPES, fieldProblem, optionProblem, tagsOf, tagsValue, type FieldType, type SectionField } from "../../shared/section-fields.js";
import { Button } from "@/components/ui/button";
import { Icon, type IconName } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/**
 * What a section's field looks like wherever it is drawn — the table's
 * header, the card's Properties — and the form both use to add one: a name
 * and a type, written into the section's database for every machine on it.
 */

export const FIELD_TYPE_ICONS: Record<FieldType, IconName> = {
  text: "AlignLeft",
  number: "NumberSign",
  select: "CircleChevronDown",
  tags: "Tag",
  date: "Calendar",
  checkbox: "CircleCheck",
  url: "Globe",
};

export const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  text: "Text",
  number: "Number",
  select: "Select",
  tags: "Tags",
  date: "Date",
  checkbox: "Checkbox",
  url: "URL",
};

/** The name and type of a new field, and the field's problem or the database's answer once added. */
function AddFieldForm({ sectionId, declared, onAdded }: { sectionId: string; declared: readonly SectionField[]; onAdded: () => void }) {
  const folders = useRpc<FoldersRpcContract>();
  const [name, setName] = useState("");
  const [type, setType] = useState<FieldType>("text");
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    const trimmed = name.trim();
    const found = fieldProblem(declared, trimmed);
    if (found !== null) return setProblem(found);
    setBusy(true);
    const result = await folders
      .call("addSectionField", { boardId: sectionId, name: trimmed, type })
      .catch((error: unknown) => ({ ok: false as const, message: error instanceof Error ? error.message : String(error) }))
      .finally(() => setBusy(false));
    if (!result.ok) return setProblem(result.message);
    onAdded();
  };
  return (
    <form
      aria-label="New property"
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <Input
        aria-label="Property name"
        placeholder="Property name"
        autoFocus
        value={name}
        readOnly={busy}
        onChange={(event) => {
          setName(event.target.value);
          setProblem(null);
        }}
        className="h-8 text-sm"
      />
      <div role="radiogroup" aria-label="Property type" className="flex flex-col">
        {FIELD_TYPES.map((option) => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={type === option}
            onClick={() => setType(option)}
            className={cn(
              "flex h-7 items-center gap-2 rounded-sm px-2 text-left text-sm hover:bg-state-hover",
              type === option && "bg-state-active text-foreground",
            )}
          >
            <Icon name={FIELD_TYPE_ICONS[option]} className="size-3.5 text-muted-foreground" />
            <span className="flex-1">{FIELD_TYPE_LABELS[option]}</span>
            {type === option ? <Icon name="Check" className="size-3.5" /> : null}
          </button>
        ))}
      </div>
      {problem === null ? null : (
        <p role="alert" className="text-xs text-destructive">
          {problem}
        </p>
      )}
      <Button type="submit" size="sm" disabled={busy} aria-busy={busy}>
        {busy ? <Icon name="Loading" className="size-3.5 animate-spin" /> : null}
        Add property
      </Button>
    </form>
  );
}

/** A trigger that opens the new-field form under it and closes it once the field is added; `declared` — the fields
 *  the section's database lists, the names a new one may not take (a key records merely have can be declared). */
export function AddFieldPopover({ sectionId, declared, trigger }: { sectionId: string; declared: readonly SectionField[]; trigger: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align="end" collisionPadding={8} className="w-60 p-2" mobileTitle="New property">
        {open ? <AddFieldForm sectionId={sectionId} declared={declared} onAdded={() => setOpen(false)} /> : null}
      </PopoverContent>
    </Popover>
  );
}

/** One option of a Select or Tags value, as a chip. */
export function OptionChip({ option }: { option: string }) {
  return <span className="max-w-full truncate rounded-sm bg-state-active px-1.5 py-px text-xs text-foreground">{option}</span>;
}

/** The chips of a Select or Tags value, or nothing for an empty one. */
export function OptionChips({ field, value }: { field: SectionField; value: string }) {
  const chosen = field.type === "tags" ? tagsOf(value) : value === "" ? [] : [value];
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-1">
      {chosen.map((option) => (
        <OptionChip key={option} option={option} />
      ))}
    </span>
  );
}

/**
 * Picks a Select's one option or a Tags value's several from the field's options: typing narrows the list,
 * Enter on a name the field lacks makes it an option and picks it, and the bin next to an option takes it
 * off the field — records keep the values they hold.
 */
export function OptionPicker({
  sectionId,
  field,
  value,
  onSave,
}: {
  sectionId: string;
  field: SectionField;
  value: string;
  onSave: (value: string | null) => void;
}) {
  const folders = useRpc<FoldersRpcContract>();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // What was picked shows at once: a second pick made before the record comes back keeps the first.
  const [picked, setPicked] = useState(value);
  const [seen, setSeen] = useState(value);
  if (value !== seen) {
    setSeen(value);
    setPicked(value);
  }
  const multiple = field.type === "tags";
  const chosen = multiple ? tagsOf(picked) : picked === "" ? [] : [picked];
  const options = [...(field.options ?? []), ...chosen.filter((option) => !(field.options ?? []).includes(option))];
  const needle = query.trim().toLowerCase();
  const shown = options.filter((option) => option.toLowerCase().includes(needle));
  const fresh = query.trim() !== "" && !options.some((option) => option.toLowerCase() === needle);

  const save = (next: string) => {
    setPicked(next);
    onSave(next === "" ? null : next);
  };
  const pick = (option: string) => {
    if (!multiple) {
      save(chosen.includes(option) ? "" : option);
      setOpen(false);
      return;
    }
    save(tagsValue(chosen.includes(option) ? chosen.filter((tag) => tag !== option) : [...chosen, option]));
  };
  const change = async (option: string, change: "add" | "remove") => {
    setBusy(true);
    const result = await folders
      .call("changeFieldOption", { boardId: sectionId, field: field.name, option, change })
      .catch((error: unknown) => ({ ok: false as const, message: error instanceof Error ? error.message : String(error) }))
      .finally(() => setBusy(false));
    if (!result.ok) setProblem(result.message);
    return result.ok;
  };
  const create = async () => {
    const option = query.trim();
    const found = optionProblem(field.options ?? [], option);
    if (found !== null) return setProblem(found);
    if (!(await change(option, "add"))) return;
    setQuery("");
    pick(option);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        setQuery("");
        setProblem(null);
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={field.name}
          className="flex min-h-7 w-full min-w-0 items-center rounded-md px-1 text-left text-sm hover:bg-state-hover"
        >
          {chosen.length === 0 ? <span className="text-muted-foreground">Empty</span> : <OptionChips field={field} value={picked} />}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" collisionPadding={8} className="w-60 p-1.5" mobileTitle={field.name}>
        <Input
          aria-label={`Find or add an option of ${field.name}`}
          placeholder="Find or add an option"
          autoFocus
          value={query}
          readOnly={busy}
          onChange={(event) => {
            setQuery(event.target.value);
            setProblem(null);
          }}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            if (fresh) void create();
            else if (shown.length > 0) pick(shown[0]!);
          }}
          className="mb-1 h-8 text-sm"
        />
        <div role="listbox" aria-label={`Options of ${field.name}`} aria-multiselectable={multiple} className="flex max-h-60 flex-col overflow-y-auto">
          {shown.map((option) => (
            <div key={option} className="group/option flex h-7 items-center rounded-sm hover:bg-state-hover">
              <button
                type="button"
                role="option"
                aria-selected={chosen.includes(option)}
                onClick={() => pick(option)}
                className="flex h-full min-w-0 flex-1 items-center gap-2 px-1.5 text-left"
              >
                <OptionChip option={option} />
                <span className="flex-1" />
                {chosen.includes(option) ? <Icon name="Check" className="size-3.5 shrink-0" /> : null}
              </button>
              {(field.options ?? []).includes(option) ? (
                <button
                  type="button"
                  aria-label={`Delete option ${option}`}
                  disabled={busy}
                  onClick={() => void change(option, "remove")}
                  className="mr-0.5 hidden size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-destructive focus-visible:flex group-hover/option:flex"
                >
                  <Icon name="Trash2" className="size-3.5" />
                </button>
              ) : null}
            </div>
          ))}
          {fresh ? (
            <button
              type="button"
              onClick={() => void create()}
              disabled={busy}
              className="flex h-7 items-center gap-2 rounded-sm px-1.5 text-left text-sm hover:bg-state-hover"
            >
              {busy ? <Icon name="Loading" className="size-3.5 animate-spin" /> : <Icon name="Plus" className="size-3.5 text-muted-foreground" />}
              <span className="min-w-0 truncate">
                Create <OptionChip option={query.trim()} />
              </span>
            </button>
          ) : null}
          {shown.length === 0 && !fresh ? <p className="px-1.5 py-1 text-xs text-muted-foreground">No options yet: type one.</p> : null}
        </div>
        {problem === null ? null : (
          <p role="alert" className="px-1.5 pt-1 text-xs text-destructive">
            {problem}
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}
