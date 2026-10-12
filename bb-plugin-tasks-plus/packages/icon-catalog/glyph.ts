/** Глиф иконки в форме Hugeicons (IconSvgElement): узлы SVG — тег и атрибуты. Описан здесь, чтобы пакет не зависел
 *  от установленного @hugeicons/react ни в сборке, ни в проверке типов; HugeiconsIcon принимает его как есть. */
export type Glyph = readonly (readonly [string, { readonly [key: string]: string | number }])[];
