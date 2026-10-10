// Поиск по `/` и `@` в полях Flow, как в композере треда: какое слово у курсора открывает список, что встаёт в текст
// на его место и как список сужается по набранному. Чисто: текст и курсор — аргументы.

export type MentionTrigger = "/" | "@";

/** Слово со знаком у курсора: знак, набранное после него до курсора и где знак стоит в тексте. */
export type MentionToken = { trigger: MentionTrigger; query: string; start: number };

/**
 * Запрос после знака. После `/` — имя навыка или команды, поэтому вторая косая черта делает слово путём, а не
 * поиском; после `@` — путь, в нём косые черты свои.
 */
const QUERY: Record<MentionTrigger, RegExp> = { "/": /^[^\s/]*$/, "@": /^\S*$/ };

const isTrigger = (char: string | undefined): char is MentionTrigger => char === "/" || char === "@";

/** Слово от начала поля или пробела до курсора, если оно начинается знаком; иначе — `null`. */
export const mentionAt = (text: string, caret: number): MentionToken | null => {
  if (caret < 1 || caret > text.length) return null;
  const head = text.slice(0, caret);
  const start = head.search(/\S*$/);
  const trigger = head[start];
  const query = head.slice(start + 1);
  return isTrigger(trigger) && QUERY[trigger].test(query) ? { trigger, query, start } : null;
};

/** Набранное слово сменяется знаком, значением и пробелом — пробел, уже стоящий за словом, не удваивается; курсор — за пробелом. */
export const applyMention = (text: string, token: MentionToken, value: string): { text: string; caret: number } => {
  const end = token.start + 1 + token.query.length;
  const rest = text.slice(end);
  const inserted = `${token.trigger}${value}${/^\s/.test(rest) ? "" : " "}`;
  return { text: text.slice(0, token.start) + inserted + rest, caret: token.start + `${token.trigger}${value} `.length };
};

/** Имена с запросом без учёта регистра: начинающиеся с него — первыми, порядок внутри групп исходный; не больше `limit`. */
export const rankByName = <T extends { name: string }>(items: readonly T[], query: string, limit: number): T[] => {
  const q = query.toLowerCase();
  const at = (item: T) => item.name.toLowerCase().indexOf(q);
  const found = items.filter((item) => at(item) >= 0);
  return [...found.filter((item) => at(item) === 0), ...found.filter((item) => at(item) > 0)].slice(0, limit);
};
