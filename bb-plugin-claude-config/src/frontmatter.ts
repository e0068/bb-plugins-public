// Разбор и сборка YAML-фронтматера markdown-файлов (навыки, агенты, память).
// Чистый слой без ввода-вывода: DocTab показывает поля таблицей и правит их,
// сериализация возвращает файл байт-в-байт при отсутствии правок.

// Запись блока фронтматера: либо поле верхнего уровня `key: value`, либо строка,
// которую мы не тронули (комментарий, отступ вложенного значения, пустая) —
// её сохраняем дословно ради точного round-trip.
export type FrontmatterEntry =
  | { kind: "field"; key: string; value: string }
  | { kind: "raw"; text: string };

export type ParsedFrontmatter = {
  hasFrontmatter: boolean;
  entries: FrontmatterEntry[];
  body: string;
};

// Строка поля: ключ с начала строки (без отступа), двоеточие, затем значение
// после одного пробела/таба. Отступ или отсутствие пробела → это не поле
// верхнего уровня (вложенное значение или `key:value`), оставляем как raw.
const FIELD_RE = /^([A-Za-z0-9_][A-Za-z0-9_-]*):(?:[ \t](.*))?$/;

export function parseFrontmatter(content: string): ParsedFrontmatter {
  const lines = content.split("\n");
  if (lines[0] !== "---") {
    return { hasFrontmatter: false, entries: [], body: content };
  }
  // Закрывающий разделитель — первая строка «---» после открывающей.
  const end = lines.indexOf("---", 1);
  if (end === -1) {
    return { hasFrontmatter: false, entries: [], body: content };
  }
  const entries: FrontmatterEntry[] = lines.slice(1, end).map((line) => {
    const match = FIELD_RE.exec(line);
    return match
      ? { kind: "field", key: match[1], value: match[2] ?? "" }
      : { kind: "raw", text: line };
  });
  const body = lines.slice(end + 1).join("\n");
  return { hasFrontmatter: true, entries, body };
}

export function serializeFrontmatter(
  entries: FrontmatterEntry[],
  body: string,
): string {
  const block = entries.map((entry) =>
    entry.kind === "field"
      ? entry.value === ""
        ? `${entry.key}:`
        : `${entry.key}: ${entry.value}`
      : entry.text,
  );
  return ["---", ...block, "---", body].join("\n");
}

// «Фронтматер» плагина — это его JSON-манифест (plugin.json). Разбираем поля
// верхнего уровня в те же записи, что и YAML: примитивы как строка, объекты и
// массивы — компактным JSON. Невалидный JSON или не-объект → пусто.
export function fieldsFromJson(text: string): FrontmatterEntry[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return [];
  }
  return Object.entries(parsed as Record<string, unknown>).map(
    ([key, value]) => ({
      kind: "field" as const,
      key,
      value:
        typeof value === "string"
          ? value
          : typeof value === "number" || typeof value === "boolean"
            ? String(value)
            : JSON.stringify(value),
    }),
  );
}

// Замена значения i-го поля — чистая, возвращает новый массив (для setState).
export function setFieldValue(
  entries: FrontmatterEntry[],
  index: number,
  value: string,
): FrontmatterEntry[] {
  return entries.map((entry, i) =>
    i === index && entry.kind === "field" ? { ...entry, value } : entry,
  );
}
