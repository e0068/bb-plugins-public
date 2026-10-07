// Один значок flow на весь фронт: иконка, выбранная владельцем из подборки этапов, а без неё — знак плагина.
// «Без flow» — знак плагина перечёркнутый: своя иконка его не заменяет.
import { FlowMark } from "../components/ui/flow-mark";
import { hasOwnIcon, StageGlyph } from "./stage-glyph";

export function FlowGlyph({ icon, crossed, className }: { icon?: string; crossed?: boolean; className?: string }) {
  // Иконка из подборки есть наверняка, `fallback` не используется.
  return hasOwnIcon(icon) && !crossed ? <StageGlyph icon={icon} fallback="" className={className} /> : <FlowMark crossed={crossed ?? false} className={className} />;
}
