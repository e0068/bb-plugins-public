// Чекбокс этапа «в прогоне» — один вид в прогресс-баре и в таблице этапов брифа.
import { Icon } from "../components/ui/icon";
import { cn } from "../lib/utils";

/**
 * В прогоне — контрастный квадрат с галочкой в цветах кнопки «Отправить», убранный — серый пустой, `"mixed"` — контрастный с чертой:
 * в прогоне часть этапов группы, щелчок ставит все. Без `onToggle` — тот же квадрат без нажатия.
 * Галочка красится цветом текста основной кнопки: `--background` у bb светлеет вместе с квадратом, и галочка на нём пропадала.
 */
export function StageCheckbox({ inRun, label, disabled = false, onToggle }: { inRun: boolean | "mixed"; label: string; disabled?: boolean; onToggle: ((run: boolean) => void) | null }) {
  const box = (
    <span aria-hidden="true" className={cn("flex size-3.5 items-center justify-center rounded-[3px]", inRun !== false ? "bg-primary text-primary-foreground" : "border border-border bg-state-active")}>
      {inRun === true && <Icon name="Check" className="size-2.5" />}
      {inRun === "mixed" && <span className="h-0.5 w-2 rounded-full bg-current" />}
    </span>
  );
  if (onToggle === null)
    return (
      <span role="checkbox" aria-checked={inRun} aria-disabled="true" aria-label={label} className="flex size-5 items-center justify-center">
        {box}
      </span>
    );
  return (
    <button type="button" role="checkbox" aria-checked={inRun} aria-label={label} disabled={disabled} onClick={() => onToggle(inRun !== true)} className="flex size-5 items-center justify-center rounded enabled:hover:bg-state-hover disabled:cursor-default">
      {box}
    </button>
  );
}
