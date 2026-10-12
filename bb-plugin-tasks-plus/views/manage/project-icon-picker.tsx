import { useState } from "react";
import { DEFAULT_PROJECT_ICON, ICON_CATALOG } from "@bb-plugins/icon-catalog";
import { ProjectIcon } from "@/components/project-icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ColorSwatchPicker } from "./shared";

const ICON_NAMES: readonly string[] = [...ICON_CATALOG.keys()];

/** The catalog's icon names that hold the typed text, case aside, in the catalog's order. */
const namesHolding = (query: string): readonly string[] => {
  const needle = query.trim().toLowerCase();
  return ICON_NAMES.filter((name) => name.toLowerCase().includes(needle));
};

/**
 * One button for both of a project's looks: it shows the icon in the colour, and opens the colours
 * above a searchable grid of icons. A colour stays open for the icon; an icon closes the window.
 */
export function ProjectIconPicker({
  icon,
  color,
  label,
  onIcon,
  onColor,
}: {
  icon?: string;
  color: string;
  label: string;
  onIcon: (icon: string) => void;
  onColor: (color: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const current = icon ?? DEFAULT_PROJECT_ICON;
  const names = namesHolding(query);

  const changeOpen = (next: boolean) => {
    setOpen(next);
    if (!next) setQuery("");
  };

  return (
    <Popover open={open} onOpenChange={changeOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" size="icon" aria-label={label} className="size-8">
          <ProjectIcon icon={icon} color={color} className="size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" collisionPadding={8} className="flex w-80 flex-col gap-2 p-2" mobileTitle={label}>
        <ColorSwatchPicker value={color} onChange={onColor} />
        <Input
          value={query}
          placeholder="Search icons…"
          aria-label="Search icons"
          className="h-7 text-sm"
          onChange={(event) => setQuery(event.target.value)}
        />
        {names.length === 0 ? (
          <p className="py-2 text-center text-xs text-muted-foreground">No icons match.</p>
        ) : (
          <div className="grid max-h-56 grid-cols-8 gap-1 overflow-y-auto">
            {names.map((name) => (
              <Button
                key={name}
                type="button"
                variant="ghost"
                size="icon"
                aria-label={name}
                aria-pressed={name === current}
                data-icon-name={name}
                className="size-8"
                onClick={() => {
                  onIcon(name);
                  changeOpen(false);
                }}
              >
                <ProjectIcon icon={name} color={color} className="size-4" />
              </Button>
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
