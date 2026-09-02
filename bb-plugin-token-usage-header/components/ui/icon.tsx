import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import { AlertCircleIcon, ChartColumnIcon, GitCommitIcon, GitMergeIcon, GitPullRequestIcon, Upload01Icon } from "@hugeicons/core-free-icons";
import { cn } from "../../lib/utils";

// Trimmed to the icons this plugin actually uses (the header button's own
// two, plus one per git-event marker kind on the chart — see
// pages/thread-chart.tsx's GIT_EVENT_ICON) — the shared design-system Icon
// component vendors the full set; this plugin needs neither the rest of the
// map nor its custom inline glyphs.
const ICON_MAP = {
  AlertCircle: AlertCircleIcon,
  ChartColumn: ChartColumnIcon,
  GitCommit: GitCommitIcon,
  GitPullRequest: GitPullRequestIcon,
  GitMerge: GitMergeIcon,
  Upload: Upload01Icon,
} as const satisfies Record<string, IconSvgElement>;

export type IconName = keyof typeof ICON_MAP;

export const ICON_NAMES = Object.keys(ICON_MAP) as readonly IconName[];

export interface IconProps {
  name: IconName;
  className?: string;
  "aria-hidden"?: boolean | "true" | "false";
  "aria-label"?: string;
}

export function Icon({
  name,
  className,
  "aria-hidden": ariaHidden,
  "aria-label": ariaLabel,
}: IconProps) {
  return (
    <HugeiconsIcon
      icon={ICON_MAP[name]}
      className={cn(className)}
      aria-hidden={ariaHidden}
      aria-label={ariaLabel}
      data-icon={name}
    />
  );
}
