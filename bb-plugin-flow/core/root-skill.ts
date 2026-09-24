// Корневой навык flow — текст файла ~/.claude/skills/flow/SKILL.md. Его пишет Flow из названий и описаний flow
// владельца: по нему агент выбирает flow треду, где выбрано «без flow», а описание flow правится на странице Flow.
import { CHOOSE_FLOW_TOOL, ROOT_SKILL } from "../lib/stage-constants";
import { NO_FLOW } from "./flows";
import type { Flow } from "../shared/contract";

const flowSection = (flow: Flow): string => `## ${flow.name}\n\nid: \`${flow.id}\`\n\n${flow.description ?? "Описание не задано."}`;

export const rootSkillText = (flows: readonly Flow[]): string =>
  [
    `---\nname: ${ROOT_SKILL}\ndescription: Корневой навык Flow — выбор flow для треда, где flow не выбран: какие flow есть у владельца и когда какой брать. Применяй, когда Flow просит выбрать flow треду.\n---`,
    "# Выбор flow",
    "Файл пишет плагин Flow из названий и описаний flow на странице Flow — правка руками затрётся при следующем сохранении flow.",
    `Прочитай запрос владельца, сравни его с описаниями ниже и назначь треду один flow инструментом \`${CHOOSE_FLOW_TOOL}\` с его id. Ответ инструмента перечислит этапы выбранного flow — дальше работа идёт по ним. Ни одно описание не подходит — вызови \`${CHOOSE_FLOW_TOOL}\` с id \`${NO_FLOW}\`: тред останется без flow, и работа пойдёт как обычно.`,
    ...flows.map(flowSection),
  ].join("\n\n") + "\n";
