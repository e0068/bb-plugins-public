import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  moveField,
  resetFieldDisplay,
  ROW_FIELD_LABELS,
  setShowDescription,
  setShowEmpty,
  surfaceOfScope,
  toggleFieldVisible,
  useFieldDisplay,
  type FieldScope,
} from "./row-field-preference.js";
import { SavedViewsSection } from "./saved-views-section.js";

/**
 * Destination index `moveField` expects, from an "insert before slot N" drop.
 * Once the dragged item at `from` is removed, everything after it shifts down
 * one, so a slot past `from` lands one lower. The array mechanics themselves
 * are covered by `moveField`'s tests.
 */
function dropDestination(from: number, insertBefore: number): number {
  return insertBefore > from ? insertBefore - 1 : insertBefore;
}

interface DragState {
  from: number;
  /** Slot the row would drop before (0..length; length = past the end). */
  insertBefore: number;
}

function FieldList({ scope }: { scope: FieldScope }) {
  const config = useFieldDisplay(scope);
  const rowRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [drag, setDrag] = useState<DragState | null>(null);

  const beginDrag = (event: ReactPointerEvent, from: number) => {
    // The grip owns the gesture; keep it off the row's toggle click.
    event.preventDefault();
    event.stopPropagation();
    const fields = config.fields;
    let insertBefore = from;

    const onMove = (moveEvent: PointerEvent) => {
      const y = moveEvent.clientY;
      let slot = fields.length;
      for (let index = 0; index < fields.length; index += 1) {
        const element = rowRefs.current[index];
        if (!element) continue;
        const rect = element.getBoundingClientRect();
        if (y < rect.top + rect.height / 2) {
          slot = index;
          break;
        }
      }
      insertBefore = slot;
      setDrag({ from, insertBefore: slot });
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setDrag(null);
      moveField(scope, from, dropDestination(from, insertBefore));
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    setDrag({ from, insertBefore: from });
  };

  return (
    <div className="flex flex-col">
      {config.fields.map((entry, index) => {
        const dragging = drag?.from === index;
        const showIndicator = drag !== null && drag.insertBefore === index;
        return (
          <div
            key={entry.field}
            ref={(element) => {
              rowRefs.current[index] = element;
            }}
            className={cn(
              "relative flex items-center gap-1 rounded-sm",
              dragging && "opacity-40",
            )}
          >
            {showIndicator ? (
              <div className="pointer-events-none absolute inset-x-1 -top-px h-0.5 rounded-full bg-primary" />
            ) : null}
            <button
              type="button"
              aria-label={`Reorder ${ROW_FIELD_LABELS[entry.field]}`}
              onPointerDown={(event) => beginDrag(event, index)}
              className="flex size-6 shrink-0 cursor-grab touch-none items-center justify-center text-subtle-foreground hover:text-foreground"
            >
              <Icon name="DragDropVertical" className="size-3.5" />
            </button>
            <button
              type="button"
              onClick={() => toggleFieldVisible(scope, entry.field)}
              className="flex flex-1 items-center gap-2 rounded-sm px-1.5 py-1 text-left text-sm hover:bg-state-hover"
            >
              <span
                className={cn(
                  "flex-1 truncate",
                  !entry.visible && "text-muted-foreground",
                )}
              >
                {ROW_FIELD_LABELS[entry.field]}
              </span>
              <span className="flex size-4 shrink-0 items-center justify-center">
                {entry.visible ? (
                  <Icon name="Check" className="size-3.5" />
                ) : null}
              </span>
            </button>
          </div>
        );
      })}
    </div>
  );
}

function ToggleRow({
  checked,
  label,
  onToggle,
}: {
  checked: boolean;
  label: string;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="flex w-full items-center gap-2 rounded-sm px-1.5 py-1 text-left text-sm hover:bg-state-hover"
    >
      <span className="flex-1">{label}</span>
      <span className="flex size-4 shrink-0 items-center justify-center">
        {checked ? <Icon name="Check" className="size-3.5" /> : null}
      </span>
    </button>
  );
}

export interface FieldDisplayMenuProps {
  scope: FieldScope;
  /** Chip trigger in the list filter bar; icon trigger in the board topbar. */
  variant: "chip" | "icon";
}

/**
 * Display menu: drag to reorder fields, click to show/hide, plus the show-empty
 * (and, on the board, show-description) flags. Backed by the shared field-display
 * store, so a change here is reflected at once by the surface it scopes.
 */
export function FieldDisplayMenu({ scope, variant }: FieldDisplayMenuProps) {
  const config = useFieldDisplay(scope);
  const isBoard = surfaceOfScope(scope) === "board";
  return (
    <Popover>
      <PopoverTrigger asChild>
        {variant === "chip" ? (
          <button
            type="button"
            aria-label="Display fields"
            className="flex h-6 shrink-0 items-center gap-1.5 rounded-md border border-dashed border-border px-2.5 text-xs text-muted-foreground hover:border-input hover:text-foreground max-md:pointer-coarse:h-8"
          >
            <Icon name="Eye" className="size-3" />
            Display
          </button>
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7 shrink-0 text-muted-foreground hover:text-foreground active:bg-state-active active:text-foreground max-md:pointer-coarse:size-9"
            aria-label="Display fields"
          >
            <Icon name="Eye" className="size-3.5" />
          </Button>
        )}
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-64 p-1.5"
        mobileTitle="Display fields"
      >
        <FieldList scope={scope} />
        <div className="my-1 border-t border-border-hairline" />
        <ToggleRow
          checked={config.showEmpty}
          label="Show empty values"
          onToggle={() => setShowEmpty(scope, !config.showEmpty)}
        />
        {isBoard ? (
          <ToggleRow
            checked={config.showDescription}
            label="Show description"
            onToggle={() => setShowDescription(scope, !config.showDescription)}
          />
        ) : null}
        <div className="my-1 border-t border-border-hairline" />
        <SavedViewsSection scope={scope} config={config} />
        <div className="my-1 border-t border-border-hairline" />
        <button
          type="button"
          onClick={() => resetFieldDisplay(scope)}
          className="flex w-full items-center gap-2 rounded-sm px-1.5 py-1 text-left text-sm text-muted-foreground hover:bg-state-hover hover:text-foreground"
        >
          <Icon name="RotateCcw" className="size-3.5" />
          Reset to default
        </button>
      </PopoverContent>
    </Popover>
  );
}
