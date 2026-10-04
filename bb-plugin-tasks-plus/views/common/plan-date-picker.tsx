import { useState, type KeyboardEvent, type ReactNode } from "react";
import { Icon } from "@/components/ui/icon";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { formatDueDate } from "../../components/task-meta.js";
import { planDayFrom } from "../../shared/plan-date.js";
import { dayOf, timeOf, withDay, withTime } from "./plan-date-edit.js";

/**
 * The two plan dates differ only in icon and wording — so the difference
 * lives in this table, and the picker below has no branch on `kind`.
 */
export const PLAN_DATE_COPY = {
  start: {
    icon: "Calendar",
    label: "Start date",
    timeLabel: "Start time",
    placeholder: "Set start date",
    remove: "Remove start date",
  },
  due: {
    icon: "Clock",
    label: "Due date",
    timeLabel: "Due time",
    placeholder: "Set due date",
    remove: "Remove due date",
  },
} as const;

export type PlanDateKind = keyof typeof PLAN_DATE_COPY;

const PRESETS: readonly (readonly [label: string, days: number])[] = [
  ["Today", 0],
  ["Tomorrow", 1],
  ["Next week", 7],
];

const INPUT_CLASS = "h-7 rounded-md border border-input bg-transparent px-2 text-sm text-foreground";

/** One row of the picker that answers on its own — a preset or the remove row. */
export type PickerItem = (props: { onSelect: () => void; children: ReactNode }) => ReactNode;

function PickerButton({ onSelect, children }: { onSelect: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      className="flex items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground"
      onClick={onSelect}
    >
      {children}
    </button>
  );
}

/** Typing in a field stays in the field: a menu around the picker would read the keys as its own navigation. Escape still closes. */
function keepKeysInFields(event: KeyboardEvent) {
  if (event.key !== "Escape") event.stopPropagation();
}

/**
 * The one picker every place that sets Start or Due shows: a preset day, or
 * the day and the time side by side — the time there from the start, a time
 * set before the day lands on today. A preset is a whole answer and closes
 * the picker (`onDone`); the fields stay open so the day and the time are
 * set one after the other.
 */
export function PlanDatePicker({
  kind,
  value,
  onChange,
  onDone = () => {},
  item: Item = PickerButton,
}: {
  kind: PlanDateKind;
  value: string | null;
  onChange: (value: string | null) => void;
  /** Closes whatever holds the picker; a menu's own items close it without being told. */
  onDone?: () => void;
  /** How a preset or the remove row is drawn: a plain button, or a menu's own item where the picker sits in a menu. */
  item?: PickerItem;
}) {
  const copy = PLAN_DATE_COPY[kind];
  const today = new Date();
  // The picker's own copy of the value: a day just picked is the day the time
  // goes on, before the saved task comes back with it. A change from outside
  // replaces the copy.
  const [draft, setDraft] = useState(value);
  const [seen, setSeen] = useState(value);
  if (value !== seen) {
    setSeen(value);
    setDraft(value);
  }
  const change = (next: string | null) => {
    setDraft(next);
    // Typing a year by hand passes through 0002, 0020, 0202 on its way to
    // 2026; only a four-digit year is a day worth saving.
    if (next === null || Number(next.slice(0, 4)) >= 1000) onChange(next);
  };
  return (
    <div className="flex flex-col">
      {PRESETS.map(([label, days]) => (
        <Item
          key={label}
          onSelect={() => {
            change(planDayFrom(today, days));
            onDone();
          }}
        >
          <span>{label}</span>
          <span className="ml-auto text-xs text-muted-foreground">{formatDueDate(planDayFrom(today, days))}</span>
        </Item>
      ))}
      <div className="my-1 flex gap-1" onKeyDown={keepKeysInFields}>
        <input
          type="date"
          aria-label={copy.label}
          className={`${INPUT_CLASS} min-w-0 flex-1`}
          value={dayOf(draft)}
          onChange={(event) => {
            if (event.target.value) change(withDay(draft, event.target.value));
          }}
        />
        <input
          type="time"
          aria-label={copy.timeLabel}
          className={`${INPUT_CLASS} w-24 shrink-0`}
          value={timeOf(draft)}
          onChange={(event) => change(withTime(draft, event.target.value, new Date()))}
        />
      </div>
      {draft ? (
        <Item
          onSelect={() => {
            change(null);
            onDone();
          }}
        >
          <Icon name="X" className="size-3.5 text-muted-foreground" />
          <span className="text-muted-foreground">{copy.remove}</span>
        </Item>
      ) : null}
    </div>
  );
}

/** {@link PlanDatePicker} in a popover, behind a trigger that reads the value — or the placeholder while there is none. */
export function PlanDatePopover({
  kind,
  value,
  onChange,
  triggerClassName,
}: {
  kind: PlanDateKind;
  value: string | null;
  onChange: (value: string | null) => void;
  triggerClassName: string;
}) {
  const [open, setOpen] = useState(false);
  const copy = PLAN_DATE_COPY[kind];
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className={triggerClassName}>
          <Icon name={copy.icon} className="size-3.5 shrink-0" />
          {value ? formatDueDate(value) : copy.placeholder}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-2">
        <PlanDatePicker kind={kind} value={value} onChange={onChange} onDone={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  );
}
