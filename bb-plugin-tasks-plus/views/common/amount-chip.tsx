import { Icon, type IconName } from "@/components/ui/icon";
import {
  formatDollars,
  formatMinutes,
  type AmountField,
} from "../../shared/amounts.js";

const AMOUNT_CHIPS: Record<
  AmountField,
  { icon: IconName; label: string; format: (value: number) => string }
> = {
  plannedMinutes: { icon: "Timer", label: "Planned Time", format: formatMinutes },
  actualMinutes: { icon: "StopWatch", label: "Actual Time", format: formatMinutes },
  budget: { icon: "DollarCircle", label: "Budget", format: formatDollars },
  budgetLimit: { icon: "MoneyBag", label: "Limit", format: formatDollars },
  cost: { icon: "Coins", label: "Cost", format: formatDollars },
};

/** One time/money field as a chip; the list row and the board card pass their own pill class. */
export function AmountChip({
  field,
  value,
  className,
}: {
  field: AmountField;
  value: number;
  className: string;
}) {
  const { icon, label, format } = AMOUNT_CHIPS[field];
  return (
    <span title={`${label}: ${format(value)}`} className={`${className} tabular-nums`}>
      <Icon name={icon} className="size-3 shrink-0" />
      {format(value)}
    </span>
  );
}
