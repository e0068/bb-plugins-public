// Знак плагина из assets/icon.svg, но цветом текста: в интерфейсе он рисуется
// svg, а не маской. Один на все места, где речь о самом flow: кнопка и меню
// композера, строка выбора над композером, «Отменить flow». Перечёркнутый —
// «без flow».
import { cn } from "../../lib/utils";

export function FlowMark({ crossed, className }: { crossed: boolean; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      data-flow-mark={crossed ? "crossed" : "plain"}
      className={cn("size-4 shrink-0", className)}
    >
      <path d="M6 2.25h7.25a4.25 4.25 0 0 1 0 8.5h-2.5a4.25 4.25 0 0 0 0 8.5H17" />
      <path d="M14 16.25l3 3-3 3" />
      {crossed && <path d="M3 3l18 18" />}
    </svg>
  );
}
