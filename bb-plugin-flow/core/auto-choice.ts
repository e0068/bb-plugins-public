// Слой 1 — чисто. Выбор flow треду с «Автоматически» до хода его агента (../server/auto-choice.ts): вход модели —
// правила навыка flow-choose, «Без flow» и flow владельца с описаниями «когда выбирать», сообщение владельца, —
// и разбор её ответа: последняя непустая строка, id flow или `none`.
import type { Flow } from "../shared/contract";
import { NO_FLOW } from "./flows";

/** Что выбирается: «Без flow» и flow владельца с описаниями со страницы Flow. */
export type FlowChoices = { flows: readonly Pick<Flow, "id" | "name" | "description">[]; noFlowDescription?: string | undefined };

/** Пункт выбора блоком: описание многострочное, со своими списками, и без заголовка слилось бы со следующим пунктом. */
const choiceBlock = (name: string, id: string, description: string | undefined): string => `### ${name}\n\nid: \`${id}\`\n\n${description ?? "No description."}`;

/** Вход модели: правила, «Без flow» первым — чтобы сперва прочесть, когда flow не нужен, — потом flow по порядку и сообщение. */
export const choicePrompt = (skill: string, { flows, noFlowDescription }: FlowChoices, message: string): string =>
  [
    skill.trim(),
    "## Choices",
    choiceBlock("No flow", NO_FLOW, noFlowDescription),
    ...flows.map((flow) => choiceBlock(flow.name, flow.id, flow.description)),
    "## Owner message",
    message,
  ].join("\n\n");

/** Выбор по выводу модели: id flow из `ids` или `NO_FLOW`; пустой вывод и неизвестный id — `null`. */
export const parseChoice = (output: string, ids: readonly string[]): string | null => {
  const last = output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .at(-1);
  const id = last?.replace(/^[`'"]+|[`'"]+$/g, "");
  return id !== undefined && (id === NO_FLOW || ids.includes(id)) ? id : null;
};
