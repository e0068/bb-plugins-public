import { useState, type ReactNode } from "react";
import type { Label, Task } from "../../shared/contract.js";
import type { PropertyPatch } from "../../shared/properties.js";
import { LABELS_FIELD, type SectionField } from "../../shared/section-fields.js";
import { Checkbox } from "@/components/ui/checkbox";
import { Icon, type IconName } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { formatDateValue } from "../common/date-display.js";
import { AddFieldPopover, FIELD_TYPE_ICONS, OptionPicker } from "../common/section-field.js";
import { isChecked } from "../table/section-layout.js";
import { LabelsValue, type TaskPropertyUpdate } from "./rail.js";

/**
 * The Properties of a section's record in its card: the same columns the
 * section's table draws — the two dates the database keeps, read only, then
 * every field of the section, edited in place the way its type reads, the Tags
 * every section has being the record's labels — and the "+" that adds a field. A record of a section has no task fields, so nothing
 * else stands here (docs/specs/BBPL-901-tasks-zapis-tablicy-otkryvaetsya-kasimovym.md).
 */

const ROW = "-mx-1.5 grid min-h-7 w-[calc(100%+0.75rem)] grid-cols-[minmax(0,5.5rem)_minmax(0,1fr)] items-center gap-2 rounded-md px-1.5 text-sm";
const VALUE = "h-7 min-w-0 border-transparent px-1 text-sm shadow-none hover:bg-state-hover";

function Row({ icon, name, children }: { icon: IconName; name: string; children: ReactNode }) {
  return (
    <div className={ROW} data-property={name}>
      <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
        <Icon name={icon} className="size-3.5 shrink-0" />
        <span className="truncate">{name}</span>
      </span>
      <span className="flex min-w-0 items-center">{children}</span>
    </div>
  );
}

/** A value typed in place: a draft until Enter or leaving the field saves it, Escape gives it up; empty takes the property away. */
function TypedValue({ field, value, onSave }: { field: SectionField; value: string; onSave: (value: string | null) => void }) {
  const [draft, setDraft] = useState(value);
  const commit = () => {
    const next = draft.trim();
    if (next !== value) onSave(next === "" ? null : next);
  };
  return (
    <>
      <Input
        aria-label={field.name}
        type={field.type === "number" ? "number" : "text"}
        inputMode={field.type === "number" ? "decimal" : undefined}
        className={cn(VALUE, field.type === "number" && "tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none")}
        placeholder="Empty"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            event.currentTarget.blur();
          }
          if (event.key === "Escape") {
            event.preventDefault();
            setDraft(value);
          }
        }}
      />
      {field.type === "url" && value !== "" ? (
        <a href={value} target="_blank" rel="noreferrer" aria-label={`Open ${field.name}`} className="flex shrink-0 px-1 text-muted-foreground hover:text-foreground">
          <Icon name="ExternalLink" className="size-3.5" />
        </a>
      ) : null}
    </>
  );
}

/** A day picked or typed: typing a year passes through 0002, 0020, 0202 on its way to 2026, so only a
 *  four-digit year is saved — as the task's own date pickers do; a cleared day takes the property away. */
function DayValue({ field, value, onSave }: { field: SectionField; value: string; onSave: (value: string | null) => void }) {
  const [draft, setDraft] = useState(value);
  const [seen, setSeen] = useState(value);
  if (value !== seen) {
    setSeen(value);
    setDraft(value);
  }
  return (
    <Input
      aria-label={field.name}
      type="date"
      className={cn(VALUE, "tabular-nums")}
      value={draft}
      onChange={(event) => {
        const next = event.target.value;
        setDraft(next);
        if (next === "") onSave(null);
        else if (Number(next.slice(0, 4)) >= 1000 && next !== value) onSave(next);
      }}
    />
  );
}

function FieldValue({
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
  switch (field.type) {
    case "select":
    case "tags":
      return <OptionPicker sectionId={sectionId} field={field} value={value} onSave={onSave} />;
    case "checkbox":
      return <Checkbox aria-label={field.name} className="mx-1" checked={isChecked(value)} onCheckedChange={(checked) => onSave(checked === true ? "true" : "false")} />;
    case "date":
      return <DayValue field={field} value={value} onSave={onSave} />;
    default:
      // Keyed by the stored value: an edit made elsewhere replaces what is shown.
      return <TypedValue key={value} field={field} value={value} onSave={onSave} />;
  }
}

export function SectionProperties({
  task,
  fields,
  declared,
  labels,
  onSave,
  onUpdate,
}: {
  task: Task;
  /** Every field of the section, as its table draws them. */
  fields: readonly SectionField[];
  /** The fields its database lists — the names a new one may not take. */
  declared: readonly SectionField[];
  /** The labels the section's records carry, to pick Tags from. */
  labels: Label[] | undefined;
  onSave: (patch: PropertyPatch) => void;
  onUpdate: (update: TaskPropertyUpdate) => void;
}) {
  // An emptied field the database lists leaves the record; one only records have stays, empty, or the section would lose it.
  const emptied = (name: string, value: string | null): PropertyPatch =>
    value !== null ? { set: { [name]: value } } : declared.some((field) => field.name === name) ? { remove: [name] } : { set: { [name]: "" } };
  const now = new Date();
  const moment = (iso: string) => <span className="truncate px-1 tabular-nums">{formatDateValue({ kind: "moment", iso }, "dateTime", now)}</span>;
  return (
    <section aria-label="Properties" className="flex flex-col gap-0.5">
      <h2 className="mb-1.5 text-xs font-semibold text-muted-foreground">Properties</h2>
      <Row icon="DateTime" name="Created">
        {moment(task.createdAt)}
      </Row>
      <Row icon="Edit" name="Edited">
        {moment(task.updatedAt)}
      </Row>
      {fields.map((field) => (
        <Row key={field.name} icon={FIELD_TYPE_ICONS[field.type]} name={field.name}>
          {field.name === LABELS_FIELD ? (
            <LabelsValue task={task} labels={labels} onUpdate={onUpdate} />
          ) : (
            <FieldValue
              sectionId={task.projectId}
              field={field}
              value={task.properties?.[field.name] ?? ""}
              onSave={(value) => onSave(emptied(field.name, value))}
            />
          )}
        </Row>
      ))}
      <AddFieldPopover
        sectionId={task.projectId}
        declared={declared}
        trigger={
          <button type="button" className="-mx-1.5 mt-1 flex h-7 items-center gap-1.5 rounded-md px-1.5 text-sm text-muted-foreground hover:bg-state-hover hover:text-foreground">
            <Icon name="Plus" className="size-3.5" />
            Add property
          </button>
        }
      />
    </section>
  );
}
