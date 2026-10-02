// Выбор иконки этапа: иконка у номера строки — кнопка, по клику — подборка Hugeicons с поиском по имени.
// «По виду» снимает выбор, и этап снова показывает иконку своего вида.
import { useState } from "react";

import { FieldOverlay, overlayItem, useFieldOverlay } from "../components/ui/field-overlay";
import { Input } from "../components/ui/input";
import { STAGE_ICONS } from "../components/ui/stage-icon-catalog";
import { cn } from "../lib/utils";
import { useMessages } from "./locale-context";
import { StageGlyph } from "./stage-glyph";

const ALL_ICONS = [...STAGE_ICONS.keys()];

/** Иконки, в имени которых есть набранное, без учёта регистра. */
const iconsMatching = (query: string): string[] => {
  const q = query.trim().toLowerCase();
  return q === "" ? ALL_ICONS : ALL_ICONS.filter((name) => name.toLowerCase().includes(q));
};

const cellButton = "flex size-8 items-center justify-center rounded-md hover:bg-state-hover";

export function StageIconPicker({ icon, fallback, name, onPick }: { icon: string | undefined; fallback: string; name: string; onPick: (icon: string | undefined) => void }) {
  const t = useMessages();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const close = () => {
    setOpen(false);
    setQuery("");
  };
  const { root } = useFieldOverlay(open, close);
  const pick = (next: string | undefined) => {
    onPick(next);
    close();
  };
  const found = iconsMatching(query);
  return (
    <div ref={root} className="relative flex">
      <button
        type="button"
        aria-label={t.settings.stageIcon(name)}
        title={t.settings.stageIcon(name)}
        aria-expanded={open}
        onClick={() => (open ? close() : setOpen(true))}
        className="flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-state-hover hover:text-foreground"
      >
        <StageGlyph icon={icon} fallback={fallback} className="size-3.5" />
      </button>
      <FieldOverlay open={open} onClose={close} role="listbox" label={t.settings.icons} className="w-[19rem]">
        <Input
          type="search"
          aria-label={t.settings.findIcon}
          placeholder={t.settings.findIcon}
          value={query}
          autoFocus
          onChange={(e) => setQuery(e.target.value)}
          className="mb-1 h-7 min-h-7 rounded-md border-0 bg-surface-recessed-solid px-2 py-0 text-[13px] shadow-none focus-visible:ring-1"
        />
        <button type="button" role="option" aria-selected={icon === undefined} onClick={() => pick(undefined)} className={cn(overlayItem, icon === undefined && "bg-state-active")}>
          <StageGlyph icon={undefined} fallback={fallback} className="size-3.5 shrink-0 text-muted-foreground" />
          {t.settings.iconByKind}
        </button>
        {found.length === 0 ? (
          <div className="px-2 py-1.5 text-xs text-muted-foreground">{t.settings.iconNotFound}</div>
        ) : (
          <div className="grid grid-cols-8 gap-0.5 pt-1">
            {found.map((name) => (
              <button
                key={name}
                type="button"
                role="option"
                aria-label={name}
                aria-selected={name === icon}
                title={name}
                onClick={() => pick(name)}
                className={cn(cellButton, name === icon && "bg-state-active text-foreground")}
              >
                <StageGlyph icon={name} fallback={fallback} className="size-4" />
              </button>
            ))}
          </div>
        )}
      </FieldOverlay>
    </div>
  );
}
