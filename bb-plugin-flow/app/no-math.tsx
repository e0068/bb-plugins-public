// Обёртка вставки плагина в ленте, которую плагины формул не трогают. Такой
// плагин (bb-better-latex) верстает формулой всё между двумя «$» в сообщении
// и склеивает для этого текст соседних элементов: в брифе цены «$6» и маски
// «$» сливались в курсив, а замена узлов под React ломала карточку. Элемент
// samp стоит в списке пропусков таких плагинов, как pre и code; display:
// contents не даёт ему своей коробки, шрифт наследуется, а не моноширинный.
import type { ReactNode } from "react";

export function NoMath({ children }: { children: ReactNode }) {
  return (
    <samp className="contents" style={{ font: "inherit" }}>
      {children}
    </samp>
  );
}
