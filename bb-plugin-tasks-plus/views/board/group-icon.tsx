import type { Label, Task, TaskStatus } from "../../shared/contract.js";
import type { BoardGroupProperty } from "../../shared/enums.js";
import { Icon } from "@/components/ui/icon";
import { TYPE_ICONS } from "../../components/task-meta.js";
import { NONE_KEY } from "./grouping.js";
import { PriorityIcon, StatusIcon } from "./icons.js";

/**
 * The icon a group carries for the value it stands for — a board column's
 * header and a table group's alike: the status ring, the priority bars, the
 * type's glyph, the estimate's timer, a label's color dot. An epic, an
 * assignee and the group for no value carry none.
 */
export function GroupIcon({ groupBy, groupKey, labels }: {
  groupBy: BoardGroupProperty;
  groupKey: string;
  labels: readonly Label[];
}) {
  switch (groupBy) {
    case "status":
      return <StatusIcon status={groupKey as TaskStatus} />;
    case "priority":
      return <PriorityIcon priority={groupKey as Task["priority"]} />;
    case "type":
      return groupKey === NONE_KEY ? null : (
        <Icon name={TYPE_ICONS[groupKey as NonNullable<Task["type"]>]} className="size-3.5 shrink-0" />
      );
    case "estimate":
      return groupKey === NONE_KEY ? null : <Icon name="Timer" className="size-3.5 shrink-0" />;
    case "label": {
      const color = labels.find((label) => label.name === groupKey)?.color;
      return color ? <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ backgroundColor: color }} /> : null;
    }
    case "epic":
    case "assignee":
      return null;
  }
}
