// Ядро — чисто. Из чего состоит этап-виджет: навык вида, файлы кода по ролям и адрес страницы виджета в панели Flow.
// Пути — от корня плагина; тест рядом роняет прогон, если файл из состава исчез. Страница показывает состав, а сервер
// отдаёт просмотрщику bb только пути отсюда.
import { BUILTIN_KINDS, BUILTIN_SKILLS, type BuiltinKind } from "../lib/stage-constants";

/** Роли файлов виджета в порядке, в котором их показывает страница. */
export const WIDGET_ROLES = ["schema", "rules", "tool", "card", "tests"] as const;

export type WidgetRole = (typeof WIDGET_ROLES)[number];

export type WidgetRoleFiles = { role: WidgetRole; files: readonly string[] };

const CONTRACT = "shared/contract.ts";
const ASK_TOOL = "server/ask-tool.ts";
const BRIEF_CARD = "app/brief-card.tsx";

/** Файлы кода по ролям; Выбор этапов и Definition of Done живут в той же карточке брифа, что и Вопросы. */
const FILES: Record<BuiltinKind, Record<WidgetRole, readonly string[]>> = {
  questions: {
    schema: [CONTRACT],
    rules: ["core/clarify.ts", "core/required.ts", "core/option-criteria.ts"],
    tool: [ASK_TOOL],
    card: [BRIEF_CARD, "app/widget.tsx", "app/draft.ts"],
    tests: ["server/ask-tool-kinds.test.ts", "app/brief-card.test.tsx", "app/clarify-questions.test.tsx"],
  },
  criteria: {
    schema: [CONTRACT],
    rules: ["core/option-criteria.ts", "core/budget.ts"],
    tool: [ASK_TOOL],
    card: [BRIEF_CARD],
    tests: ["server/ask-tool-criteria-launched.test.ts", "app/brief-card-criteria.test.tsx"],
  },
  select: {
    schema: [CONTRACT],
    rules: ["core/stages.ts", "core/stage-execution.ts", "core/budget.ts"],
    tool: [ASK_TOOL],
    card: [BRIEF_CARD],
    tests: ["server/ask-tool-stages.test.ts", "app/brief-card-setup.test.tsx"],
  },
  demo: {
    schema: [CONTRACT],
    rules: ["core/outcome.ts", "core/answer-message.ts"],
    tool: [ASK_TOOL],
    card: ["app/outcome.tsx", BRIEF_CARD],
    tests: ["server/ask-tool-demo.test.ts", "app/demo-card.test.tsx"],
  },
  approve: {
    schema: [CONTRACT],
    rules: ["core/approval-guard.ts", "core/answer-message.ts"],
    tool: [ASK_TOOL],
    card: ["app/outcome.tsx"],
    tests: ["server/ask-tool-approve.test.ts", "app/approve-card.test.tsx"],
  },
};

/** Файлы кода вида по ролям — в порядке `WIDGET_ROLES`. */
export const anatomyOf = (kind: BuiltinKind): readonly WidgetRoleFiles[] => WIDGET_ROLES.map((role) => ({ role, files: FILES[kind][role] }));

/** Файлы навыка вида в папке навыков плагина: `SKILL.md` и его русская версия. */
export const widgetSkillFiles = (kind: BuiltinKind): readonly [string, string] => [`skills/${BUILTIN_SKILLS[kind]}/SKILL.md`, `skills/${BUILTIN_SKILLS[kind]}/ru.md`];

/** Все файлы, которые страница виджета вправе открыть. */
export const allowedWidgetFiles = (): ReadonlySet<string> => new Set(BUILTIN_KINDS.flatMap((kind) => [...anatomyOf(kind).flatMap((r) => r.files), ...widgetSkillFiles(kind)]));

const SUB_PATH_PREFIX = "widget-";

/** Адрес страницы виджета вида `kind` в панели Flow — хвост адреса, как id flow. */
export const widgetSubPath = (kind: BuiltinKind): string => `${SUB_PATH_PREFIX}${kind}`;

/** Вид виджета по хвосту адреса панели; всё, что не адрес вида, — `null`. */
export const widgetKindOf = (subPath: string): BuiltinKind | null => BUILTIN_KINDS.find((kind) => widgetSubPath(kind) === subPath) ?? null;

/** Корень плагина по файлу его навыка `<корень>/skills/<имя>/SKILL.md`; путь другой формы — `null`. */
export const pluginRootOf = (skillFilePath: string, skillName: string): string | null => {
  const tail = `/skills/${skillName}/SKILL.md`;
  return skillFilePath.endsWith(tail) ? skillFilePath.slice(0, -tail.length) : null;
};
