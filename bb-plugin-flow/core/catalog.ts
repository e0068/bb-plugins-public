// Разбор файлов, из которых собирается каталог исполнителей этапа: агент Claude
// Code — markdown с фронтматтером, сохранённый workflow — скрипт с
// `export const meta`. Чистые функции над текстом файла; читает диск сервер.
import type { StageExecutor } from "../shared/contract";

/** Поставщик агентов из `~/.claude/agents` — по нему виджет берёт иконку. */
export const CLAUDE_CODE_PROVIDER = "claude-code";

const frontmatter = (text: string): Record<string, string> | null => {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (match === null) return null;
  return Object.fromEntries(
    (match[1] ?? "").split(/\r?\n/).flatMap((line) => {
      const pair = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
      return pair === null ? [] : [[pair[1]!, (pair[2] ?? "").trim()]];
    }),
  );
};

const optional = (key: string, value: string | undefined): Record<string, string> => (value === undefined || value === "" ? {} : { [key]: value });

/** Агент из фронтматтера: без имени — не агент. */
export const parseAgentFile = (text: string): StageExecutor | null => {
  const fields = frontmatter(text);
  const name = fields?.name;
  if (fields === null || name === undefined || name === "") return null;
  return { id: `agent:${name}`, kind: "agent", name, ...optional("description", fields.description), ...optional("model", fields.model), provider: CLAUDE_CODE_PROVIDER };
};

const metaField = (meta: string, key: string): string | undefined => new RegExp(`\\b${key}\\s*:\\s*(["'\`])((?:\\\\.|(?!\\1).)*)\\1`).exec(meta)?.[2];

/** Workflow из `export const meta = { name, description }`: без имени — не workflow. */
export const parseWorkflowFile = (text: string): StageExecutor | null => {
  const meta = /export\s+const\s+meta\s*=\s*\{([\s\S]*?)\n?\}/.exec(text)?.[1];
  const name = meta === undefined ? undefined : metaField(meta, "name");
  if (meta === undefined || name === undefined || name === "") return null;
  return { id: `workflow:${name}`, kind: "workflow", name, ...optional("description", metaField(meta, "description")) };
};
