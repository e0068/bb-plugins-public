// The filter of an analytics tile — docs/specs/analitika-filtr-plitki-usloviyami.md.
// Filter lists the fields; a picked field shows its chip, and under the chip
// a menu of rows "operator · value" with Add condition. The chip reads the
// rows; its cross drops them all. Rows left without a value go when the menu
// closes, and a chip left without rows goes with them.
import { useState } from "react";

import { Button } from "../../components/ui/button";
import { Command, CommandItem, CommandList } from "../../components/ui/command";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "../../components/ui/dropdown-menu";
import { Icon } from "../../components/ui/icon";
import { Input } from "../../components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "../../components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select";
import { FIELD_FILTER_KINDS, QUERY_FIELDS, type QueryField } from "../../shared/enums.js";
import { CONDITION_OP_SIGN, CONDITION_OPS, CONDITION_VALUE_MAX, type ConditionOp, type TileCondition } from "../../shared/analytics-tile.js";
import { LISTED_VALUES, suggestionsOf, valueInput, type SuggestionScope } from "../../shared/tile-conditions.js";
import { PRIORITY_LABELS, STATUS_LABELS } from "../common/lib.js";
import { ROW_FIELD_LABELS } from "../common/row-field-preference.js";

export interface ConditionFilterProps {
  conditions: readonly TileCondition[];
  /** What is already on the boards, to offer under a value field; until it loads, values are typed. */
  scope?: SuggestionScope;
  onChange: (next: TileCondition[]) => void;
}

const GROUPS = [
  { label: "Properties", kinds: ["listed", "values"] },
  { label: "Dates", kinds: ["date"] },
  { label: "Numbers", kinds: ["number"] },
  { label: "Text", kinds: ["text"] },
] as const;

const fieldLabel = (field: QueryField) => ROW_FIELD_LABELS[field];

/** A listed value as the filter spells it. */
function valueLabel(field: QueryField, value: string): string {
  switch (field) {
    case "status":
      return STATUS_LABELS[value as keyof typeof STATUS_LABELS] ?? value;
    case "priority":
      return PRIORITY_LABELS[value as keyof typeof PRIORITY_LABELS] ?? value;
    case "estimate":
      return value.toUpperCase();
    default:
      return value.charAt(0).toUpperCase() + value.slice(1);
  }
}

/** What a chip reads: the field, then its rows — "Status = Todo, In Progress", "Cost > 5, < 9". */
function chipText(field: QueryField, rows: readonly TileCondition[]): string {
  const live = rows.filter((row) => row.value.trim() !== "");
  const spelled = live.map((row, index) => {
    const value = LISTED_VALUES[field] === undefined ? row.value.trim() : valueLabel(field, row.value);
    return index > 0 && row.op === live[index - 1]!.op ? value : `${CONDITION_OP_SIGN[row.op]} ${value}`;
  });
  return spelled.length === 0 ? fieldLabel(field) : `${fieldLabel(field)} ${spelled.join(", ")}`;
}

const CHIP_CLASS = "flex h-6 max-w-full shrink-0 items-center rounded-md border border-border bg-secondary text-xs text-foreground";

/**
 * A value typed in. While the field has focus, the values of the field already
 * on the boards that hold what is typed drop down under it; a click picks one.
 */
function TypedValue({ field, row, scope, onChange }: { field: QueryField; row: TileCondition; scope: SuggestionScope | undefined; onChange: (row: TileCondition) => void }) {
  const [focused, setFocused] = useState(false);
  const options = scope === undefined ? [] : suggestionsOf(field, scope, row.value);
  // The field sits inside the Command, so the arrows move down the list and Enter picks, as in any menu.
  return (
    <Command shouldFilter={false} vimBindings={false} className="relative h-auto min-w-0 flex-1 overflow-visible bg-transparent">
      <Input
        autoFocus={row.value === ""}
        type={valueInput(field)}
        value={row.value}
        maxLength={CONDITION_VALUE_MAX}
        placeholder="Value"
        aria-label="Value"
        className="h-7 text-sm"
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        // Home and End move the cursor in the text, not the highlight in the list.
        onKeyDown={(event) => {
          if (event.key === "Home" || event.key === "End") event.stopPropagation();
        }}
        onChange={(event) => onChange({ ...row, value: event.target.value })}
      />
      {focused && options.length > 0 ? (
        // Pressing an option must not blur the field first, or the list would go before the click lands.
        <CommandList className="absolute inset-x-0 top-full z-10 mt-1 rounded-md border border-border bg-popover p-1 shadow-md" onMouseDown={(event) => event.preventDefault()}>
          {options.map((option) => (
            <CommandItem
              key={option.value}
              value={option.value}
              className="text-xs"
              onSelect={() => {
                onChange({ ...row, value: option.value });
                setFocused(false);
              }}
            >
              <span className="truncate">{option.label}</span>
            </CommandItem>
          ))}
        </CommandList>
      ) : null}
    </Command>
  );
}

function ConditionRow({ field, row, number, scope, onChange, onRemove }: { field: QueryField; row: TileCondition; number: number; scope: SuggestionScope | undefined; onChange: (row: TileCondition) => void; onRemove: () => void }) {
  const values = LISTED_VALUES[field];
  return (
    <div role="group" aria-label={`Condition ${number}`} className="flex items-center gap-1">
      <Select value={row.op} onValueChange={(op) => onChange({ ...row, op: op as ConditionOp })}>
        <SelectTrigger aria-label="Operator" className="h-7 w-14 shrink-0 text-sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {CONDITION_OPS.map((op) => (
            <SelectItem key={op} value={op}>
              {CONDITION_OP_SIGN[op]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {values === undefined ? (
        <TypedValue field={field} row={row} scope={scope} onChange={onChange} />
      ) : (
        <Select value={row.value === "" ? undefined : row.value} onValueChange={(value) => onChange({ ...row, value })}>
          <SelectTrigger aria-label="Value" className="h-7 min-w-0 flex-1 text-sm">
            <SelectValue placeholder="Pick a value" />
          </SelectTrigger>
          <SelectContent>
            {values.map((value) => (
              <SelectItem key={value} value={value}>
                {valueLabel(field, value)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      <Button type="button" variant="ghost" size="icon" aria-label={`Remove condition ${number}`} className="size-7 shrink-0 text-muted-foreground" onClick={onRemove}>
        <Icon name="X" className="size-3" />
      </Button>
    </div>
  );
}

export function ConditionFilter({ conditions, scope, onChange }: ConditionFilterProps) {
  const [openField, setOpenField] = useState<QueryField | null>(null);
  const fields = [...new Set(conditions.map((condition) => condition.field))];
  const rowsOf = (field: QueryField) => conditions.filter((condition) => condition.field === field);
  const blank = (field: QueryField): TileCondition => ({ field, op: "eq", value: "" });

  // The field's rows replaced, the other fields' rows kept where they stand.
  const setRows = (field: QueryField, rows: readonly TileCondition[]) => {
    const at = conditions.findIndex((condition) => condition.field === field);
    const others = conditions.filter((condition) => condition.field !== field);
    const place = at < 0 ? others.length : conditions.slice(0, at).filter((condition) => condition.field !== field).length;
    onChange([...others.slice(0, place), ...rows, ...others.slice(place)]);
  };

  const pick = (field: QueryField) => {
    if (rowsOf(field).length === 0) setRows(field, [blank(field)]);
    setOpenField(field);
  };

  const close = (field: QueryField) => {
    setOpenField(null);
    const rows = rowsOf(field);
    if (rows.some((row) => row.value.trim() === "")) setRows(field, rows.filter((row) => row.value.trim() !== ""));
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {fields.map((field) => {
        const rows = rowsOf(field);
        return (
          <span key={field} className={CHIP_CLASS} data-condition-chip={field}>
            <Popover open={openField === field} onOpenChange={(open) => (open ? setOpenField(field) : close(field))}>
              <PopoverTrigger asChild>
                <button type="button" className="flex h-full min-w-0 items-center gap-1.5 pl-2 pr-1">
                  <span className="truncate">{chipText(field, rows)}</span>
                </button>
              </PopoverTrigger>
              <PopoverContent align="start" collisionPadding={8} aria-label={`${fieldLabel(field)} filter`} className="flex w-72 flex-col gap-1.5 p-2" mobileTitle={fieldLabel(field)}>
                {rows.map((row, index) => (
                  <ConditionRow
                    key={index}
                    field={field}
                    row={row}
                    number={index + 1}
                    scope={scope}
                    onChange={(next) => setRows(field, rows.map((each, at) => (at === index ? next : each)))}
                    onRemove={() => setRows(field, rows.filter((_, at) => at !== index))}
                  />
                ))}
                <Button type="button" variant="ghost" size="sm" className="h-7 justify-start gap-1.5 px-1.5 text-muted-foreground" onClick={() => setRows(field, [...rows, blank(field)])}>
                  <Icon name="Plus" className="size-3" />
                  Add condition
                </Button>
              </PopoverContent>
            </Popover>
            <button
              type="button"
              aria-label={`Remove ${fieldLabel(field)} filter`}
              className="flex size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-state-hover hover:text-foreground"
              onClick={() => setRows(field, [])}
            >
              <Icon name="X" className="size-3" />
            </button>
          </span>
        );
      })}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="ghost" size="sm" aria-label="Filter" className="h-6 gap-1 px-1.5 text-xs text-muted-foreground">
            <Icon name="Filter" className="size-3" />
            {fields.length === 0 ? "Add filter" : null}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          collisionPadding={8}
          className="max-h-[var(--radix-dropdown-menu-content-available-height)] min-w-44 overflow-y-auto"
          mobileTitle="Filter by"
          // The picked field's chip opens its own menu as this one closes; focus sent back here would shut it.
          onCloseAutoFocus={(event) => event.preventDefault()}
        >
          {GROUPS.map((group) => (
            <div key={group.label}>
              <DropdownMenuLabel>{group.label}</DropdownMenuLabel>
              {QUERY_FIELDS.filter((field) => (group.kinds as readonly string[]).includes(FIELD_FILTER_KINDS[field])).map((field) => (
                <DropdownMenuItem key={field} onSelect={() => pick(field)}>
                  {fieldLabel(field)}
                </DropdownMenuItem>
              ))}
            </div>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
