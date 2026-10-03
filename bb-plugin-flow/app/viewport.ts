// Оболочка над `core/viewport`: дописывает тегу viewport страницы bb предел масштаба с загрузки плагина до перезагрузки страницы —
// у плагина нет выгрузки, поэтому и выключенный на ходу плагин снимает запрет только перезагрузкой —
// и iPhone перестаёт приближать тред, когда каретка встаёт в любое поле. Почему вся страница, а не поля Flow, —
// docs/decisions/flow-viewport-no-autozoom.md.
import { withoutAutoZoom } from "../core/viewport";

/** Тег без предела получает его; тега нет — страница не трогается. */
export const lockAutoZoom = (doc: Document): void => {
  const meta = doc.querySelector<HTMLMetaElement>('meta[name="viewport"]');
  if (meta !== null) meta.content = withoutAutoZoom(meta.content);
};
