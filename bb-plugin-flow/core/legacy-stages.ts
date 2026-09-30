// Этапы-навыки прежнего flow по умолчанию. До 8532ba0a новый flow собирался
// из них, а ссылались они на личные навыки владельца: у поставившего плагин
// из маркетплейса такой этап битый. Чистка убирает их из сохранённых flow —
// только те, чьего навыка нет, и только когда список навыков прочитан.
import { ROOT_SKILL } from "../lib/stage-constants";
import type { FlowSettings, WorkStage } from "../shared/contract";

/** Пары «id этапа — навык» прежнего набора: этап под другим id или на другом навыке поставил владелец сам. */
const LEGACY_DEFAULT_SKILL_STAGES: ReadonlyArray<readonly [id: string, skill: string]> = [
  ["task", "task-flow"],
  ["prototype", "prototype"],
  ["spec", "spec"],
  ["plan", "plan"],
  ["implement", "code-standards-fp"],
  ["review", "code-review"],
  ["testing", "testing-tdd"],
];

/** Список навыков прочитан, если в нём виден навык flow, который плагин везёт сам: пустой или урезанный сбоем список не отличить от «навыков нет». */
export const catalogSeesPlugin = (skills: readonly string[]): boolean => skills.includes(ROOT_SKILL);

const isLegacy = (stage: WorkStage): boolean => LEGACY_DEFAULT_SKILL_STAGES.some(([id, skill]) => stage.id === id && stage.skill === skill);

/** Коллекция без этапов прежнего набора, чьих навыков нет в `skills`; убирать нечего или список не прочитан — та же коллекция. */
export const withoutLegacyStages = (settings: FlowSettings, skills: readonly string[]): FlowSettings => {
  if (!catalogSeesPlugin(skills)) return settings;
  const broken = (stage: WorkStage) => isLegacy(stage) && !skills.includes(stage.skill);
  return settings.flows.some((flow) => flow.stages.some(broken))
    ? { ...settings, flows: settings.flows.map((flow) => ({ ...flow, stages: flow.stages.filter((stage) => !broken(stage)) })) }
    : settings;
};
