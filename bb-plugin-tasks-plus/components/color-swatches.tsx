import { COLOR_PALETTE } from "@/lib/color-palette";
import { isEdgeless } from "@/lib/edgeless-color";
import { cn } from "@/lib/utils";
import { Icon } from "./ui/icon";

const SWATCH = "size-5 rounded-md";
const CHECKED = "ring-2 ring-ring ring-offset-2 ring-offset-background";

/**
 * The palette as a row of swatches, one checked. `none` puts a swatch for no colour first; `swatchLabel` names
 * each swatch to a reader, so two rows of one window tell their swatches apart.
 */
export function ColorSwatchPicker({
  value,
  onChange,
  label = "Color",
  swatchLabel = (name) => name,
  none,
}: {
  value: string | undefined;
  onChange: (color: string) => void;
  label?: string;
  swatchLabel?: (name: string) => string;
  /** The no-colour swatch, checked while `value` is absent; absent — a colour is always chosen. */
  none?: { readonly label: string; readonly onPick: () => void };
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
      {none === undefined ? null : (
        <button
          type="button"
          role="radio"
          aria-checked={value === undefined}
          aria-label={none.label}
          title={none.label}
          onClick={none.onPick}
          className={cn(SWATCH, "inline-flex items-center justify-center border border-border text-muted-foreground", value === undefined && CHECKED)}
        >
          <Icon name="X" className="size-3" aria-hidden />
        </button>
      )}
      {COLOR_PALETTE.map((swatch) => (
        <button
          key={swatch.value}
          type="button"
          role="radio"
          aria-checked={value === swatch.value}
          aria-label={swatchLabel(swatch.label)}
          title={swatch.label}
          onClick={() => onChange(swatch.value)}
          className={cn(SWATCH, isEdgeless(swatch.value) && "border border-border", value === swatch.value && CHECKED)}
          style={{ backgroundColor: swatch.value }}
        />
      ))}
    </div>
  );
}
