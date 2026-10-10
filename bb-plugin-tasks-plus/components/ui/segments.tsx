import { cn } from "../../lib/utils";

export interface SegmentsProps<T extends string> {
  label: string;
  value: T;
  /** `short` stands in for the label in a narrow container — the label stays the button's name. */
  options: readonly { value: T; label: string; short?: string }[];
  onChange: (value: T) => void;
  /** Where the control sits in its row: its width and margins. */
  className?: string;
}

/**
 * A segmented control, as Display's Table/Board switch: the segments on a
 * muted plate, the picked one in the page's background.
 */
export function Segments<T extends string>({ label, value, options, onChange, className }: SegmentsProps<T>) {
  return (
    <div role="group" aria-label={label} className={cn("flex min-w-0 rounded-md bg-muted p-0.5", className)}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          aria-label={option.short === undefined ? undefined : option.label}
          onClick={() => onChange(option.value)}
          className={cn(
            "flex h-6 flex-1 items-center justify-center rounded-sm px-1.5 text-xs whitespace-nowrap",
            value === option.value ? "bg-background text-foreground shadow-2xs" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {option.short === undefined ? (
            option.label
          ) : (
            <>
              <span className="@xl:hidden">{option.short}</span>
              <span className="hidden @xl:inline">{option.label}</span>
            </>
          )}
        </button>
      ))}
    </div>
  );
}
