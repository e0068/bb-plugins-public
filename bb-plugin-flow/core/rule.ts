// Правило, которое агент предлагает записать в память или навык: куда можно писать, что именно
// ляжет в файл после правки владельцем и как это показать. Чистые функции — их зовут и сервер,
// и виджет; пути разбираются строкой, без node:path, потому что ядро едет и во фронт.
import type { ProposeRuleParams, RuleKind, RuleRecord } from "../shared/contract";

/** Оглавление памяти лежит рядом с её файлами. */
export const MEMORY_INDEX = "MEMORY.md";

const segmentsOf = (path: string): string[] => path.split("/").slice(1);

const clean = (path: string): boolean => path.startsWith("/") && segmentsOf(path).every((s) => s !== "" && s !== "." && s !== "..");

/**
 * Почему в этот файл писать нельзя, или `null`. Память — файл `.md` в `~/.claude/projects/<проект>/memory/`;
 * навык — файл `.md` внутри папки навыка `…/skills/<имя>/` в домашней папке. Остальное плагин не трогает.
 */
export const ruleTargetIssue = (target: { kind: RuleKind; path: string }, home: string): string | null => {
  const { kind, path } = target;
  if (!clean(path) || !clean(home)) return `"${path}" is not a clean absolute path`;
  if (!path.endsWith(".md")) return `"${path}" is not a .md file`;
  if (!path.startsWith(`${home}/`)) return `"${path}" is outside the home folder`;
  const rest = segmentsOf(path).slice(segmentsOf(home).length);
  if (kind === "memory") {
    const ok = rest[0] === ".claude" && rest[1] === "projects" && rest[3] === "memory" && rest.length >= 5;
    return ok ? null : `a memory rule goes into ~/.claude/projects/<project>/memory/, not "${path}"`;
  }
  const skills = rest.indexOf("skills");
  return skills >= 0 && rest.length - skills >= 3 ? null : `a skill rule goes into a file inside …/skills/<name>/, not "${path}"`;
};

export const memoryIndexOf = (path: string): string => `${path.slice(0, path.lastIndexOf("/"))}/${MEMORY_INDEX}`;

/** Что не так с предложением, кроме состояния файлов на диске; пусто — можно показывать владельцу. */
export const proposalIssues = (params: ProposeRuleParams, home: string): string[] => [
  ...[ruleTargetIssue(params.target, home)].filter((issue): issue is string => issue !== null),
  ...params.similar.filter((place) => !clean(place.path)).map((place) => `similar "${place.path}" is not a clean absolute path`),
  ...(params.content.includes(params.text) ? [] : ["content must hold text verbatim: the owner's edit of the rule replaces it there"]),
  ...(params.index !== undefined && (params.target.kind !== "memory" || params.mode !== "create") ? ["index is only for a new memory file"] : []),
  ...(params.mode === "replace" && (params.replaces ?? "").trim() === "" ? ["mode replace needs replaces: the exact fragment of the file the rule replaces"] : []),
  ...(params.mode !== "replace" && params.replaces !== undefined ? ["replaces is only for mode replace"] : []),
  ...(params.target.kind === "memory" && params.target.path.endsWith(`/${MEMORY_INDEX}`) ? [`${MEMORY_INDEX} is the index: propose a memory file and its line in index`] : []),
];

/** Текст и оглавление после правки владельцем: текст правила заменяется везде, где агент его поставил. */
export const editedRule = (rule: Pick<RuleRecord, "text" | "content" | "index">, edited: string): { content: string; index: string | undefined } => {
  const swap = (source: string) => source.split(rule.text).join(edited);
  return { content: swap(rule.content), index: rule.index === undefined ? undefined : swap(rule.index) };
};

/** Конец существующего файла: дописанное встаёт с новой строки и само кончается переводом строки. */
export const appended = (existing: string, addition: string): string => `${existing}${existing === "" || existing.endsWith("\n") ? "" : "\n"}${addition.endsWith("\n") ? addition : `${addition}\n`}`;

/** Сколько раз кусок стоит в тексте, не считая наложений; пустой кусок — ни разу. */
export const occurrences = (source: string, fragment: string): number => (fragment === "" ? 0 : source.split(fragment).length - 1);

/**
 * Файл после замены куска: кусок, который встречается не ровно один раз, — `null`, заменять нечего или неясно что.
 * Кусок кончался переводом строки — им кончается и замена, чтобы следующая строка не прилипла к правилу.
 */
export const replaced = (existing: string, fragment: string, content: string): string | null => {
  if (occurrences(existing, fragment) !== 1) return null;
  const at = existing.indexOf(fragment);
  const tail = fragment.endsWith("\n") && !content.endsWith("\n") ? "\n" : "";
  return `${existing.slice(0, at)}${content}${tail}${existing.slice(at + fragment.length)}`;
};

const linesOf = (text: string): string[] => text.replace(/\n$/, "").split("\n");

/** Изменение файла: `removed` — строки, которые уйдут, `lines` — строки, которые встанут; `isNew` — файла ещё нет. */
export type RuleDiffFile = { path: string; isNew: boolean; removed: string[]; lines: string[] };

/** Что изменится — по файлу: сам файл правила (у замены — и что уйдёт) и строка оглавления у нового файла памяти. */
export const ruleDiff = (rule: Pick<RuleRecord, "target" | "mode" | "content"> & { index?: string | undefined; replaces?: string | undefined }): RuleDiffFile[] => [
  { path: rule.target.path, isNew: rule.mode === "create", removed: rule.mode === "replace" && rule.replaces !== undefined ? linesOf(rule.replaces) : [], lines: linesOf(rule.content) },
  ...(rule.index === undefined ? [] : [{ path: memoryIndexOf(rule.target.path), isNew: false, removed: [], lines: [rule.index] }]),
];

export const fileNameOf = (path: string): string => path.slice(path.lastIndexOf("/") + 1);

/** Имя навыка — папка сразу под `skills`; вне папки навыка — `undefined`. */
export const skillNameOf = (path: string): string | undefined => {
  const segments = segmentsOf(path);
  const at = segments.lastIndexOf("skills");
  return at >= 0 && at + 2 < segments.length ? segments[at + 1] : undefined;
};

/** Подпись файла в виджете: у навыка его папка и путь внутри — файл любого навыка зовётся SKILL.md; у памяти — имя файла. */
export const placeLabelOf = (path: string): string => {
  const name = skillNameOf(path);
  return name === undefined ? fileNameOf(path) : path.slice(path.lastIndexOf(`/skills/${name}/`) + "/skills/".length);
};
