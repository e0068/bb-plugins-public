// Бирка части брифа: иконка вида и подпись мелко, без подложки — вместо заголовков,
// которые повторяли бы бриф. Вид — встроенный вид этапа или уточнение.
import { Icon } from "../components/ui/icon";
import type { BuiltinKind } from "../lib/stage-constants";
import { useMessages } from "./locale-context";
import { KIND_ICONS } from "./stage-icons";

export type TagKind = BuiltinKind | "clarify";

const CLARIFY_ICON = "CircleQuestion";

export function SectionTag({ kind, extra, className }: { kind: TagKind; extra?: string | undefined; className?: string }) {
  const t = useMessages();
  const label = kind === "clarify" ? t.brief.clarify : t.stages[kind];
  return (
    <div data-section-tag className={`flex min-w-0 items-center gap-1.5 text-[11px] leading-none text-muted-foreground ${className ?? ""}`}>
      <Icon name={kind === "clarify" ? CLARIFY_ICON : KIND_ICONS[kind]} aria-hidden="true" className="size-3 shrink-0" />
      <span className="truncate">
        <span>{label}</span>
        {extra !== undefined && (
          <>
            {" · "}
            <span>{extra}</span>
          </>
        )}
      </span>
    </div>
  );
}
