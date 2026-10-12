import { HugeiconsIcon } from "@hugeicons/react";
import { Folder01Icon } from "@hugeicons/core-free-icons";
import { DEFAULT_PROJECT_ICON, ICON_CATALOG } from "@bb-plugins/icon-catalog";
import { isEdgeless } from "@/lib/edgeless-color";
import { cn } from "@/lib/utils";

/** The glyph a project's icon name stands for; Folder01 (DEFAULT_PROJECT_ICON) when there is none or the catalog lost it. */
const glyphOf = (icon: string | undefined) => ICON_CATALOG.get(icon ?? DEFAULT_PROJECT_ICON) ?? Folder01Icon;

/**
 * A project's icon drawn in the project's colour. Black and white vanish into one
 * of bb's themes, so they take the theme's text colour instead.
 */
export function ProjectIcon({ icon, color, className }: { icon?: string; color: string; className?: string }) {
  const edgeless = isEdgeless(color);
  return (
    <HugeiconsIcon
      icon={glyphOf(icon)}
      aria-hidden="true"
      className={cn("shrink-0", edgeless && "text-foreground", className)}
      style={edgeless ? undefined : { color }}
    />
  );
}
