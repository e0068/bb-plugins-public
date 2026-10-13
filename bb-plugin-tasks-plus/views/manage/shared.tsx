import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

export { COLOR_PALETTE, DEFAULT_COLOR } from "@/lib/color-palette";
export { ColorSwatchPicker } from "@/components/color-swatches";

/** Mirrors the contract's project prefix rule (shared/contract.ts). */
export const PROJECT_PREFIX_PATTERN = /^[A-Z][A-Z0-9]{0,9}$/;

/** What is wrong with a prefix typed for a board, or null: the rule, then a clash with another board. */
export function prefixProblem(
  prefix: string,
  boards: ReadonlyArray<{ id: string; name: string; prefix: string }>,
  ownId: string | null,
): string | null {
  if (!PROJECT_PREFIX_PATTERN.test(prefix)) {
    return "Use 1–10 uppercase letters and digits, starting with a letter.";
  }
  const clash = boards.find(
    (board) => board.id !== ownId && board.prefix.toUpperCase() === prefix.toUpperCase(),
  );
  return clash ? `Already used by ${clash.name}.` : null;
}

/** Compact labeled checkbox (no checkbox component is vendored yet). */
export function CheckboxField({
  checked,
  onCheckedChange,
  label,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      onClick={() => onCheckedChange(!checked)}
      className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground"
    >
      <span
        className={cn(
          "flex size-3.5 items-center justify-center rounded-sm border",
          checked
            ? "border-primary bg-primary text-primary-foreground"
            : "border-input",
        )}
      >
        {checked ? <Icon name="Check" className="size-3" /> : null}
      </span>
      {label}
    </button>
  );
}

export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className="space-y-1.5">
      <label className="block text-xs font-medium text-muted-foreground">
        {label}
      </label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/** "1 task", "3 tasks". */
export const taskCountText = (count: number): string => `${count} task${count === 1 ? "" : "s"}`;
