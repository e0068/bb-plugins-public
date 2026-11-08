/**
 * Директива задачи посреди текста. bb узнаёт `::task{key="…"}` только
 * отдельной строкой; посреди фразы она остаётся текстом, и чипом её ставит
 * сам Tasks+ (views/embed/inline-chips.tsx). Здесь — только разбор строки.
 */
export type InlineTaskDirective = {
  /** Начало директивы в строке, включительно. */
  readonly start: number;
  /** Конец директивы в строке, не включительно. */
  readonly end: number;
  /** Адрес задачи: ключ доски или слаг файла. */
  readonly key: string;
};

const DIRECTIVE = /::task\{([^{}\n]*)\}/g;
const KEY_ATTRIBUTE = /(?:^|\s)key=(?:"([^"]*)"|'([^']*)'|([^\s"']+))/;

/** Адрес из атрибутов директивы; пустой или с пробелом задачу не называет. */
const keyOf = (attributes: string): string | null => {
  const match = KEY_ATTRIBUTE.exec(attributes);
  const key = (match?.[1] ?? match?.[2] ?? match?.[3] ?? "").trim();
  return key === "" || /\s/.test(key) ? null : key;
};

const TASK_HREF = /^bb:\/\/tasks\/([^\s/]+)$/;

/**
 * Адрес задачи из ссылки `[SSS-40](bb://tasks/SSS-40)`. Так агент ссылается на
 * задачу там, где директива не рисуется, — в тексте карточки виджета; чужой
 * плагин открыть задачу Tasks+ не может, клик перехватывает Tasks+
 * (views/embed/inline-chips.tsx). Любой другой адрес задачу не называет.
 */
export const taskKeyOfHref = (href: string): string | null =>
  TASK_HREF.exec(href.trim().replace(/^<(.+)>$/, "$1"))?.[1] ?? null;

/** Все директивы задач строки по порядку; директива без адреса пропускается. */
export const findInlineTaskDirectives = (text: string): readonly InlineTaskDirective[] =>
  [...text.matchAll(DIRECTIVE)].flatMap((match) => {
    const key = keyOf(match[1] ?? "");
    return key === null ? [] : [{ start: match.index, end: match.index + match[0].length, key }];
  });
