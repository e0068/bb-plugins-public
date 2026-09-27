// Шапка markdown-файла — поля между `---` в его начале. Её читают и файлы
// агентов каталога исполнителей, и файлы задач; разбор один на обоих.

type Field = readonly [string, string];

/**
 * Строка шапки: новое поле, либо продолжение длинного значения предыдущего — строка с отступом, которой
 * YAML переносит длинное значение. Пункты списка под пустым полем продолжением не считаются.
 */
const fieldLine = (fields: readonly Field[], line: string): readonly Field[] => {
  const pair = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
  if (pair !== null) return [...fields, [pair[1]!, (pair[2] ?? "").trim()]];
  const last = fields[fields.length - 1];
  return last !== undefined && last[1] !== "" && /^\s+\S/.test(line) ? [...fields.slice(0, -1), [last[0], `${last[1]} ${line.trim()}`]] : fields;
};

/** Поля шапки строками; шапки в начале файла нет — `null`. */
export const frontmatter = (text: string): Record<string, string> | null => {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  return match === null ? null : Object.fromEntries((match[1] ?? "").split(/\r?\n/).reduce(fieldLine, []));
};
