// Слой 1 — чисто. Мерцание идущей работы, одно на строку треда и полосу этапов:
// приглушённое, чтобы не тянуть внимание, — пик на треть тусклее полной яркости,
// и полной яркости нет даже между циклами.

export const MUTED_BLINK = "flow-blink";

export const mutedBlinkKeyframes = `@keyframes ${MUTED_BLINK}{0%,100%{opacity:.67}50%{opacity:.3}}`;

/** Значение `animation` мерцающего элемента. */
export const mutedBlinkAnimation = `${MUTED_BLINK} 1.6s ease-in-out infinite`;
