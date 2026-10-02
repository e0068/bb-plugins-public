// Значок этапа: иконка, выбранная владельцем из подборки Hugeicons, а без неё — иконка по виду этапа.
// Один на таблицу этапов, бриф и полосу прогресса.
import { HugeiconsIcon } from "@hugeicons/react";

import { Icon } from "../components/ui/icon";
import { STAGE_ICONS } from "../components/ui/stage-icon-catalog";

/** `icon` — имя из подборки; нет его или имя вне подборки — `fallback`, иконка по виду. */
export function StageGlyph({ icon, fallback, className }: { icon: string | undefined; fallback: string; className?: string }) {
  const own = icon === undefined ? undefined : STAGE_ICONS.get(icon);
  return own === undefined ? <Icon name={fallback} aria-hidden="true" className={className} /> : <HugeiconsIcon icon={own} aria-hidden="true" className={className} data-icon={icon} />;
}

/** Есть ли у этапа своя иконка из подборки: тогда она стоит вместо иконки вида и логотипа исполнителя. */
export const hasOwnIcon = (icon: string | undefined): icon is string => icon !== undefined && STAGE_ICONS.has(icon);
