import { DEFAULT_PROJECT_ICON } from "@bb-plugins/icon-catalog";
import { IconPickerButton } from "@/components/icon-picker";
import { ColorSwatchPicker } from "./shared";

/**
 * One button for both of a project's looks: it shows the icon, and opens the project's own colour — its dots and
 * charts, and the icon's while the icon chose none — above the icon picker. A colour stays open; an icon closes it.
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
  return (
    <IconPickerButton
      label={label}
      value={icon}
      color={color}
      fallback={DEFAULT_PROJECT_ICON}
      className="size-8"
      header={
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">Project</span>
          <ColorSwatchPicker value={color} onChange={onColor} />
        </div>
      }
      onPick={onIcon}
    />
  );
}
