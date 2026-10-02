// Сегмент-контрол дизайн-системы (./packages/segmented-control) в меню
// исполнения: `wide` растягивает его на всю ширину меню и поднимает текст до
// 12 px — подписи читаются как пункты меню под ним. Вид пакета лежит в его CSS
// без слоя, а утилиты Tailwind — в слое utilities, поэтому правка размера идёт
// с `!`: без него стиль пакета перебил бы её.
import { SegmentedControl, type SegmentedControlOption } from "@bb-plugins/segmented-control";

import { cn } from "../lib/utils";
import { tabsKit } from "./tabs-kit";

const WIDE = "[&_.sgc-track]:w-full! [&_.sgc-segment]:flex-1! [&_.sgc-segment]:px-2! [&_.sgc-segment]:py-1! [&_.sgc-segment]:text-xs!";

export function Segmented<T extends string>(props: { label: string; value: T; onChange: (next: T) => void; options: readonly SegmentedControlOption<T>[]; wide?: boolean }) {
  return (
    <div className={cn("min-w-0", props.wide === true && WIDE)}>
      <SegmentedControl tabs={tabsKit} aria-label={props.label} value={props.value} onChange={props.onChange} options={props.options} />
    </div>
  );
}
