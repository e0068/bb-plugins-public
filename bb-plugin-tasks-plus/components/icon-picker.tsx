import { startTransition, useDeferredValue, useEffect, useMemo, useState, type ReactElement, type ReactNode } from "react";
import type { IconColors } from "@bb-plugins/icon-catalog";
import { colorsOf, iconChoices, PLACEHOLDER_ICON, recolored, tabOf, type IconTab } from "@/lib/icon-drawing";
import { cn } from "@/lib/utils";
import { ColorSwatchPicker } from "./color-swatches";
import { EntityIcon } from "./entity-icon";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { Segments } from "./ui/segments";

/** The choices drawn at once when a tab opens or the search changes; the rest follow without holding up typing. */
const FIRST_SCREEN = 120;

const TABS: readonly { value: IconTab; label: string }[] = [
  { value: "line", label: "Line" },
  { value: "filled", label: "Filled" },
  { value: "emoji", label: "Emoji" },
];

export interface IconPickerProps {
  /** The icon chosen now; absent for none. */
  value?: string;
  /** The bearer's colour — a project's or label's: it paints what the icon chose no colour for; absent — the text colour. */
  color?: string;
  onPick: (value: string) => void;
  /** The chosen icon in the colours just picked; the picker stays open. Absent — the colours wait for a pick. */
  onRecolor?: (value: string) => void;
  /** Takes the icon off; absent where an icon cannot be removed. */
  onClear?: () => void;
}

function ColorRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

/**
 * The icon picker's body: Line, Filled and Emoji tabs, the colours of the line and of the tile, a searchable grid.
 * It opens on the tab and colours of the chosen icon; a colour recolours a chosen icon of the tab at once.
 */
export function IconPicker({ value, color, onPick, onRecolor, onClear }: IconPickerProps) {
  const [tab, setTab] = useState<IconTab>(() => tabOf(value));
  const [query, setQuery] = useState("");
  const [colors, setColors] = useState<IconColors>(() => colorsOf(value));
  // Line and Filled hold some 1500 signs each: the grid follows typing and colour clicks a beat later, the first
  // screenful first.
  const deferredQuery = useDeferredValue(query);
  const deferredColors = useDeferredValue(colors);
  const choices = useMemo(() => iconChoices(tab, deferredQuery, deferredColors), [tab, deferredQuery, deferredColors]);
  // A new tab or search draws its first screenful in this very render; the rest follows in a transition.
  const scope = `${tab}|${deferredQuery}`;
  const [drawn, setDrawn] = useState({ scope, count: FIRST_SCREEN });
  if (drawn.scope !== scope) setDrawn({ scope, count: FIRST_SCREEN });
  useEffect(() => {
    startTransition(() => setDrawn((current) => (current.scope === scope ? { scope, count: Number.POSITIVE_INFINITY } : current)));
  }, [scope]);

  const recolor = (next: IconColors) => {
    setColors(next);
    if (value !== undefined && tabOf(value) === tab && tab !== "emoji") onRecolor?.(recolored(value, next));
  };
  const lineColor = (
    <ColorRow label="Line">
      <ColorSwatchPicker
        label="Line color"
        swatchLabel={(name) => `${name} line`}
        value={colors.color}
        none={{ label: "Default line", onPick: () => recolor({ ...(colors.background === undefined ? {} : { background: colors.background }) }) }}
        onChange={(picked) => recolor({ ...colors, color: picked })}
      />
    </ColorRow>
  );

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1">
        <Segments label="Icon kind" value={tab} options={TABS} onChange={setTab} className="flex-1" />
        {onClear !== undefined && value !== undefined && (
          <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" aria-label="Remove icon" onClick={onClear}>
            Remove
          </Button>
        )}
      </div>
      {tab === "emoji" ? null : lineColor}
      {tab === "filled" ? (
        <ColorRow label="Background">
          <ColorSwatchPicker
            label="Background color"
            swatchLabel={(name) => `${name} background`}
            value={colors.background}
            none={{ label: "No background", onPick: () => recolor({ ...(colors.color === undefined ? {} : { color: colors.color }) }) }}
            onChange={(picked) => recolor({ ...colors, background: picked })}
          />
        </ColorRow>
      ) : null}
      <Input
        value={query}
        placeholder={tab === "emoji" ? "Search emoji…" : "Search icons…"}
        aria-label="Search icons"
        className="h-7 text-sm"
        onChange={(event) => setQuery(event.target.value)}
      />
      {choices.length === 0 ? (
        <p className="py-2 text-center text-xs text-muted-foreground">No icons match.</p>
      ) : (
        <div className={cn("grid max-h-56 gap-1 overflow-y-auto", tab === "emoji" ? "grid-cols-7" : "grid-cols-8")}>
          {choices.slice(0, drawn.scope === scope ? drawn.count : FIRST_SCREEN).map((choice) => (
            <Button
              // Keyed by the sign, not its colours: a colour click repaints the buttons instead of remounting them.
              key={choice.label}
              type="button"
              variant="ghost"
              size="icon"
              aria-label={choice.label}
              aria-pressed={choice.value === value}
              data-icon-name={choice.label}
              // The button sizes the svg inside it to 16px; an emoji is drawn larger, as the system's emoji panel shows it.
              className={tab === "emoji" ? "size-9 [&_svg]:size-7" : "size-8"}
              onClick={() => onPick(choice.value)}
            >
              <EntityIcon icon={choice.value} color={color} />
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * A button showing the icon that opens the picker in a popover; a pick or Remove closes it, a colour does not.
 * Without an icon it shows `fallback`, or a faint placeholder when there is none; `trigger` replaces the button.
 */
export function IconPickerButton({
  label,
  fallback = null,
  className,
  header,
  trigger,
  onPick,
  onClear,
  ...picker
}: Omit<IconPickerProps, "onRecolor"> & {
  /** The button's and the popover's name. */
  label: string;
  fallback?: string | null;
  /** The button's classes; the icon's size goes here as `[&_svg]:size-…` — a size on the icon itself loses to the
   *  button's own 16px svg rule. */
  className?: string;
  /** Above the tabs: the project's own colour, for a project. */
  header?: ReactNode;
  /** Another opener in place of the icon button — Notion's "Add icon" above a title. */
  trigger?: ReactElement;
}) {
  const [open, setOpen] = useState(false);
  const shown = picker.value ?? fallback ?? undefined;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {trigger ?? (
          <Button type="button" variant="ghost" size="icon" aria-label={label} className={cn("size-7 shrink-0", className)}>
            {shown === undefined ? (
              <EntityIcon icon={PLACEHOLDER_ICON} className="text-muted-foreground/50" />
            ) : (
              <EntityIcon icon={shown} color={picker.color} fallback={fallback} />
            )}
          </Button>
        )}
      </PopoverTrigger>
      <PopoverContent align="start" collisionPadding={8} className="flex w-96 flex-col gap-2 p-2" mobileTitle={label}>
        {header}
        <IconPicker
          {...picker}
          onRecolor={onPick}
          onPick={(value) => {
            onPick(value);
            setOpen(false);
          }}
          onClear={
            onClear === undefined
              ? undefined
              : () => {
                  onClear();
                  setOpen(false);
                }
          }
        />
      </PopoverContent>
    </Popover>
  );
}
